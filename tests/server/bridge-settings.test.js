import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bridgeDefaults, bridgeSettingsFile, createBridgeSettings, readBridgeSettings, resolveBridgeSettings } from '../../server/bridge-settings.js';
import { createSessionObserver } from '../../server/sessions.js';
import { createHttpServer } from '../../server/http.js';
import { createOffice } from '../../server/office.js';
import { createStore } from '../../server/store.js';

const temp = (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'office-settings-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
};
const allOn = { conversations: true, searchHistory: true, commands: true };

test('settings persist, use explicit booleans, reject conflicting writes and keep saved choices above CLI flags', (t) => {
  const directory = temp(t);
  const observer = { snapshot: () => ({ status: 'not_connected' }) };
  const manager = createBridgeSettings({ directory, observer });
  assert.deepEqual(manager.snapshot().options, bridgeDefaults);
  const saved = manager.configure({ revision: null, options: allOn });
  assert.equal(saved.status, 'not_connected');
  assert.equal(saved.saved, true);
  assert.deepEqual(createBridgeSettings({ directory, observer }).snapshot(), saved);
  assert.deepEqual(resolveBridgeSettings(readBridgeSettings(directory)).options, allOn);
  const disabled = manager.configure({ revision: saved.revision, options: bridgeDefaults });
  assert.deepEqual(resolveBridgeSettings(readBridgeSettings(directory), allOn).options, bridgeDefaults);
  assert.throws(() => manager.configure({ revision: saved.revision, options: allOn }), (error) => error.code === 'SETTINGS_CONFLICT');
  assert.equal(manager.snapshot().revision, disabled.revision);
  for (const options of [{}, { ...allOn, commands: 'true' }, { ...allOn, path: '/elsewhere' }]) {
    assert.throws(() => manager.configure({ revision: disabled.revision, options }), (error) => error.status === 400);
  }
});

test('broken or oversized settings fail closed and are never silently replaced', (t) => {
  const directory = temp(t);
  const manager = createBridgeSettings({ directory, observer: { snapshot: () => ({}) } });
  for (const text of ['{"private":"unparseable', 'x'.repeat(4097)]) {
    writeFileSync(bridgeSettingsFile(directory), text);
    assert.equal(manager.snapshot().status, 'storage_error');
    assert.deepEqual(resolveBridgeSettings(readBridgeSettings(directory), allOn).options, bridgeDefaults);
    assert.equal(resolveBridgeSettings(readBridgeSettings(directory), allOn).error, true);
    assert.throws(() => manager.configure({ revision: null, options: allOn }), (error) => error.code === 'SETTINGS_STORAGE_UNAVAILABLE' && !error.message.includes('private'));
    assert.equal(readFileSync(bridgeSettingsFile(directory), 'utf8'), text);
  }
});

test('settings report legacy, pending, applied and disconnected states without treating unsupported commands as enabled', (t) => {
  const directory = temp(t);
  const file = join(directory, 'codex.json');
  const observer = createSessionObserver({ file });
  const manager = createBridgeSettings({ directory, observer });
  const bridge = { schemaVersion: 1, generatedAt: new Date().toISOString(), workspace: 'fixture', sessions: [] };
  const publish = () => writeFileSync(file, JSON.stringify(bridge));
  publish();
  assert.equal(manager.snapshot().status, 'upgrade_required');
  bridge.settings = { version: 1, revision: null, options: bridgeDefaults };
  publish();
  const saved = manager.configure({ revision: null, options: allOn });
  assert.equal(saved.status, 'pending');
  bridge.settings = { version: 1, revision: saved.revision, options: allOn };
  bridge.conversations = { enabled: true };
  bridge.searchHistory = { enabled: true };
  bridge.control = { enabled: false, reason: 'cli_unavailable' };
  publish();
  assert.equal(manager.snapshot().status, 'applied');
  assert.deepEqual(manager.snapshot().applied, { ...allOn, commands: false });
  bridge.settings.options = bridgeDefaults;
  publish();
  assert.equal(manager.snapshot().status, 'pending');
  bridge.stopped = true;
  publish();
  assert.equal(manager.snapshot().status, 'not_connected');
  assert.equal(manager.snapshot().applied, null);
});

test('settings API protects origins, excludes handoff and blocks new commands immediately when disabled', async (t) => {
  const directory = temp(t);
  const id = randomUUID();
  const file = join(directory, 'codex.json');
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), sessions: [{ id, status: 'idle', lastActivityAt: new Date().toISOString() }], control: { enabled: true, bridgeId: randomUUID() } }));
  const store = createStore(':memory:');
  const server = createHttpServer(createOffice(store), { bridgeFile: file, commandsDir: directory });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (body, headers = {}) => fetch(`${base}/api/bridge/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await put({ revision: null, options: allOn }, { Origin: 'https://outside.test' })).status, 403);
  assert.equal((await fetch(`${base}/api/bridge/settings`, { headers: { Origin: 'https://outside.test' } })).status, 403);
  assert.equal((await put({ revision: null, options: { ...allOn, url: 'private-value' } })).status, 400);
  const response = await put({ revision: null, options: bridgeDefaults });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await (await fetch(`${base}/api/handoff`)).text(), new RegExp(saved.revision));
  assert.equal((await fetch(`${base}/api/local-sessions/${id}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: randomUUID(), content: 'must not send' }) })).status, 409);
});

async function waitFor(check) {
  for (let i = 0; i < 180; i += 1) {
    try { const result = check(); if (result) return result; } catch { /* The first atomic publication may not exist yet. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.fail('bridge did not apply settings');
}

test('running host applies conversation, archive and command switches, removes temporary dialogue, and restores settings on restart', { timeout: 60000 }, async (t) => {
  const root = temp(t);
  const sessions = join(root, 'sessions');
  const output = join(root, 'bridge');
  const directory = join(output, 'commands');
  const timestamp = new Date().toISOString();
  const day = join(sessions, ...timestamp.slice(0, 10).split('-'));
  mkdirSync(day, { recursive: true });
  const id = randomUUID();
  writeFileSync(join(day, 'rollout-fixture.jsonl'), [{ type: 'session_meta', payload: { id, cwd: root } },
    { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '설정 검증용 공개 메시지' }] } }].map(JSON.stringify).join('\n') + '\n');
  const fakeCli = join(root, 'fake-codex.mjs');
  writeFileSync(fakeCli, "if (process.argv.includes('--help')) process.stdout.write('--thread --message'); else process.exitCode = 1;\n");
  const script = fileURLToPath(new URL('../../scripts/codex-bridge.mjs', import.meta.url));
  let child;
  let exited;
  function start() {
    child = spawn(process.execPath, [script, '--workspace', root, '--sessions-dir', sessions, '--output-dir', output, '--codex-bin', fakeCli], { stdio: 'ignore' });
    exited = new Promise((done) => child.once('exit', done));
  }
  t.after(async () => { if (child?.exitCode === null) { child.kill(); await exited; } });
  const observer = createSessionObserver({ file: join(output, 'codex.json') });
  const manager = createBridgeSettings({ directory, observer });
  start();
  await waitFor(() => observer.snapshot().settings);
  assert.equal(observer.conversation(id).status, 'disabled');
  const first = manager.configure({ revision: null, options: allOn });
  await waitFor(() => manager.snapshot().status === 'applied' && manager.snapshot().applied.commands);
  assert.equal(observer.conversation(id).messages[0].content, '설정 검증용 공개 메시지');
  const archive = join(output, 'search-history', 'index.json');
  await waitFor(() => existsSync(archive));
  const second = manager.configure({ revision: first.revision, options: bridgeDefaults });
  await waitFor(() => manager.snapshot().status === 'applied');
  assert.equal(observer.conversation(id).status, 'disabled');
  assert.equal(existsSync(join(output, 'conversations', `${id}.json`)), false);
  assert.equal(existsSync(archive), true);
  assert.equal(observer.snapshot().control.enabled, false);
  child.kill(); await exited;
  assert.equal(manager.snapshot().status, 'not_connected');
  start();
  await waitFor(() => manager.snapshot().status === 'applied');
  assert.equal(manager.snapshot().revision, second.revision);
  assert.deepEqual(manager.snapshot().options, bridgeDefaults);
});
