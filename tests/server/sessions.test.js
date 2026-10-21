import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionObserver } from '../../server/sessions.js';
import { collectSessions, summarizeRecords } from '../../scripts/lib/codex-observer.mjs';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';

const id = '00000000-0000-0000-0000-000000000001';
const timestamp = '2026-10-21T12:00:00.000Z';
const current = Date.parse(timestamp);
const event = (type) => ({ type: 'event_msg', timestamp, payload: { type, text: 'private-user-message' } });
const records = (workspace) => [
  { type: 'session_meta', payload: { id, cwd: workspace, creator_user_id: 'private-user', base_instructions: 'private-instructions' } },
  event('task_started'),
  { type: 'response_item', timestamp, payload: { type: 'custom_tool_call', input: 'private-command-token' } },
];

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wook-home-observer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'codex.json');
  const snapshot = {
    schemaVersion: 1, generatedAt: timestamp, workspace: 'test-project',
    sessions: [{ id, status: 'working', lastActivityAt: timestamp }],
  };
  const save = (value = snapshot) => writeFileSync(file, JSON.stringify(value));
  return { directory, file, snapshot, save };
}

test('observer exports only activity kinds from the selected workspace', () => {
  const workspace = join(tmpdir(), 'selected-workspace');
  const input = records(workspace);
  const active = summarizeRecords(input, workspace);
  assert.deepEqual(active, { id, status: 'working', lastActivityAt: timestamp });
  assert.doesNotMatch(JSON.stringify(active), /private-/);
  assert.equal(summarizeRecords(input, join(workspace, 'other-project')), null);
  assert.equal(summarizeRecords([...input, event('task_complete')], workspace).status, 'idle');
  assert.equal(summarizeRecords([...input, event('turn_aborted')], workspace).status, 'interrupted');
  assert.equal(summarizeRecords([input[0]], workspace), null);
});

test('session discovery filters other projects and ignores incomplete JSONL writes', async (t) => {
  const { directory } = fixture(t);
  const sessionDir = join(directory, 'sessions');
  const date = new Date().toISOString().slice(0, 10).split('-');
  const day = join(sessionDir, ...date);
  mkdirSync(day, { recursive: true });
  const workspace = join(directory, 'project');
  const source = records(workspace).map((row) => JSON.stringify(row)).join('\n') + '\n';
  writeFileSync(join(day, 'rollout-selected.jsonl'), source + '{"partial":');
  writeFileSync(join(day, 'rollout-other.jsonl'), records(directory).map(JSON.stringify).join('\n') + '\n');
  const result = await collectSessions({ sessionsDir: sessionDir, workspace });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].status, 'working');
  assert.equal(result.workspace, 'project');
  assert.doesNotMatch(JSON.stringify(result), /private-|creator_user|base_instructions/);
});

test('missing, stale, corrupt and oversized bridge data cannot appear live', (t) => {
  const { file, save, snapshot } = fixture(t);
  let time = current;
  const observer = createSessionObserver({ file, clock: () => time });
  assert.equal(observer.snapshot().status, 'not_connected');
  save();
  assert.equal(observer.snapshot().sessions[0].status, 'working');
  time += 21000;
  assert.equal(observer.snapshot().status, 'disconnected');
  assert.equal(observer.snapshot().sessions[0].status, 'disconnected');
  time = current + 121000;
  save({ ...snapshot, generatedAt: new Date(time).toISOString() });
  assert.equal(observer.snapshot().sessions[0].status, 'unknown');
  writeFileSync(file, '{');
  assert.equal(observer.snapshot().status, 'disconnected');
  writeFileSync(file, 'x'.repeat(65537));
  assert.equal(observer.snapshot().sessions.length, 0);
});

test('bridge reader drops extra fields, duplicate IDs and invalid timestamps', (t) => {
  const { file, save, snapshot } = fixture(t);
  const session = { ...snapshot.sessions[0], name: 'private-name', prompt: 'private-prompt', cwd: 'private-path' };
  save({ ...snapshot, token: 'private-token', sessions: [session, session, { ...session, id: 'invalid' }, { ...session, id: id.replace(/1$/, '2'), lastActivityAt: 'invalid' }] });
  const result = createSessionObserver({ file, clock: () => current }).snapshot();
  assert.equal(result.sessions.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-/);
  assert.equal(result.sessions[0].name, 'Codex · 0001');
});

test('HTTP includes observed sessions without granting control or exporting them in handoff', async (t) => {
  const { file, save } = fixture(t);
  save();
  const store = createStore(':memory:');
  const office = createOffice(store);
  const server = createHttpServer(office, { bridgeFile: file, clock: () => current });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.localSessions.sessions[0].status, 'working');
  assert.equal(state.agents.length, 0);
  office.pause();
  assert.equal((await (await fetch(base + '/api/state')).json()).localSessions.sessions[0].status, 'working');
  office.resume({});
  const control = await fetch(base + '/api/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: id, title: 'cannot control observed session' }),
  });
  assert.equal(control.status, 404);
  assert.equal(office.handoff().localSessions, undefined);
});
