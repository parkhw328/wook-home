import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishConversations } from '../../scripts/lib/codex-conversations.mjs';
import { prepareBridgeDirectory, sharedGroup, writeBridgeJson } from '../../scripts/lib/bridge-files.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const snapshot = () => ({ schemaVersion: 1, generatedAt: new Date().toISOString(), conversations: { enabled: true }, sessions: [{
  id, status: 'idle', lastActivityAt: new Date().toISOString(),
  conversation: { messages: [{ role: 'assistant', timestamp: new Date().toISOString(), content: '공개 검증 응답' }] },
}] });

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'office-shared-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('group sharing is explicit, validates numeric groups and retains owner-only defaults', async (t) => {
  const root = fixture(t);
  assert.equal(sharedGroup(undefined), null);
  assert.equal(sharedGroup('1000'), 1000);
  assert.equal(sharedGroup('0'), 0);
  for (const value of ['', '-1', '1e3', '1000;command', '4294967295']) assert.throws(() => sharedGroup(value));
  const directory = join(root, 'private');
  await publishConversations(snapshot(), directory, true);
  assert.equal(JSON.parse(readFileSync(join(directory, `${id}.json`))).messages.length, 1);
  if (process.platform !== 'win32') {
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(join(directory, `${id}.json`)).mode & 0o777, 0o600);
  }
});

test('same-account publication upgrades existing directories and survives repeated atomic writes', { skip: process.platform === 'win32' }, async (t) => {
  const root = fixture(t);
  const directory = join(root, 'conversations');
  await publishConversations(snapshot(), directory, true);
  for (let run = 0; run < 2; run += 1) {
    await publishConversations(snapshot(), directory, true, process.getgid());
    assert.equal(statSync(directory).mode & 0o777, 0o750);
    assert.equal(statSync(join(directory, `${id}.json`)).mode & 0o777, 0o640);
    assert.equal(statSync(join(directory, `${id}.json`)).gid, process.getgid());
  }
  const history = join(root, 'search-history');
  await prepareBridgeDirectory(history, process.getgid());
  await writeBridgeJson(join(history, 'index.json'), { items: [] }, process.getgid());
  assert.equal(statSync(join(history, 'index.json')).mode & 0o777, 0o640);
  await publishConversations({ sessions: [] }, directory, false, process.getgid());
  assert.throws(() => statSync(join(directory, `${id}.json`)), { code: 'ENOENT' });
});

test('different non-root server UID can read only the explicitly shared group and reports permission errors', {
  skip: process.platform !== 'linux' || process.getuid?.() !== 0,
}, async (t) => {
  const root = fixture(t);
  chmodSync(root, 0o755);
  const file = join(root, 'codex.json');
  const directory = join(root, 'conversations');
  const source = new URL('../../server/sessions.js', import.meta.url).href;
  const read = (gid) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `import {createSessionObserver} from ${JSON.stringify(source)}; const d=createSessionObserver({file:${JSON.stringify(file)}}).conversation(${JSON.stringify(id)}); console.log(JSON.stringify({status:d.status, reason:d.reason, count:d.messages.length}));`],
  { uid: 65534, gid, env: {}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  for (let run = 0; run < 2; run += 1) {
    const data = snapshot();
    await publishConversations(data, directory, true);
    writeFileSync(file, JSON.stringify(data), { mode: 0o644 });
    assert.deepEqual(read(1000), { status: 'unavailable', reason: 'permission_denied', count: 0 });
    await publishConversations(snapshot(), directory, true, 1000);
    assert.deepEqual(read(1000), { status: 'ready', count: 1 });
    assert.deepEqual(read(65534), { status: 'unavailable', reason: 'permission_denied', count: 0 });
  }
});
