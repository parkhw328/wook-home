import { mkdir, rename, writeFile, readFile, access, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collectSessions } from './lib/codex-observer.mjs';
import { createCommandPump, findCodex, sendToCodex, supportsQueue } from './lib/codex-commands.mjs';

async function lockBridge(file) {
  try { await writeFile(file, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(file, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid bridge lock.');
    try { process.kill(pid, 0); }
    catch (error) {
      if (error.code !== 'ESRCH') throw error;
      await rm(file);
      await writeFile(file, String(process.pid), { flag: 'wx', mode: 0o600 });
      return;
    }
    throw new Error('A bridge is already running.');
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    workspace: { type: 'string', default: process.cwd() },
    'sessions-dir': { type: 'string' },
    'output-dir': { type: 'string' },
    'allow-commands': { type: 'boolean', default: false },
    'codex-bin': { type: 'string' },
    remote: { type: 'string' },
    once: { type: 'boolean', default: false },
    stop: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    process.stdout.write('Usage: npm run bridge:codex -- --workspace . [--allow-commands] [--once]\nOptions: --codex-bin <executable-or-js> --remote <Codex endpoint>\nStop: npm run bridge:codex -- --stop\nObservation is read-only by default; --allow-commands enables the official Codex queue. See docs/wiki/CLI.md.\n');
    return;
  }
  const workspace = resolve(values.workspace);
  const sessionsDir = resolve(values['sessions-dir'] || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'));
  const output = resolve(values['output-dir'] || fileURLToPath(new URL('../data/bridge/', import.meta.url)));
  const stopFile = join(output, 'stop.request');
  if (values.stop) {
    await mkdir(output, { recursive: true });
    await writeFile(stopFile, 'stop\n');
    process.stdout.write('Observer stop requested. In-flight delivery may take up to sixteen seconds; Codex is unaffected.\n');
    return;
  }
  await access(workspace);
  await access(sessionsDir);
  await mkdir(output, { recursive: true });
  const lock = join(output, '.bridge.lock');
  await lockBridge(lock);
  try {
    await rm(stopFile, { force: true });
    const commandsDir = join(output, 'commands');
    await mkdir(commandsDir, { recursive: true, mode: 0o700 });
    const bridgeId = randomUUID();
    const cli = values['allow-commands'] && !values.once ? await findCodex(values['codex-bin']) : null;
    const enabled = Boolean(cli && await supportsQueue(cli));
    const control = { enabled, bridgeId, reason: enabled ? 'ready' : values['allow-commands'] ? 'cli_unavailable' : 'not_enabled' };
    if (values['allow-commands']) process.stdout.write(enabled ? 'Codex command queue enabled.\n' : 'Codex command queue unavailable; observation only. Check codex queue --help.\n');
    const collect = () => collectSessions({ sessionsDir, workspace });
    const pump = createCommandPump({ directory: commandsDir, bridgeId,
      getSessions: async () => (await collect()).sessions,
      send: (id, content) => sendToCodex(cli, id, content, workspace, values.remote),
      shouldStop: () => stopping,
    });
    const destination = join(output, 'codex.json');
    const temporary = join(dirname(destination), `codex-${process.pid}.tmp`);
    let stopping = false;
    process.on('SIGINT', () => { stopping = true; });
    process.on('SIGTERM', () => { stopping = true; });
    let previouslyFailed = false;
    let snapshot;
    let lastCollection = 0;
    let pending;
    do {
      try { await access(stopFile); stopping = true; break; } catch { /* No stop request. */ }
      try {
        if (Date.now() - lastCollection >= 5000) {
          snapshot = { ...await collect(), control };
          await writeFile(temporary, JSON.stringify(snapshot) + '\n', { mode: 0o644 });
          await rename(temporary, destination);
          lastCollection = Date.now();
        }
        if (enabled && !pending) pending = pump().catch(() => {
          process.stderr.write('Command delivery unavailable. Check local folder access; requests are not automatically retried.\n');
        }).finally(() => { pending = null; });
        if (previouslyFailed) process.stdout.write('Codex observation resumed.\n');
        previouslyFailed = false;
        if (values.once) process.stdout.write(`Observed ${snapshot.sessions.length} session(s). No conversation text exported.\n`);
      } catch {
        if (!previouslyFailed) process.stderr.write('Codex observation unavailable. Check local directory access.\n');
        previouslyFailed = true;
        if (values.once) process.exitCode = 1;
      }
      if (!values.once && !stopping) await new Promise((done) => setTimeout(done, 1000));
    } while (!values.once && !stopping);
    await pending;
    if (snapshot && !values.once) {
      snapshot.control = { enabled: false, reason: 'not_enabled' };
      await writeFile(temporary, JSON.stringify(snapshot) + '\n', { mode: 0o644 });
      await rename(temporary, destination);
    }
  } finally { await rm(lock, { force: true }); }
}

main().catch(() => {
  process.stderr.write('Bridge could not start. Check arguments and local directories; use --help.\n');
  process.exitCode = 1;
});
