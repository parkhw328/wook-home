import { execFile } from 'node:child_process';
import { access, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { delimiter, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { commandId, readCommand } from '../../server/local-commands.js';

const execute = promisify(execFile);

// Never send user text through cmd.exe/PowerShell/sh. On Windows, invoke the
// official npm entry point with Node rather than interpolating a .cmd shim.
export async function findCodex(explicit, path = process.env.PATH || '') {
  const candidates = explicit ? [resolve(explicit)] : path.split(delimiter).flatMap((directory) => process.platform === 'win32'
    ? [join(directory, 'codex.exe'), join(directory, 'node_modules/@openai/codex/bin/codex.js')]
    : [join(directory, 'codex')]);
  for (const file of candidates) {
    if (/\.(cmd|bat|ps1)$/i.test(file)) continue;
    try {
      await access(file);
      const js = ['.js', '.mjs'].includes(extname(file));
      return { executable: js ? process.execPath : file, prefix: js ? [file] : [] };
    } catch { /* Try the next PATH entry. */ }
  }
  return null;
}

export async function supportsQueue(cli) {
  if (!cli) return false;
  try {
    const { stdout } = await execute(cli.executable, [...cli.prefix, 'queue', '--help'], { timeout: 5000, maxBuffer: 32768, windowsHide: true });
    return stdout.includes('--thread') && stdout.includes('--message');
  } catch { return false; }
}

export async function sendToCodex(cli, sessionId, content, workspace, remote, remoteAuthTokenEnv) {
  const args = [...cli.prefix, 'queue', '--thread', sessionId, '--message', content];
  if (remote) args.push('--remote', remote);
  if (remoteAuthTokenEnv) args.push('--remote-auth-token-env', remoteAuthTokenEnv);
  try {
    await execute(cli.executable, args, { cwd: workspace, timeout: 15000, maxBuffer: 32768, windowsHide: true });
    return { status: 'accepted', code: 'QUEUED' };
  } catch (error) {
    // Output can contain private paths or prompt text; never return or log it.
    return error.killed || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      ? { status: 'unknown', code: 'DELIVERY_UNCERTAIN' }
      : { status: 'failed', code: 'CLI_REJECTED' };
  }
}

export function createCommandPump({ directory, bridgeId, getSessions, send, shouldStop = () => false, clock = Date.now }) {
  let busy = false;
  const save = async (value) => {
    const temporary = join(directory, `${value.id}.${process.pid}.tmp`);
    await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600 });
    await rename(temporary, join(directory, `${value.id}.json`));
  };
  return async function pump() {
    if (busy) return;
    busy = true;
    try {
      const names = (await readdir(directory)).filter((name) => commandId.test(name.replace(/\.json$/, '')) && name.endsWith('.json')).slice(0, 1000);
      const requests = names.map((name) => readCommand(join(directory, name))).filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const request of requests) {
        if (shouldStop()) break;
        if (!['pending', 'sending'].includes(request.status)) {
          if (clock() - Date.parse(request.updatedAt) > 7 * 86400000) await rm(join(directory, `${request.id}.json`), { force: true });
          continue;
        }
        // Strip plaintext before invoking the CLI. Retain only a digest for
        // duplicate-request checks. A crash after this point is never replayed.
        const { content, ...receipt } = request;
        receipt.updatedAt = new Date(clock()).toISOString();
        if (request.status === 'sending') {
          await save({ ...receipt, status: 'unknown', code: 'DELIVERY_UNCERTAIN' });
        } else if (request.bridgeId !== bridgeId) {
          await save({ ...receipt, status: 'expired', code: 'BRIDGE_RESTARTED' });
        } else if (!Number.isFinite(Date.parse(request.expiresAt)) || clock() > Date.parse(request.expiresAt)
          || Date.parse(request.createdAt) > clock() + 5000) {
          await save({ ...receipt, status: 'expired', code: 'REQUEST_EXPIRED' });
        } else if (typeof content !== 'string' || !content.trim() || content.length > 4000 || content.includes('\0')) {
          await save({ ...receipt, status: 'failed', code: 'CLI_REJECTED' });
        } else if (!(await getSessions()).some((session) => session.id === request.sessionId)) {
          await save({ ...receipt, status: 'failed', code: 'SESSION_UNAVAILABLE' });
        } else {
          await save({ ...receipt, status: 'sending' });
          let result;
          try { result = await send(request.sessionId, content); }
          catch { result = { status: 'unknown', code: 'DELIVERY_UNCERTAIN' }; }
          await save({ ...receipt, ...result, updatedAt: new Date(clock()).toISOString() });
        }
      }
    } finally { busy = false; }
  };
}
