import { mkdir, rename, writeFile, readFile, access, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collectSessions, mergeLoadedSessions } from './lib/codex-observer.mjs';
import { publishConversations } from './lib/codex-conversations.mjs';
import { sharedGroup } from './lib/bridge-files.mjs';
import { createCommandPump, findCodex, sendToCodex, supportsQueue } from './lib/codex-commands.mjs';
import { createCliLifecycle } from './lib/cli-lifecycle.mjs';
import { collectCliTools } from './lib/cli-tools.mjs';
import { createSearchHistoryCollector } from './lib/session-search-history.mjs';
import { readBridgeSettings, resolveBridgeSettings } from '../server/bridge-settings.js';
import { collectExecutionOptions, collectLoadedSessions, sendConfiguredCommand } from './lib/codex-control.mjs';

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
    'shared-gid': { type: 'string' },
    'allow-commands': { type: 'boolean', default: false },
    'include-conversations': { type: 'boolean', default: false },
    'include-search-history': { type: 'boolean', default: false },
    'codex-bin': { type: 'string' },
    remote: { type: 'string' },
    'remote-auth-token-env': { type: 'string' },
    once: { type: 'boolean', default: false },
    stop: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    process.stdout.write('Usage: npm run bridge:codex -- --workspace . [--once]\nChoose conversation reading, search history and command delivery in the office Connection settings. Saved settings apply while running and survive restart.\nAdvanced initial defaults (only without saved settings): --allow-commands --include-conversations --include-search-history\nOptions: --shared-gid <server-group-id> (Linux redacted exports only)\n--codex-bin <executable-or-js> --remote <Codex endpoint> --remote-auth-token-env <variable-name>\nStop: npm run bridge:codex -- --stop\nWithout saved settings or explicit flags, observation is read-only. See docs/wiki/CLI.md.\n');
    return;
  }
  if (values['remote-auth-token-env'] && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(values['remote-auth-token-env'])) throw new Error('Invalid environment variable name.');
  const workspace = resolve(values.workspace);
  const sharedGid = sharedGroup(values['shared-gid']);
  const sessionsDir = resolve(values['sessions-dir'] || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'));
  const output = resolve(values['output-dir'] || fileURLToPath(new URL('../data/bridge/', import.meta.url)));
  const stopFile = join(output, 'stop.request');
  if (values.stop) {
    await mkdir(output, { recursive: true });
    await writeFile(stopFile, 'stop\n');
    process.stdout.write('Observer stop requested. In-flight delivery may take up to seventy seconds; Codex is unaffected.\n');
    return;
  }
  await access(workspace);
  await mkdir(output, { recursive: true });
  const lock = join(output, '.bridge.lock');
  await lockBridge(lock);
  try {
    await rm(stopFile, { force: true });
    const commandsDir = join(output, 'commands');
    await mkdir(commandsDir, { recursive: true, mode: 0o700 });
    const initial = { conversations: values['include-conversations'], searchHistory: values['include-search-history'], commands: values['allow-commands'] };
    let settings = resolveBridgeSettings(readBridgeSettings(commandsDir), initial);
    let signature = '';
    let control = { enabled: false, bridgeId: randomUUID(), reason: 'not_enabled' };
    let cli;
    let pump;
    let lastProbe = -Infinity;
    let execution = { status: 'disabled', models: [] };
    let lastModels = -Infinity;
    let pendingModels;
    const controlOptions = () => ({ cli, workspace, remote: values.remote, remoteAuthTokenEnv: values['remote-auth-token-env'] });
    const collect = async (includeConversations = settings.options.conversations) => {
      const [observed, loaded] = await Promise.all([collectSessions({ sessionsDir, workspace, includeConversations }),
        cli ? collectLoadedSessions(controlOptions()) : { status: 'unavailable', ids: [] }]);
      return mergeLoadedSessions(observed, loaded);
    };
    const lifecycle = createCliLifecycle();
    let history = null;
    const conversationsDir = join(output, 'conversations');
    const destination = join(output, 'codex.json');
    const temporary = join(dirname(destination), `codex-${process.pid}.tmp`);
    let stopping = false;
    process.on('SIGINT', () => { stopping = true; });
    process.on('SIGTERM', () => { stopping = true; });
    let previouslyFailed = false;
    let snapshot;
    let lastCollection = -Infinity;
    let pending;
    let pendingHistory;
    let lastHistory = -Infinity;
    process.stdout.write('Host connection started. Choose features in the office Connection settings; keep this terminal open.\n');
    do {
      try { await access(stopFile); stopping = true; break; } catch { /* No stop request. */ }
      try {
        const next = resolveBridgeSettings(readBridgeSettings(commandsDir), initial);
        const nextSignature = JSON.stringify(next);
        if (signature !== nextSignature) {
          // A disabled collector finishes its current bounded read before we
          // acknowledge the change; existing archived copies are retained.
          if (!next.options.searchHistory) await pendingHistory;
          settings = next;
          signature = nextSignature;
          control = { enabled: false, bridgeId: randomUUID(), reason: settings.options.commands ? 'cli_unavailable' : 'not_enabled' };
          cli = null;
          lastProbe = -Infinity;
          lastModels = -Infinity;
          execution = { status: settings.options.commands ? 'unavailable' : 'disabled', models: [] };
          if (settings.options.searchHistory && !history) {
            history = createSearchHistoryCollector({ workspace, sessionsDir, output: join(output, 'search-history'), sharedGid });
            lastHistory = -Infinity;
          }
          if (!settings.options.searchHistory) history = null;
          const activeSignature = signature;
          const maySend = () => !stopping && control.enabled && activeSignature === JSON.stringify(resolveBridgeSettings(readBridgeSettings(commandsDir), initial));
          pump = createCommandPump({ directory: commandsDir, bridgeId: control.bridgeId,
            getSessions: async () => (await collect(false)).sessions,
            send: (id, content, selection, commandId) => maySend() ? selection
              ? sendConfiguredCommand({ ...controlOptions(), maySend }, id, content, selection, commandId)
              : sendToCodex(cli, id, content, workspace, values.remote, values['remote-auth-token-env'])
              : { status: 'expired', code: 'BRIDGE_RESTARTED' },
            shouldStop: () => !maySend(),
          });
          lastCollection = -Infinity;
        }
        if (Date.now() - lastProbe >= 30000) {
          lastProbe = Date.now();
          cli = await findCodex(values['codex-bin']);
          control.enabled = Boolean(settings.options.commands && !values.once && cli && await supportsQueue(cli));
          control.reason = !settings.options.commands ? 'not_enabled' : control.enabled ? 'ready' : 'cli_unavailable';
        }
        if (Date.now() - lastCollection >= 5000) {
          const [observed, processes, cliTools] = await Promise.all([collect(), lifecycle.poll(), collectCliTools()]);
          snapshot = { ...observed, generatedAt: new Date().toISOString(), control, execution, processes, cliTools, searchHistory: { enabled: Boolean(history) } };
          snapshot.conversations = { enabled: settings.options.conversations };
          snapshot.settings = { version: 1, ...settings };
          await publishConversations(snapshot, conversationsDir, settings.options.conversations, sharedGid);
          await writeFile(temporary, JSON.stringify(snapshot) + '\n', { mode: 0o644 });
          await rename(temporary, destination);
          lastCollection = Date.now();
        }
        if (control.enabled && !pendingModels && Date.now() - lastModels >= 30000) {
          lastModels = Date.now();
          const activeSignature = signature;
          pendingModels = collectExecutionOptions(controlOptions()).then((value) => {
            if (signature === activeSignature && !stopping) { execution = value; lastCollection = -Infinity; }
          }).finally(() => { pendingModels = null; });
        }
        if (control.enabled && !pending) pending = pump().catch(() => {
          process.stderr.write('Command delivery unavailable. Check local folder access; requests are not automatically retried.\n');
        }).finally(() => { pending = null; });
        if (history && !pendingHistory && Date.now() - lastHistory >= 30000) {
          lastHistory = Date.now();
          pendingHistory = history.collect().catch(() => {
            process.stderr.write('Search history collection unavailable. Existing local search copies are retained.\n');
          }).finally(() => { pendingHistory = null; });
        }
        if (previouslyFailed) process.stdout.write('Codex observation resumed.\n');
        previouslyFailed = false;
        if (values.once) process.stdout.write(`Observed ${snapshot.sessions.length} session(s). ${settings.options.conversations ? 'Limited, redacted conversations exported locally.' : 'No conversation text exported.'}\n`);
      } catch {
        if (!previouslyFailed) process.stderr.write('Codex observation unavailable. Check local directory access.\n');
        previouslyFailed = true;
        if (values.once) process.exitCode = 1;
      }
      if (!values.once && !stopping) await new Promise((done) => setTimeout(done, 1000));
    } while (!values.once && !stopping);
    await pending;
    await pendingHistory;
    await pendingModels;
    if (snapshot && !values.once) {
      snapshot.stopped = true;
      snapshot.control = { enabled: false, reason: 'not_enabled' };
      snapshot.processes.status = 'unavailable';
      snapshot.processes.items = snapshot.processes.items.map((item) => item.status === 'running' ? { ...item, status: 'unknown' } : item);
      await writeFile(temporary, JSON.stringify(snapshot) + '\n', { mode: 0o644 });
      await rename(temporary, destination);
    }
  } finally { await rm(lock, { force: true }); }
}

main().catch(() => {
  process.stderr.write('Bridge could not start. Check arguments and local directories; use --help.\n');
  process.exitCode = 1;
});
