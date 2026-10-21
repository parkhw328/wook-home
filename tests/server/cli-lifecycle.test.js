import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCliLifecycle, identifyCliProcess, isInteractiveCodex, sanitizeProcessRows, scanCliProcesses, windowsArguments } from '../../scripts/lib/cli-lifecycle.mjs';
import { readCliProcesses } from '../../server/cli-processes.js';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';

const start = '2026-10-21T10:00:00.000Z';
const processA = { pid: 1234, provider: 'openai', startedAt: start };

test('interactive CLI detection excludes helper processes and protects literal flag values', () => {
  for (const args of ['', 'resume', 'fork --last', 'agents', '--model queue', '-c features.code_mode_host=true', '"fix a bug"', '-- "app-server"']) {
    assert.equal(isInteractiveCodex(`"C:\\Program Files\\Codex\\codex.exe" ${args}`), true, args);
  }
  for (const args of ['queue --thread secret --message private', '-c features.code_mode_host=true app-server --listen unix://', 'exec "private prompt"', 'exec-server --remote private-url', 'app-server proxy', '--help', '--version', 'resume --help', 'exec -- "private prompt"', 'doctor --summary']) {
    assert.equal(isInteractiveCodex(`codex.exe ${args}`), false, args);
  }
  assert.deepEqual(windowsArguments('codex.exe --cd "C:\\some folder" -c "key=\\"secret\\""'), ['codex.exe', '--cd', 'C:\\some folder', '-c', 'key="secret"']);
  const rows = sanitizeProcessRows([{ name: 'codex.exe', pid: 1234, startedAt: start, commandLine: 'codex.exe --remote-auth-token-env PRIVATE_TOKEN "private prompt"' }]);
  assert.deepEqual(rows, [processA]);
  assert.doesNotMatch(JSON.stringify(rows), /private|TOKEN|commandLine/i);
});

test('Claude and Gemini official launchers are identified without treating helpers or arbitrary Node scripts as sessions', () => {
  assert.equal(identifyCliProcess({ name: 'claude.exe', commandLine: 'claude.exe -c' }), 'claude');
  assert.equal(identifyCliProcess({ name: 'claude.exe', commandLine: 'claude.exe -p "private"' }), null);
  assert.equal(identifyCliProcess({ name: 'claude.exe', commandLine: 'claude.exe auth status' }), null);
  assert.equal(identifyCliProcess({ name: 'node.exe', commandLine: 'node.exe C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js --model sonnet' }), 'claude');
  assert.equal(identifyCliProcess({ name: 'node.exe', commandLine: 'node.exe C:\\npm\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js' }), 'gemini');
  assert.equal(identifyCliProcess({ name: 'node.exe', commandLine: 'node.exe C:\\npm\\node_modules\\@google\\gemini-cli\\dist\\index.js -p "private"' }), null);
  assert.equal(identifyCliProcess({ name: 'node.exe', commandLine: 'node.exe C:\\other\\gemini.js' }), null);
  assert.equal(identifyCliProcess({ name: 'node.exe', commandLine: 'node.exe C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js' }), null);
  const official = 'C:\\npm\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js';
  assert.equal(identifyCliProcess({ name: 'node.exe', commandLine: `node.exe -e ${official}` }), null);
  assert.equal(identifyCliProcess({ name: 'node.exe', commandLine: `node.exe --require ${official} C:\\other\\server.js` }), null);
  assert.equal(identifyCliProcess({ name: 'node.exe', commandLine: `node.exe --no-warnings --require C:\\preload.js ${official}` }), 'gemini');
});

test('new empty CLI, exit and PID reuse each produce one distinct lifecycle event', async () => {
  let now = Date.parse(start) + 1000;
  let items = [processA];
  const monitor = createCliLifecycle({ clock: () => now, scan: async () => ({ status: 'connected', items }) });
  const first = await monitor.poll();
  assert.equal(first.items[0].status, 'running');
  assert.equal(first.events.length, 1);
  assert.equal((await monitor.poll()).events.length, 1);
  now += 5000;
  items = [{ ...processA, startedAt: new Date(now).toISOString() }];
  const reused = await monitor.poll();
  assert.equal(reused.items.length, 2);
  assert.equal(reused.items[0].status, 'running');
  assert.equal(reused.items[1].status, 'exited');
  assert.notEqual(reused.items[0].id, reused.items[1].id);
  assert.equal(reused.events.filter((event) => event.type === 'exited').length, 1);
  items = [];
  now += 5000;
  const closed = await monitor.poll();
  assert.ok(closed.items.every((item) => item.status === 'exited'));
  assert.equal(closed.events.filter((event) => event.type === 'exited').length, 2);
  assert.equal((await monitor.poll()).events.length, closed.events.length);
});

test('scanner failures and recovery never fabricate termination', async () => {
  let now = Date.parse(start) + 1000;
  let fail = false;
  const monitor = createCliLifecycle({ clock: () => now, scan: async () => {
    if (fail) throw new Error('private-system-details');
    return { status: 'connected', items: [processA] };
  } });
  const initial = await monitor.poll();
  fail = true; now += 5000;
  const failed = await monitor.poll();
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.items[0].status, 'unknown');
  assert.equal(failed.items[0].endedAt, null);
  assert.equal(failed.updatedAt, initial.updatedAt);
  assert.equal(failed.events.length, 1);
  fail = false; now += 5000;
  const recovered = await monitor.poll();
  assert.equal(recovered.items[0].id, initial.items[0].id);
  assert.equal(recovered.items[0].status, 'running');
  assert.equal(recovered.events.length, 1);
  now += 24 * 3600000;
  assert.equal((await monitor.poll()).items[0].status, 'running');
});

test('exit history is bounded and expires without changing surviving processes', async () => {
  let now = Date.parse(start) + 1000;
  let items = Array.from({ length: 32 }, (_, index) => ({ ...processA, pid: processA.pid + index }));
  const monitor = createCliLifecycle({ clock: () => now, retentionMs: 10000, scan: async () => ({ status: 'connected', items }) });
  await monitor.poll();
  items = [processA]; now += 5000;
  const limited = await monitor.poll();
  assert.equal(limited.items.length, 25);
  assert.equal(limited.items.filter((item) => item.status === 'exited').length, 24);
  assert.ok(limited.events.length <= 50);
  now += 10001;
  const remaining = await monitor.poll();
  assert.equal(remaining.items.length, 1);
  assert.equal(remaining.items[0].pid, processA.pid);
  assert.equal(remaining.items[0].status, 'running');
  assert.deepEqual(remaining.events, []);
});

test('OS scanner bounds input, contains failures and marks unsupported platforms', async () => {
  assert.throws(() => sanitizeProcessRows([{ pid: 1, startedAt: start, commandLine: null }]));
  assert.throws(() => sanitizeProcessRows(Array(513).fill({})));
  assert.throws(() => sanitizeProcessRows(Array.from({ length: 65 }, (_, index) => ({ name: 'codex.exe', pid: index + 1, startedAt: start, commandLine: 'codex.exe' }))));
  const unavailable = await scanCliProcesses({ platform: 'win32', run: async () => { throw new Error('private command'); } });
  assert.deepEqual(unavailable, { status: 'unavailable', items: [] });
  assert.deepEqual(await scanCliProcesses({ platform: 'darwin' }), { status: 'unsupported', items: [] });
  const result = await scanCliProcesses({ platform: 'win32', run: async (_file, _args, options) => {
    assert.equal(options.windowsHide, true);
    return { stdout: JSON.stringify([{ name: 'codex.exe', pid: 1234, startedAt: start, commandLine: 'codex.exe' }]) };
  } });
  assert.deepEqual(result, { status: 'connected', items: [processA] });
});

test('HTTP contract strips private fields and treats stale observations as unknown', async () => {
  const now = Date.parse(start) + 1000;
  const monitor = createCliLifecycle({ clock: () => now, scan: async () => ({ status: 'connected', items: [processA] }) });
  const snapshot = await monitor.poll();
  snapshot.items[0].name = 'private name';
  snapshot.items[0].commandLine = 'private prompt';
  snapshot.items[0].sessionId = 'guessed-session-id';
  const live = readCliProcesses(snapshot, true, now);
  assert.equal(live.items[0].status, 'running');
  assert.doesNotMatch(JSON.stringify(live), /private|guessed|commandLine|sessionId/);
  const stale = readCliProcesses(snapshot, true, now + 21000);
  assert.equal(stale.status, 'disconnected');
  assert.equal(stale.items[0].status, 'unknown');
  assert.equal(stale.items[0].endedAt, null);
  assert.equal(readCliProcesses(snapshot, false, now).status, 'disconnected');
  assert.equal(readCliProcesses({ ...snapshot, platform: 'win32' }, true, now).scope, 'login_session');
  const legacy = readCliProcesses({ ...snapshot, platform: undefined }, true, now);
  assert.equal(legacy.scope, 'this_pc');
  assert.equal(legacy.platform, 'unknown');
  assert.equal(readCliProcesses({ ...snapshot, platform: 'private-host', scope: 'private-user' }, true, now).platform, 'unknown');
  assert.equal(readCliProcesses({ ...snapshot, items: Array(89).fill(snapshot.items[0]) }, true, now).status, 'unavailable');
});

test('Office HTTP publishes lifecycle changes separately from saved sessions and excludes them from handoff', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'wook-home-cli-process-'));
  const file = join(directory, 'bridge.json');
  let now = Date.parse(start) + 1000;
  let items = [processA];
  const monitor = createCliLifecycle({ clock: () => now, scan: async () => ({ status: 'connected', items }) });
  const save = async () => writeFileSync(file, JSON.stringify({
    schemaVersion: 1, generatedAt: new Date(now).toISOString(), workspace: 'test-project', sessions: [], processes: await monitor.poll(),
  }));
  await save();
  const store = createStore(':memory:');
  const office = createOffice(store);
  const server = createHttpServer(office, { bridgeFile: file, clock: () => now });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    await new Promise((done) => server.close(done));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const initial = await (await fetch(base + '/api/state')).json();
  const processId = initial.localSessions.processes.items[0].id;
  assert.equal(initial.localSessions.processes.items[0].status, 'running');
  assert.equal(initial.localSessions.sessions.length, 0);
  assert.equal(initial.agents.length, 0);
  items = []; now += 5000;
  await save();
  const ended = await (await fetch(base + '/api/state')).json();
  assert.equal(ended.localSessions.processes.items[0].status, 'exited');
  assert.equal(ended.localSessions.processes.events.filter((item) => item.type === 'exited').length, 1);
  const handoff = await (await fetch(base + '/api/handoff')).json();
  assert.doesNotMatch(JSON.stringify(handoff), /cli-event-|localSessions/);
  assert.equal(JSON.stringify(handoff).includes(processId), false);
});
