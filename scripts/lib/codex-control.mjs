import { spawn } from 'node:child_process';
import { Duplex } from 'node:stream';
import WebSocket from 'ws';
import { readExecutionOptions, supportsExecutionOptions } from '../../server/execution-options.js';

// The official proxy carries WebSocket bytes, not newline-delimited JSON.
// Use the installed CLI to locate its control socket on either host platform.
export async function connectCodex({ cli, workspace, remote, remoteAuthTokenEnv, timeout = 8000 }) {
  let child;
  const options = { handshakeTimeout: timeout, maxPayload: 1024 * 1024, followRedirects: false, perMessageDeflate: false };
  let url = remote;
  if (!remote || remote.startsWith('unix://')) {
    const args = [...cli.prefix, 'app-server', 'proxy'];
    if (remote?.slice(7)) args.push('--sock', remote.slice(7));
    child = spawn(cli.executable, args, { cwd: workspace, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const stream = Duplex.from({ readable: child.stdout, writable: child.stdin });
    child.on('error', () => stream.destroy(new Error('Codex connection unavailable.')));
    options.createConnection = () => stream;
    url = 'ws://localhost/';
  } else if (!/^wss?:\/\//.test(remote)) throw new Error('Unsupported Codex endpoint.');
  if (remoteAuthTokenEnv) {
    const token = process.env[remoteAuthTokenEnv];
    if (!token) { child?.kill(); throw new Error('Codex authentication unavailable.'); }
    options.headers = { Authorization: `Bearer ${token}` };
  }
  const socket = new WebSocket(url, options);
  const pending = new Map();
  let sequence = 0;
  const fail = () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Codex response unavailable.')); }
    pending.clear();
  };
  socket.on('error', fail);
  socket.on('close', fail);
  socket.on('message', (buffer) => {
    let message;
    try { message = JSON.parse(buffer.toString()); } catch { return; }
    if (message.method) return;
    const entry = pending.get(message.id);
    if (!entry) return; // Never retain conversations, notifications or account data.
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) {
      const error = new Error('Codex rejected the request.');
      error.rejected = true;
      entry.reject(error);
    } else if (Object.hasOwn(message, 'result')) entry.resolve(message.result);
    else entry.reject(new Error('Invalid Codex response.'));
  });
  const close = () => { fail(); socket.terminate(); child?.kill(); };
  const request = (method, params) => new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) { reject(new Error('Codex disconnected.')); return; }
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Codex response timed out.')); }, timeout);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }), (error) => { if (error) fail(); });
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', () => reject(new Error('Codex connection unavailable.')));
      socket.once('close', () => reject(new Error('Codex disconnected.')));
    });
    await request('initialize', { clientInfo: { name: 'wook_home', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    socket.send(JSON.stringify({ method: 'initialized' }));
    return { request, close };
  } catch (error) { close(); throw error; }
}

async function modelsFrom(client) {
  const models = [];
  let cursor;
  for (let page = 0; page < 3; page += 1) {
    const result = await client.request('model/list', { limit: 30, includeHidden: false, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(result?.data)) throw new Error('Invalid model catalog.');
    for (const model of result.data) {
      if (model.hidden) continue;
      models.push({ id: model.model, name: model.displayName, isDefault: model.isDefault,
        reasoningEfforts: model.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort), defaultReasoningEffort: model.defaultReasoningEffort });
    }
    cursor = result.nextCursor;
    if (!cursor || models.length >= 30) break;
  }
  return readExecutionOptions({ status: 'ready', updatedAt: new Date().toISOString(), models }, true);
}

export async function collectExecutionOptions(options, connect = connectCodex) {
  let client;
  try { client = await connect(options); return await modelsFrom(client); }
  catch { return { status: 'unavailable', updatedAt: null, models: [] }; }
  finally { client?.close(); }
}

export async function sendConfiguredCommand(options, sessionId, content, selection, commandId, connect = connectCodex) {
  let client;
  let stage = 'connect';
  let settingsApplied = false;
  try {
    client = await connect(options);
    const catalog = await modelsFrom(client);
    if (!supportsExecutionOptions(catalog, selection)) return { status: 'failed', code: 'MODEL_UNAVAILABLE' };
    if (options.maySend && !options.maySend()) return { status: 'expired', code: 'BRIDGE_RESTARTED' };
    // Settings apply to subsequent turns of this existing thread. Never change
    // cwd, permissions, approval policy, collaboration mode, or the running turn.
    stage = 'settings';
    await client.request('thread/settings/update', { threadId: sessionId, model: selection.model, effort: selection.reasoningEffort });
    settingsApplied = true;
    if (options.maySend && !options.maySend()) return { status: 'expired', code: 'BRIDGE_RESTARTED', settingsApplied };
    stage = 'queue';
    const result = await client.request('thread/queue/add', { threadId: sessionId, clientUserMessageId: commandId,
      input: [{ type: 'text', text: content, text_elements: [] }] });
    if (!result?.queuedSubmission?.id || result.queuedSubmission.clientUserMessageId !== commandId) throw new Error('Invalid queue receipt.');
    return { status: 'accepted', code: 'QUEUED', settingsApplied };
  } catch (error) {
    if (stage === 'queue') return { status: error.rejected ? 'failed' : 'unknown', code: error.rejected ? 'CLI_REJECTED' : 'DELIVERY_UNCERTAIN', settingsApplied };
    return { status: 'failed', code: stage === 'settings' && !error.rejected ? 'SETTINGS_UNCERTAIN' : 'SETTINGS_REJECTED', settingsApplied };
  } finally { client?.close(); }
}
