import { mkdir, rename, writeFile, access, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collectSessions } from './lib/codex-observer.mjs';

async function main() {
  const { values } = parseArgs({ options: {
    workspace: { type: 'string', default: process.cwd() },
    'sessions-dir': { type: 'string' },
    'output-dir': { type: 'string' },
    once: { type: 'boolean', default: false },
    stop: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    process.stdout.write('Usage: npm run bridge:codex -- --workspace . [--once]\nStop a foreground or background observer: npm run bridge:codex -- --stop\nRead-only Codex activity observer. See docs/wiki/CLI.md.\n');
    return;
  }
  const workspace = resolve(values.workspace);
  const sessionsDir = resolve(values['sessions-dir'] || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'));
  const output = resolve(values['output-dir'] || fileURLToPath(new URL('../data/bridge/', import.meta.url)));
  const stopFile = join(output, 'stop.request');
  if (values.stop) {
    await mkdir(output, { recursive: true });
    await writeFile(stopFile, 'stop\n');
    process.stdout.write('Observer stop requested. It will stop within five seconds; Codex is unaffected.\n');
    return;
  }
  await access(workspace);
  await access(sessionsDir);
  await mkdir(output, { recursive: true });
  await rm(stopFile, { force: true });
  const destination = join(output, 'codex.json');
  const temporary = join(dirname(destination), `codex-${process.pid}.tmp`);
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  let previouslyFailed = false;
  do {
    try { await access(stopFile); break; } catch { /* No stop request. */ }
    try {
      const snapshot = await collectSessions({ sessionsDir, workspace });
      await writeFile(temporary, JSON.stringify(snapshot) + '\n', { mode: 0o644 });
      await rename(temporary, destination);
      if (previouslyFailed) process.stdout.write('Codex observation resumed.\n');
      previouslyFailed = false;
      if (values.once) process.stdout.write(`Observed ${snapshot.sessions.length} session(s). No conversation text exported.\n`);
    } catch {
      if (!previouslyFailed) process.stderr.write('Codex observation unavailable. Check local directory access.\n');
      previouslyFailed = true;
      if (values.once) process.exitCode = 1;
    }
    if (!values.once && !stopping) await new Promise((done) => setTimeout(done, 5000));
  } while (!values.once && !stopping);
}

main().catch(() => {
  process.stderr.write('Bridge could not start. Check arguments and local directories; use --help.\n');
  process.exitCode = 1;
});
