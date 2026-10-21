import { open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const candidates = new Set(['codex', 'claude', 'gemini', 'node', 'nodejs']);
const vanished = (error) => ['ENOENT', 'ESRCH'].includes(error.code);
const unavailable = () => new Error('Linux CLI process scan incomplete.');

// procfs reports size zero. Read with a hard limit instead of trusting stat.size.
export async function readProcFile(file, limit = 65536) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw unavailable();
    return buffer.subarray(0, length).toString('utf8');
  } finally { await handle.close(); }
}

export function parseLinuxStat(text, pid) {
  // comm can contain spaces and parentheses; fields after its final ')' are fixed.
  const end = text.lastIndexOf(')');
  if (!text.startsWith(`${pid} (`) || end < 0) throw unavailable();
  const fields = text.slice(end + 2).trim().split(/\s+/);
  const ticks = Number(fields[19]); // field 22: starttime in clock ticks since boot
  if (fields.length < 20 || !/^[A-Zt]$/.test(fields[0]) || !Number.isSafeInteger(ticks) || ticks < 0) throw unavailable();
  return { name: text.slice(text.indexOf('(') + 1, end), state: fields[0], ticks };
}

function nodeEntry(argv) {
  const values = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--conditions', '-C']);
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (/^(?:-e|-p|-c|--eval|--print|--check|--test)(?:=|$)/.test(arg)) return null;
    if (values.has(arg)) { index += 1; continue; }
    if (arg === '--') return argv[index + 1] || null;
    if (!arg.startsWith('-')) return arg;
  }
  return null;
}

function effectiveUid(status) {
  const value = status.match(/^Uid:\s+\d+\s+(\d+)\s+\d+\s+\d+\s*$/m);
  if (!value || !Number.isSafeInteger(Number(value[1]))) throw unavailable();
  return Number(value[1]);
}

// Run on the host, never in the office container. Only the current effective UID
// is inspected, including its other terminals/SSH sessions. argv stays in memory.
export async function linuxProcessRows({ run, procRoot = '/proc', uid = process.geteuid?.(),
  read = readProcFile, list = readdir, realpathImpl = realpath } = {}) {
  if (!Number.isSafeInteger(uid) || uid < 0) throw unavailable();
  const { stdout } = await run('/usr/bin/getconf', ['CLK_TCK'], { timeout: 1000, maxBuffer: 1024 });
  const hz = Number(stdout.trim());
  const boot = Number((await read(join(procRoot, 'stat'), 1024 * 1024)).match(/^btime (\d+)$/m)?.[1]);
  if (!Number.isSafeInteger(hz) || hz <= 0 || !Number.isSafeInteger(boot) || boot <= 0) throw unavailable();
  const pids = (await list(procRoot)).filter((name) => /^[1-9]\d*$/.test(name));
  if (pids.length > 32768) throw unavailable();
  const rows = [];
  const deadline = Date.now() + 3000;
  for (const id of pids) {
    if (Date.now() > deadline) throw unavailable();
    const directory = join(procRoot, id);
    try {
      // Directory ownership can change to root for a non-dumpable process.
      // Read the kernel's effective UID so that this cannot fabricate an exit.
      if (effectiveUid(await read(join(directory, 'status'))) !== uid) continue;
      const before = parseLinuxStat(await read(join(directory, 'stat')), id);
      if (!candidates.has(before.name) || ['Z', 'X'].includes(before.state)) continue;
      const text = await read(join(directory, 'cmdline'));
      if (!text || !text.endsWith('\0')) throw unavailable();
      const argv = text.slice(0, -1).split('\0');
      let entryPoint;
      if (['node', 'nodejs'].includes(before.name)) {
        const entry = nodeEntry(argv);
        if (entry) {
          try { entryPoint = await realpathImpl(isAbsolute(entry) ? entry : join(directory, 'cwd', entry)); }
          catch (error) {
            // A deleted script can still run: its literal official path remains useful.
            if (!vanished(error)) throw error;
          }
        }
      }
      const after = parseLinuxStat(await read(join(directory, 'stat')), id);
      if (['Z', 'X'].includes(after.state)) continue;
      if (before.ticks !== after.ticks || before.name !== after.name || effectiveUid(await read(join(directory, 'status'))) !== uid) throw unavailable();
      rows.push({ pid: Number(id), name: before.name, argv, entryPoint,
        startedAt: new Date(boot * 1000 + Math.floor(before.ticks * 1000 / hz)).toISOString() });
      if (rows.length > 512) throw unavailable();
    } catch (error) {
      if (!vanished(error)) throw unavailable();
    }
  }
  return rows;
}
