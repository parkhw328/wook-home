import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { collectExecutionOptions, collectLoadedSessions, sendConfiguredCommand } from '../../scripts/lib/codex-control.mjs';
import { readExecutionOptions } from '../../server/execution-options.js';
import { summarizeRecords } from '../../scripts/lib/codex-observer.mjs';

const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const commandId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const selection = { model: 'supported-model', reasoningEffort: 'high' };
const model = { model: 'supported-model', displayName: 'Supported model', isDefault: true,
  supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'low' };

test('live-session discovery pages read-only IDs without executing, resuming, reading conversations or changing permissions', async (t) => {
  const f = await fixture(t, (message) => message.method === 'thread/loaded/list'
    ? { result: message.params.cursor ? { data: [commandId], nextCursor: null } : { data: [sessionId], nextCursor: 'page2' } } : undefined);
  assert.deepEqual(await collectLoadedSessions(f.options), { status: 'ready', ids: [sessionId, commandId] });
  assert.deepEqual(f.calls.map((entry) => entry.method), ['initialize', 'initialized', 'thread/loaded/list', 'thread/loaded/list']);
});

test('invalid, partial, looping, and failed liveness queries discard all IDs rather than declaring sessions dead', async () => {
  for (const result of [{ data: ['invalid'] }, { data: [sessionId], nextCursor: 'loop' }, { secret: 'private' }, null]) {
    let closed = false;
    const connect = async () => ({ request: async () => { if (!result) throw new Error('private'); return result; }, close: () => { closed = true; } });
    assert.deepEqual(await collectLoadedSessions({}, connect), { status: 'unavailable', ids: [] });
    assert.equal(closed, true);
  }
});

test('live metadata discovers empty and paginated threads only in the exact selected workspace', async (t) => {
  const f = await fixture(t, (message) => {
    if (message.method === 'thread/loaded/list') return { result: { data: [sessionId, commandId], nextCursor: null } };
    if (message.method === 'thread/read') return { result: { thread: {
      id: message.params.threadId, cwd: message.params.threadId === sessionId ? '/selected-project' : '/other-project',
      updatedAt: 1793059200, status: { type: 'idle' }, preview: 'private preview', turns: [], private: 'not exported',
    } } };
  });
  const result = await collectLoadedSessions({ ...f.options, workspace: '/selected-project' });
  assert.deepEqual(result.sessions, [{ id: sessionId, lifecycle: 'live', status: 'idle', lastActivityAt: new Date(1793059200 * 1000).toISOString() }]);
  assert.doesNotMatch(JSON.stringify(result.sessions), /private|cwd|preview|other-project|turns/);
  assert.ok(f.calls.filter((call) => call.method === 'thread/read').every((call) => call.params.includeTurns === false));
  assert.ok(f.calls.every((call) => ['initialize', 'initialized', 'thread/loaded/list', 'thread/read'].includes(call.method)));
});

async function fixture(t, handler = () => undefined) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  const calls = [];
  server.on('connection', (socket) => socket.on('message', (bytes) => {
    const message = JSON.parse(bytes);
    calls.push(message);
    if (!message.id) return;
    const response = handler(message, socket);
    if (response === false) return;
    const defaults = { initialize: { userAgent: 'test' }, 'model/list': { data: [model], nextCursor: null },
      'thread/settings/update': {}, 'thread/queue/add': { queuedSubmission: { id: 'queue-id', clientUserMessageId: commandId } } };
    socket.send(JSON.stringify({ id: message.id, ...(response || { result: defaults[message.method] }) }));
  }));
  t.after(async () => { for (const socket of server.clients) socket.terminate(); await new Promise((resolve) => server.close(resolve)); });
  return { calls, options: { remote: `ws://127.0.0.1:${server.address().port}`, timeout: 100 } };
}

test('real WebSocket transport reads advertised model-specific efforts and applies settings before queueing', async (t) => {
  const f = await fixture(t);
  const catalog = await collectExecutionOptions(f.options);
  assert.deepEqual(catalog.models, [{ id: model.model, name: model.displayName, isDefault: true, reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' }]);
  f.calls.length = 0;
  const content = '--literal\n한글 <script> $(never-run)';
  const receipt = await sendConfiguredCommand(f.options, sessionId, content, selection, commandId);
  assert.deepEqual(receipt, { status: 'accepted', code: 'QUEUED', settingsApplied: true });
  assert.deepEqual(f.calls.map((entry) => entry.method), ['initialize', 'initialized', 'model/list', 'thread/settings/update', 'thread/queue/add']);
  assert.deepEqual(f.calls[3].params, { threadId: sessionId, model: selection.model, effort: selection.reasoningEffort });
  assert.deepEqual(f.calls[4].params, { threadId: sessionId, clientUserMessageId: commandId, input: [{ type: 'text', text: content, text_elements: [] }] });
  assert.doesNotMatch(JSON.stringify(f.calls), /approvalPolicy|sandboxPolicy|permissions|collaborationMode|turn\/start/);
});

test('removed models and unsupported efforts never change settings or send work', async (t) => {
  const f = await fixture(t);
  for (const value of [{ ...selection, model: 'missing' }, { ...selection, reasoningEffort: 'ultra' }]) {
    assert.equal((await sendConfiguredCommand(f.options, sessionId, 'work', value, commandId)).code, 'MODEL_UNAVAILABLE');
  }
  assert.ok(f.calls.every((entry) => !entry.method.startsWith('thread/')));
});

test('settings rejection and lost settings acknowledgement never enqueue a command', async (t) => {
  for (const reject of [true, false]) {
    const f = await fixture(t, (message) => message.method === 'thread/settings/update' ? reject ? { error: { code: -32601, message: 'private error' } } : false : undefined);
    const result = await sendConfiguredCommand(f.options, sessionId, 'private work', selection, commandId);
    assert.equal(result.status, 'failed');
    assert.equal(result.code, reject ? 'SETTINGS_REJECTED' : 'SETTINGS_UNCERTAIN');
    assert.ok(!f.calls.some((entry) => entry.method === 'thread/queue/add'));
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
});

test('queue rejection and missing queue acknowledgement retain confirmed settings without claiming work completed', async (t) => {
  for (const reject of [true, false]) {
    const f = await fixture(t, (message) => message.method === 'thread/queue/add' ? reject ? { error: { code: -1 } } : false : undefined);
    const result = await sendConfiguredCommand(f.options, sessionId, 'work', selection, commandId);
    assert.equal(result.status, reject ? 'failed' : 'unknown');
    assert.equal(result.settingsApplied, true);
    assert.equal(f.calls.filter((entry) => entry.method === 'thread/queue/add').length, 1);
  }
});

test('turning command permission off during settings application prevents queue submission', async (t) => {
  let allowed = true;
  const f = await fixture(t, (message) => { if (message.method === 'thread/settings/update') allowed = false; });
  const result = await sendConfiguredCommand({ ...f.options, maySend: () => allowed }, sessionId, 'work', selection, commandId);
  assert.deepEqual(result, { status: 'expired', code: 'BRIDGE_RESTARTED', settingsApplied: true });
  assert.ok(!f.calls.some((entry) => entry.method === 'thread/queue/add'));
});

test('model catalogs expire and exclude unadvertised, malformed and private fields', () => {
  const now = Date.now();
  const input = { status: 'ready', updatedAt: new Date(now).toISOString(), models: [
    { id: 'model', name: 'Model', reasoningEfforts: ['high', 'high', 'bad\nvalue'], defaultReasoningEffort: 'high', secret: 'private' },
    { id: 'bad model', reasoningEfforts: ['high'], defaultReasoningEffort: 'high' },
  ] };
  assert.equal(readExecutionOptions(input, true, now).models.length, 1);
  assert.doesNotMatch(JSON.stringify(readExecutionOptions(input, true, now)), /secret|private|bad/);
  assert.equal(readExecutionOptions(input, true, now + 91000).status, 'unavailable');
  assert.deepEqual(readExecutionOptions(input, false, now).models, []);
});

test('observed execution settings use turn metadata only and ignore private context', () => {
  const records = [{ type: 'session_meta', payload: { id: sessionId, cwd: '/workspace' } },
    { type: 'turn_context', timestamp: new Date().toISOString(), payload: { model: 'supported-model', effort: 'high', developer_instructions: 'private context' } },
    { type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_complete' } }];
  const result = summarizeRecords(records, '/workspace');
  assert.equal(result.model, 'supported-model');
  assert.equal(result.reasoningEffort, 'high');
  assert.doesNotMatch(JSON.stringify(result), /private|developer/);
});
