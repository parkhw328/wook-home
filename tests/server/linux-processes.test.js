import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCliLifecycle, identifyCliProcess, scanCliProcesses } from '../../scripts/lib/cli-lifecycle.mjs';
import { parseLinuxStat, readProcFile } from '../../scripts/lib/linux-processes.mjs';
import { readCliProcesses } from '../../server/cli-processes.js';
import { createDiscovery } from '../../server/discovery.js';

function statText(pid, name = 'codex', ticks = 12345, state = 'S') {
  return `${pid} (${name}) ${[state, ...Array(18).fill('0'), String(ticks), ...Array(30).fill('0')].join(' ')}\n`;
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wook-linux-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const procRoot = join(directory, 'proc');
  await mkdir(procRoot);
  await writeFile(join(procRoot, 'stat'), 'cpu 0 0 0 0\nbtime 1792548000\n');
  const options = { platform: 'linux', procRoot, uid: 1000,
    run: async (file, args, options) => {
      assert.equal(file, '/usr/bin/getconf'); assert.deepEqual(args, ['CLK_TCK']);
      assert.ok(options.timeout <= 4000); return { stdout: '100\n' };
    } };
  async function processRow(pid, name, argv = [name], ticks = 12345, state = 'S') {
    const folder = join(procRoot, String(pid));
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'status'), 'Uid:\t1000\t1000\t1000\t1000\n');
    await writeFile(join(folder, 'stat'), statText(pid, name, ticks, state));
    await writeFile(join(folder, 'cmdline'), argv.join('\0') + '\0');
  }
  return { directory, procRoot, options, processRow };
}

test('Linux stat parsing handles spaces, parentheses, idle state and malformed start times', () => {
  assert.deepEqual(parseLinuxStat(statText(12, 'name (with ) spaces'), 12), { name: 'name (with ) spaces', state: 'S', ticks: 12345 });
  assert.equal(parseLinuxStat(statText(2, 'kthreadd', 0, 'I'), 2).ticks, 0);
  for (const text of ['broken', statText(13), statText(12, 'codex', -1), statText(12, 'codex', 'secret')]) {
    assert.throws(() => parseLinuxStat(text, 12), /incomplete/);
  }
});

test('Linux argv preserves quotes and spaces and excludes helpers, Node eval and npm wrapper duplicates', () => {
  for (const argv of [['codex'], ['codex', '--cd', '/a path', 'fix "quotes"'], ['codex', '--model', 'queue'], ['codex', '--', '--help']]) {
    assert.equal(identifyCliProcess({ name: 'codex', argv }), 'openai');
  }
  for (const argv of [['codex', 'exec', 'private'], ['codex', '--cd', '/a path', 'app-server'], ['codex', '--help']]) {
    assert.equal(identifyCliProcess({ name: 'codex', argv }), null);
  }
  assert.equal(identifyCliProcess({ name: 'claude', argv: ['claude', '--continue'] }), 'claude');
  assert.equal(identifyCliProcess({ name: 'claude', argv: ['claude', '-p', 'private'] }), null);
  assert.equal(identifyCliProcess({ name: 'node', argv: ['node', '/usr/lib/node_modules/@openai/codex/bin/codex.js'] }), null);
  const gemini = '/opt/my tools/node_modules/@google/gemini-cli/dist/index.js';
  assert.equal(identifyCliProcess({ name: 'node', argv: ['node', gemini, '--prompt-interactive', 'a prompt'] }), 'gemini');
  assert.equal(identifyCliProcess({ name: 'node', argv: ['node', '-e', gemini] }), null);
  assert.equal(identifyCliProcess({ name: 'node', argv: ['node', '--require', gemini, '/other.js'] }), null);
  assert.equal(identifyCliProcess({ name: 'node', argv: ['node', gemini.replace('@google', '@Google')] }), null);
  assert.equal(identifyCliProcess({ name: 'node', argv: ['node', gemini.replaceAll('/', '\\')] }), null);
});

test('Linux inventory reads only the current user, resolves official npm symlinks and strips private argv', async (t) => {
  const { directory, procRoot, options, processRow } = await fixture(t);
  const entry = join(directory, 'node_modules/@google/gemini-cli/dist/index.js');
  await mkdir(join(entry, '..'), { recursive: true }); await writeFile(entry, '');
  const link = join(directory, 'gemini'); await symlink(entry, link);
  await processRow(11, 'codex', ['codex', '--cd', '/private workspace', 'secret prompt']);
  await processRow(12, 'node', ['node', '--no-warnings', link]);
  await processRow(13, 'node', ['node', '/x/node_modules/@anthropic-ai/claude-code/cli.js', '--resume', 'secret-id']);
  await processRow(14, 'codex', ['codex', 'queue', '--message', 'secret']);
  await processRow(15, 'codex'); // another UID, including when the observer runs as root
  await processRow(16, 'node', ['node', '/x/node_modules/@openai/codex/bin/codex.js']);
  await processRow(17, 'bash', ['bash', '-c', 'codex']);
  await writeFile(join(procRoot, '15/status'), 'Uid:\t1001\t1001\t1001\t1001\n');
  options.read = async (file, limit) => { assert.ok(!file.endsWith('/15/cmdline')); return readProcFile(file, limit); };
  const scan = await scanCliProcesses(options);
  assert.equal(scan.status, 'connected');
  assert.deepEqual(scan.items.map((row) => row.provider), ['openai', 'gemini', 'claude']);
  assert.equal(scan.items[0].startedAt, new Date(1792548000000 + 123450).toISOString());
  assert.doesNotMatch(JSON.stringify(scan), /private|secret|node_modules|argv|entryPoint|commandLine/);
});

test('permission failures, oversize argv and PID reuse during a scan never invent exits', async (t) => {
  const { procRoot, options, processRow } = await fixture(t);
  await processRow(11, 'codex');
  let failed = false;
  let raced = false;
  options.read = async (file, limit) => {
    if (file.endsWith('/11/cmdline')) {
      if (failed) throw Object.assign(new Error('private'), { code: 'EACCES' });
      if (raced) await writeFile(join(procRoot, '11/stat'), statText(11, 'codex', 67890));
    }
    return readProcFile(file, limit);
  };
  const monitor = createCliLifecycle({ platform: 'linux', scan: () => scanCliProcesses(options) });
  const first = await monitor.poll(); assert.equal(first.items[0].status, 'running');
  failed = true;
  const lost = await monitor.poll();
  assert.equal(lost.status, 'unavailable'); assert.equal(lost.items[0].status, 'unknown');
  assert.equal(lost.items[0].endedAt, null); assert.equal(lost.events.length, 1);
  failed = false; assert.equal((await monitor.poll()).items[0].status, 'running');
  raced = true; assert.equal((await monitor.poll()).status, 'unavailable');
  raced = false;
  const reused = await monitor.poll();
  assert.equal(reused.items.filter((item) => item.status === 'exited').length, 1);
  await writeFile(join(procRoot, '11/cmdline'), 'codex\0' + 'x'.repeat(65536) + '\0');
  assert.equal((await monitor.poll()).status, 'unavailable');
  assert.equal((await monitor.poll()).events.filter((event) => event.type === 'exited').length, 1);
});

test('disappearing processes and zombies terminate, missing procfs and getconf fail explicitly', async (t) => {
  const { options, processRow } = await fixture(t);
  await processRow(11, 'codex');
  await processRow(12, 'codex', [], 12345, 'Z');
  options.list = async () => ['11', '12', '13', 'self']; // 13 exits during enumeration
  assert.deepEqual((await scanCliProcesses(options)).items.map((row) => row.pid), [11]);
  assert.equal((await scanCliProcesses({ ...options, procRoot: '/missing-proc-fixture' })).status, 'unavailable');
  assert.equal((await scanCliProcesses({ ...options, run: async () => { throw new Error('private'); } })).status, 'unavailable');
  assert.equal((await scanCliProcesses({ ...options, run: async () => ({ stdout: 'not ticks' }) })).status, 'unavailable');
  await processRow(11, 'codex', [], 12345, 'Z');
  assert.deepEqual((await scanCliProcesses(options)).items, []);
});

test('Linux scope survives server validation and discovery without leaking account names or granting control', async (t) => {
  const { options, processRow } = await fixture(t);
  await processRow(11, 'codex');
  const lifecycle = createCliLifecycle({ platform: 'linux', scan: () => scanCliProcesses(options) });
  const processes = readCliProcesses({ ...await lifecycle.poll(), username: 'private-user' }, true);
  assert.equal(processes.platform, 'linux'); assert.equal(processes.scope, 'same_user');
  const discovery = createDiscovery({ observer: { snapshot: () => ({ status: 'connected', sessions: [], processes }) } }).snapshot();
  assert.match(discovery.entries[0].scope, /Linux 같은 사용자/);
  assert.equal(discovery.sources.processes.platform, 'linux');
  assert.equal(discovery.entries[0].canControl, false);
  assert.doesNotMatch(JSON.stringify(discovery), /private-user|username|sessionId/);
});
