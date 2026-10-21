import test from 'node:test';
import assert from 'node:assert/strict';
import { collectActivity, connectActivities } from '../../scripts/lib/codex-activity.mjs';
import { readSessionActivity } from '../../server/session-activity.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectSessions } from '../../scripts/lib/codex-observer.mjs';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';

const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';
const outsider = '00000000-0000-0000-0000-000000000003';
const time = Date.parse('2026-10-22T01:00:00Z');
const stamp = (offset = 0) => new Date(time + offset).toISOString();
const record = (type, payload, offset = 0) => ({ type, payload, timestamp: stamp(offset) });
const collaboration = (peer = b, offset = 0) => record('event_msg', { type: 'item_completed', item: {
  type: 'McpToolCall', server: 'codex_tui', tool: 'send_message_to_thread', status: 'completed',
  arguments: { threadId: peer, prompt: 'private-prompt' }, result: { isError: false, content: [{ text: 'private-output' }] },
} }, offset);
const question = (async = false) => record('response_item', { type: 'function_call', name: async ? 'request_user_input_async' : 'request_user_input',
  call_id: 'call-1', arguments: JSON.stringify({ questions: [{ question: 'private-question' }] }) });

test('completed structured cooperation is short lived and never includes prompts, output or unknown tools', () => {
  const activity = collectActivity([collaboration()], () => time + 1000);
  assert.equal(activity.kind, 'collaborating'); assert.equal(activity.phase, 'recent');
  assert.deepEqual(activity.peerSessionIds, [b]);
  assert.doesNotMatch(JSON.stringify(activity), /private/);
  assert.equal(collectActivity([collaboration()], () => time + 60001), null);
  const failed = collaboration(); failed.payload.item.result.isError = true;
  assert.equal(collectActivity([failed], () => time), null);
  assert.equal(collectActivity([record('response_item', { type: 'function_call', name: 'exec', arguments: 'send_message_to_thread private-prompt' })], () => time), null);
  assert.equal(collectActivity([record('response_item', { type: 'message', role: 'assistant', content: [{ text: '회의하자?' }] })], () => time), null);
});

test('sync and async questions clear on actual response, interruption or expiry, never on an async acknowledgement', () => {
  assert.equal(collectActivity([question()], () => time).kind, 'question');
  const output = record('response_item', { type: 'function_call_output', call_id: 'call-1', output: '{}' }, 1);
  assert.equal(collectActivity([question(), output], () => time + 2), null);
  assert.equal(collectActivity([question(true), output], () => time + 2).kind, 'question');
  const reply = record('event_msg', { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text:
    '<send_user_message_question_reply>\n' + JSON.stringify([{ answer: 'private-answer', questionItemId: JSON.stringify(['request_user_input_async', 'call-1', 0]) }]) + '\n</send_user_message_question_reply>' }] } }, 3);
  assert.equal(collectActivity([question(true), reply], () => time + 4), null);
  for (const type of ['task_started', 'task_complete', 'turn_aborted', 'task_interrupted']) {
    assert.equal(collectActivity([question(), record('event_msg', { type }, 1)], () => time + 2), null);
  }
  assert.equal(collectActivity([question(true)], () => time + 1800001), null);
  assert.equal(collectActivity([question(true)], () => time - 6000), null);
});

test('collaboration connects only observed project peers and cannot override a Commander question', () => {
  const one = { id: a, status: 'working', lastActivityAt: stamp(), activity: collectActivity([collaboration(b), collaboration(outsider)], () => time) };
  const two = { id: b, status: 'working', lastActivityAt: stamp() };
  let sessions = connectActivities(structuredClone([one, two]));
  assert.deepEqual(sessions[0].activity.peerSessionIds, [b]);
  assert.deepEqual(sessions[1].activity.peerSessionIds, [a]);
  sessions = connectActivities([structuredClone(one), { ...two, activity: collectActivity([question()], () => time) }]);
  assert.equal(sessions[1].activity.kind, 'question');
  assert.equal(connectActivities([structuredClone(one)])[0].activity, undefined);
  assert.equal(connectActivities([structuredClone(one), { ...two, status: 'idle', lastActivityAt: stamp(1) }])[0].activity, undefined);
});

test('the API boundary strips extras and removes stale, invalid, future or disconnected observations', () => {
  const activity = { ...collectActivity([collaboration()], () => time), prompt: 'private', peerSessionIds: [b, a, outsider, 'bad', b] };
  const one = { id: a, status: 'working', lastActivityAt: stamp(), activity };
  const two = { id: b, status: 'working', lastActivityAt: stamp() };
  const sessions = [one, two, null, { id: outsider, status: 'bad', lastActivityAt: stamp() }];
  const actual = readSessionActivity(one, sessions, true, time);
  assert.deepEqual(actual.peerSessionIds, [b]); assert.doesNotMatch(JSON.stringify(actual), /private/);
  assert.equal(readSessionActivity(one, sessions, false, time), null);
  assert.equal(readSessionActivity(one, sessions, true, time + 60001), null);
  assert.equal(readSessionActivity(one, sessions, true, time - 6000), null);
  assert.equal(readSessionActivity({ ...one, status: 'interrupted' }, sessions, true, time), null);
  assert.equal(readSessionActivity({ ...one, activity: { ...activity, expiresAt: stamp(9999999) } }, sessions, true, time), null);
});

test('selected-project logs reach the HTTP scene as sanitized activity and never enter handoff data', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'wook-activity-'));
  const now = Date.now(); const timestamp = new Date(now).toISOString();
  const sessionDir = join(dir, 'sessions');
  const day = join(sessionDir, ...timestamp.slice(0, 10).split('-'));
  await mkdir(day, { recursive: true });
  const rows = (id, cwd, items) => [{ type: 'session_meta', payload: { id, cwd } },
    { type: 'event_msg', timestamp, payload: { type: 'task_started' } }, ...items.map((item) => ({ ...item, timestamp }))].map(JSON.stringify).join('\n') + '\n';
  await writeFile(join(day, 'rollout-a.jsonl'), rows(a, dir, [collaboration()]));
  await writeFile(join(day, 'rollout-b.jsonl'), rows(b, dir, [question(true)]));
  await writeFile(join(day, 'rollout-other.jsonl'), rows(outsider, join(dir, 'other'), [question()]));
  const snapshot = await collectSessions({ sessionsDir: sessionDir, workspace: dir, clock: () => now });
  assert.equal(snapshot.sessions.length, 2);
  assert.equal(snapshot.sessions.find((item) => item.id === b).activity.kind, 'question');
  const file = join(dir, 'codex.json'); await writeFile(file, JSON.stringify(snapshot));
  const store = createStore(':memory:'); const office = createOffice(store);
  const server = createHttpServer(office, { bridgeFile: file, clock: () => now });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); await rm(dir, { recursive: true, force: true }); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/state`);
  const state = await response.json();
  assert.equal(state.localSessions.activities.enabled, true);
  assert.equal(state.localSessions.sessions.find((item) => item.id === a).activity.kind, 'collaborating');
  assert.doesNotMatch(JSON.stringify(state), /private-|00000000-0000-0000-0000-000000000003/);
  assert.equal(office.handoff().localSessions, undefined);
});
