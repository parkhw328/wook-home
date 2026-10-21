import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { linuxProcessRows } from './linux-processes.mjs';

const execute = promisify(execFile);
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const helpers = new Set(['app', 'app-server', 'apply', 'archive', 'cloud', 'completion', 'debug', 'delete', 'doctor', 'e', 'exec', 'exec-server', 'execpolicy', 'features', 'help', 'login', 'logout', 'mcp', 'mcp-server', 'plugin', 'queue', 'remote-control', 'review', 'sandbox', 'unarchive', 'update']);
const valueOptions = new Set(['-c', '--config', '-C', '--cd', '-m', '--model', '-p', '--profile', '-s', '--sandbox', '-a', '--ask-for-approval', '-i', '--image', '--enable', '--disable', '--remote', '--remote-auth-token-env', '--local-provider', '--add-dir']);
const providerNames = { openai: 'Codex CLI', claude: 'Claude Code', gemini: 'Gemini CLI' };

// Parse Windows argv without evaluating it. Command lines can contain prompts or
// credentials: use them only in memory to identify interactive CLI processes.
export function windowsArguments(commandLine) {
  const args = [];
  let word = '', quoted = false, started = false;
  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index];
    if (character === '\\') {
      let count = 1;
      while (commandLine[index + 1] === '\\') { count += 1; index += 1; }
      if (commandLine[index + 1] === '"') {
        word += '\\'.repeat(Math.floor(count / 2));
        if (count % 2) word += '"'; else quoted = !quoted;
        index += 1;
      } else word += '\\'.repeat(count);
      started = true;
    } else if (character === '"') { quoted = !quoted; started = true; }
    else if (/\s/.test(character) && !quoted) {
      if (started) { args.push(word); word = ''; started = false; }
    } else { word += character; started = true; }
  }
  if (started) args.push(word);
  return args;
}

export function isInteractiveCodex(commandLine) {
  if (!Array.isArray(commandLine) && (typeof commandLine !== 'string' || !commandLine.trim())) return false;
  const args = (Array.isArray(commandLine) ? commandLine : windowsArguments(commandLine)).slice(1);
  let command = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') break;
    if (['-h', '--help', '-V', '--version'].includes(arg)) return false;
    if (valueOptions.has(arg)) { index += 1; continue; }
    if (arg.startsWith('-')) continue;
    if (command === null) command = arg;
  }
  return !helpers.has(command);
}

export function identifyCliProcess(row) {
  const args = row.argv || windowsArguments(row.commandLine);
  const executable = String(row.name || '').toLowerCase();
  let provider = { codex: 'openai', claude: 'claude', gemini: 'gemini', 'codex.exe': 'openai', 'claude.exe': 'claude', 'gemini.exe': 'gemini' }[executable];
  let input = args.slice(1);
  if (['node.exe', 'node', 'nodejs'].includes(executable)) {
    // Codex's npm launcher starts a native child; count only that child.
    // Restrict Node entry points to official package paths, not script names.
    let entry = -1;
    const nodeValues = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--conditions', '-C']);
    for (let index = 0; index < input.length; index += 1) {
      const arg = input[index];
      if (/^(?:-e|-p|-c|--eval|--print|--check|--test)(?:=|$)/.test(arg)) return null;
      if (nodeValues.has(arg)) { index += 1; continue; }
      if (arg === '--') { entry = index + 1; break; }
      if (!arg.startsWith('-')) { entry = index; break; }
    }
    const entryPath = row.entryPoint || input[entry];
    const file = row.argv ? entryPath : entryPath?.replaceAll('\\', '/').toLowerCase();
    if (file?.endsWith('/node_modules/@anthropic-ai/claude-code/cli.js')) provider = 'claude';
    if (/\/node_modules\/@google\/gemini-cli\/(?:bundle\/gemini|dist\/index)\.js$/.test(file || '')) provider = 'gemini';
    input = input.slice(entry + 1);
  }
  if (!provider) return null;
  if (provider === 'openai') return isInteractiveCodex(args) ? provider : null;
  const skipped = new Set(provider === 'claude'
    ? ['auth', 'auto-mode', 'daemon', 'doctor', 'gateway', 'help', 'install', 'mcp', 'plugin', 'remote-control', 'setup-token', 'update']
    : ['extensions', 'hooks', 'mcp', 'policies', 'skills']);
  const options = new Set(['-m', '--model', '-r', '--resume', '--session-id', '--effort', '--settings', '--mcp-config', '--permission-mode', '--agent', '--add-dir', '--cwd', '--output-format', '--input-format', '--approval-mode', '--prompt-interactive', '-i']);
  let command = null;
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index];
    if (arg === '--') break;
    if (['--help', '-h', '--version', '-v', '--json', '--list-sessions', '--delete-session', '--print', '-p', '--prompt'].includes(arg)
      || /^(?:--print|--prompt|--delete-session)=/.test(arg)) return null;
    if (options.has(arg)) { index += 1; continue; }
    if (!arg.startsWith('-') && command === null) command = arg;
  }
  return skipped.has(command) ? null : provider;
}

const scanScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $currentSession = (Get-Process -Id $PID).SessionId
  $rows = @(Get-CimInstance Win32_Process -Filter "Name = 'codex.exe' OR Name = 'claude.exe' OR Name = 'gemini.exe' OR Name = 'node.exe'" | Where-Object { $_.SessionId -eq $currentSession } | ForEach-Object {
    [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; startedAt = $_.CreationDate.ToUniversalTime().ToString('o'); commandLine = $_.CommandLine }
  })
  ConvertTo-Json -InputObject $rows -Compress
} catch { [Console]::Error.WriteLine('CLI_PROCESS_SCAN_FAILED'); exit 1 }
`;

export function sanitizeProcessRows(rows) {
  if (!Array.isArray(rows) || rows.length > 512) throw new Error('CLI process scan unavailable.');
  const result = [];
  for (const row of rows) {
    const hasArgs = Array.isArray(row?.argv) && row.argv.length > 0 && row.argv.every((arg) => typeof arg === 'string') && row.argv[0];
    if (!Number.isSafeInteger(row?.pid) || row.pid <= 0 || !timestamp(row.startedAt) || (!hasArgs && (typeof row.commandLine !== 'string' || !row.commandLine))) {
      // A partially unreadable inventory must not be interpreted as an exit.
      throw new Error('CLI process scan incomplete.');
    }
    const provider = identifyCliProcess(row);
    if (!provider) continue;
    result.push({ pid: row.pid, provider, startedAt: new Date(row.startedAt).toISOString() });
  }
  if (result.length > 64) throw new Error('CLI process scan exceeds the supported limit.');
  return result;
}

export async function scanCliProcesses({ platform = process.platform, run = execute, ...linuxOptions } = {}) {
  if (!['win32', 'linux'].includes(platform)) return { status: 'unsupported', items: [] };
  try {
    if (platform === 'linux') return { status: 'connected', items: sanitizeProcessRows(await linuxProcessRows({ run, ...linuxOptions })) };
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const { stdout } = await run(executable, ['-NoProfile', '-NonInteractive', '-Command', scanScript], {
      timeout: 4000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    return { status: 'connected', items: sanitizeProcessRows(JSON.parse(stdout.replace(/^\uFEFF/, ''))) };
  } catch {
    // Never surface child stdout/stderr: command lines may contain private text.
    return { status: 'unavailable', items: [] };
  }
}

const instanceId = (pid, startedAt) => `cli-${createHash('sha256').update(`${pid}\n${startedAt}`).digest('hex').slice(0, 24)}`;

export function createCliLifecycle({ scan = scanCliProcesses, clock = Date.now, retentionMs = 10 * 60000, platform = process.platform } = {}) {
  const known = new Map();
  let events = [];
  let sequence = 0;
  let updatedAt = null;
  return {
    async poll() {
      const now = clock();
      const at = new Date(now).toISOString();
      let snapshot;
      try { snapshot = await scan(); } catch { snapshot = { status: 'unavailable' }; }
      const connected = snapshot.status === 'connected';
      if (connected) {
        updatedAt = at;
        const found = new Set();
        for (const process of snapshot.items) {
          const id = instanceId(process.pid, process.startedAt);
          found.add(id);
          const previous = known.get(id);
          if (!previous) events.push({ id: `cli-event-${++sequence}`, type: 'detected', processId: id, at });
          known.set(id, {
            id, pid: process.pid, provider: process.provider, name: `${providerNames[process.provider]} · ${process.pid}`,
            status: 'running', startedAt: process.startedAt,
            firstSeenAt: previous?.firstSeenAt || at, lastSeenAt: at, endedAt: null,
          });
        }
        for (const [id, process] of known) {
          if (!found.has(id) && process.status !== 'exited') {
            known.set(id, { ...process, status: 'exited', endedAt: at });
            events.push({ id: `cli-event-${++sequence}`, type: 'exited', processId: id, at });
          }
        }
      }
      for (const [id, process] of known) if (process.endedAt && now - Date.parse(process.endedAt) > retentionMs) known.delete(id);
      const live = [...known.values()].filter((item) => item.status !== 'exited').sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const closed = [...known.values()].filter((item) => item.status === 'exited').sort((a, b) => b.endedAt.localeCompare(a.endedAt)).slice(0, 24);
      const items = [...live, ...closed];
      const retained = new Set(items.map((item) => item.id));
      for (const id of known.keys()) if (!retained.has(id)) known.delete(id);
      events = events.filter((event) => retained.has(event.processId) && now - Date.parse(event.at) <= retentionMs).slice(-50);
      return {
        status: connected ? 'connected' : snapshot.status === 'unsupported' ? 'unsupported' : 'unavailable',
        platform: ['win32', 'linux'].includes(platform) ? platform : 'unsupported',
        scope: platform === 'linux' ? 'same_user' : platform === 'win32' ? 'login_session' : 'this_pc', updatedAt,
        items: items.map((item) => !connected && item.status === 'running' ? { ...item, status: 'unknown' } : { ...item }),
        events: events.map((event) => ({ ...event })),
      };
    },
  };
}
