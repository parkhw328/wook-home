import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';
import { readCommand } from '../../server/local-commands.js';
import { createCommandPump, findCodex, sendToCodex, supportsQueue } from '../../scripts/lib/codex-commands.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wook-home-commands-'));
  const directory = join(root, 'commands');
  mkdirSync(directory);
  let time = Date.now();
  const clock = () => time;
  const sessionId = randomUUID();
  const bridgeId = randomUUID();
  const snapshot = { schemaVersion: 1, generatedAt: new Date(time).toISOString(), workspace: 'test',
    sessions: [{ id: sessionId, status: 'working', lastActivityAt: new Date(time).toISOString() }],
    control: { enabled: true, bridgeId },
  };
  const bridgeFile = join(root, 'codex.json');
  const publish = () => writeFileSync(bridgeFile, JSON.stringify(snapshot));
  publish();
  const store = createStore(':memory:');
  const office = createOffice(store);
  const server = createHttpServer(office, { bridgeFile, commandsDir: directory, clock });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    await new Promise((done) => server.close(done));
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const submit = (input, id = sessionId, headers = {}) => fetch(`${base}/api/local-sessions/${id}/commands`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
  });
  return { root, directory, base, submit, office, snapshot, publish, clock, sessionId, bridgeId, advance: (ms) => { time += ms; } };
}

test('a command is delivered once, with idempotent retries and no prompt in receipts or handoff', async (t) => {
  const f = await fixture(t);
  const request = { id: randomUUID(), content: 'private-command\n한글과 "quotes"; $(never-run) & %PATH%' };
  const response = await f.submit(request);
  assert.equal(response.status, 202);
  assert.equal((await response.json()).status, 'pending');
  const delivered = [];
  const pump = createCommandPump({ ...f, getSessions: async () => f.snapshot.sessions,
    send: async (sessionId, content) => {
      assert.equal(readCommand(join(f.directory, `${request.id}.json`)).content, undefined);
      delivered.push({ sessionId, content });
      return { status: 'accepted', code: 'QUEUED' };
    },
  });
  await Promise.all([pump(), pump()]);
  await pump();
  assert.deepEqual(delivered, [{ sessionId: f.sessionId, content: request.content }]);
  f.office.pause();
  const retry = await f.submit(request);
  assert.equal(retry.status, 202);
  assert.equal((await retry.json()).status, 'accepted');
  const receipt = await (await fetch(`${f.base}/api/local-commands/${request.id}`)).json();
  assert.equal(receipt.code, 'QUEUED');
  assert.doesNotMatch(JSON.stringify(receipt), /private-command|fingerprint|bridgeId/);
  assert.doesNotMatch(JSON.stringify(f.office.handoff()), /private-command|sessionId/);
  assert.doesNotMatch(readFileSync(join(f.directory, `${request.id}.json`), 'utf8'), /private-command/);
  assert.equal((await f.submit({ ...request, content: 'different' })).status, 409);
});

test('command API rejects stale bridges, unobserved sessions, paused offices and cross-origin requests', async (t) => {
  const f = await fixture(t);
  const request = { id: randomUUID(), content: 'verify' };
  assert.equal((await f.submit(request, f.sessionId, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await f.submit(request, randomUUID())).status, 404);
  f.office.pause();
  assert.equal((await f.submit(request)).status, 409);
  f.office.resume({});
  f.snapshot.control.enabled = false;
  f.publish();
  assert.equal((await f.submit(request)).status, 409);
  f.snapshot.control.enabled = true;
  f.publish();
  f.advance(21000);
  assert.equal((await f.submit(request)).status, 409);
  assert.deepEqual(readdirSync(f.directory), []);
});

test('invalid or extended command input cannot become CLI arguments', async (t) => {
  const f = await fixture(t);
  for (const input of [null, [], { id: '../path', content: 'x' }, { id: randomUUID(), content: ' ' },
    { id: randomUUID(), content: 'x'.repeat(4001) }, { id: randomUUID(), content: 'x\0y' },
    { id: randomUUID(), content: 'x', remote: 'https://example.invalid' }]) {
    assert.equal((await f.submit(input)).status, 400);
  }
  assert.deepEqual(readdirSync(f.directory), []);
});

test('expired, interrupted and previous-bridge requests are never replayed', async (t) => {
  const f = await fixture(t);
  const variants = [
    { status: 'sending', expected: 'unknown', code: 'DELIVERY_UNCERTAIN' },
    { status: 'pending', bridgeId: randomUUID(), expected: 'expired', code: 'BRIDGE_RESTARTED' },
    { status: 'pending', expiresAt: new Date(f.clock() - 1).toISOString(), expected: 'expired', code: 'REQUEST_EXPIRED' },
    { status: 'pending', sessionId: randomUUID(), expected: 'failed', code: 'SESSION_UNAVAILABLE' },
  ];
  for (const variant of variants) {
    const input = { id: randomUUID(), content: 'private-never-replay' };
    await f.submit(input);
    const file = join(f.directory, `${input.id}.json`);
    const { expected, code, ...changes } = variant;
    writeFileSync(file, JSON.stringify({ ...readCommand(file), ...changes }));
    const pump = createCommandPump({ ...f, getSessions: async () => f.snapshot.sessions, send: async () => assert.fail('must not send') });
    await pump();
    const receipt = readCommand(file);
    assert.equal(receipt.status, expected);
    assert.equal(receipt.code, code);
    assert.equal(receipt.content, undefined);
  }
});

test('uncertain delivery is visible and never automatically retried', async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  await f.submit({ id, content: 'test' });
  let count = 0;
  const pump = createCommandPump({ ...f, getSessions: async () => f.snapshot.sessions, send: async () => { count++; throw new Error('private failure'); } });
  await pump();
  await pump();
  assert.equal(count, 1);
  assert.equal(readCommand(join(f.directory, `${id}.json`)).status, 'unknown');
});

test('receipts expose expiry and uncertain sends even while the host is offline', async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  await f.submit({ id, content: 'test' });
  const file = join(f.directory, `${id}.json`);
  const pending = readCommand(file);
  f.advance(61000);
  const expired = await (await fetch(`${f.base}/api/local-commands/${id}`)).json();
  assert.equal(expired.status, 'expired');
  writeFileSync(file, JSON.stringify({ ...pending, status: 'sending' }));
  const uncertain = await (await fetch(`${f.base}/api/local-commands/${id}`)).json();
  assert.equal(uncertain.status, 'unknown');
  assert.equal(readCommand(file).status, 'sending');
});

test('Codex runner preserves multilingual text literally without a command shell', async (t) => {
  const f = await fixture(t);
  const script = join(f.root, 'fake-codex.mjs');
  writeFileSync(script, `import {writeFileSync} from 'node:fs';
if(process.argv.includes('--help')) console.log('--thread --message');
else writeFileSync(new URL('./received.json',import.meta.url),JSON.stringify(process.argv.slice(2)));`);
  const cli = await findCodex(script);
  assert.equal(await supportsQueue(cli), true);
  const content = '한글 "quotes"\n$(touch forbidden) & exit; %PATH% `literal`';
  assert.equal((await sendToCodex(cli, f.sessionId, content, f.root)).status, 'accepted');
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'received.json'), 'utf8')), ['queue', '--thread', f.sessionId, '--message', content]);
  writeFileSync(script, 'process.stderr.write("private-error");process.exitCode=2;');
  assert.deepEqual(await sendToCodex(cli, f.sessionId, content, f.root), { status: 'failed', code: 'CLI_REJECTED' });
});
