import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'office-staff-settings-'));
  const store = createStore(directory);
  const office = createOffice(store);
  const sessionId = randomUUID();
  const snapshot = { schemaVersion: 1, workspace: 'actual-project', generatedAt: new Date().toISOString(),
    sessions: [{ id: sessionId, status: 'idle', lastActivityAt: new Date().toISOString(), model: 'last-model', reasoningEffort: 'low' }],
    control: { enabled: true, bridgeId: randomUUID() },
    execution: { status: 'ready', updatedAt: new Date().toISOString(), models: [{ id: 'verified-model', name: 'Verified', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' }] } };
  const bridgeFile = join(directory, 'codex.json');
  const publish = () => writeFileSync(bridgeFile, JSON.stringify(snapshot));
  publish();
  const commandsDir = join(directory, 'commands');
  const server = createHttpServer(office, { bridgeFile, commandsDir });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const agent = (await request('/agents/from-discovery', 'POST', { entryId: `cli:${sessionId}`, name: '개발 담당', role: '개발', projectName: '제품 A' })).body;
  return { directory, store, office, request, agent, snapshot, publish, sessionId, commandsDir };
}

test('legacy schema gets unassigned defaults without replacing employee identity or task history', (t) => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const original = createOffice(store);
  const agent = original.hire({ name: '기존 직원', role: '검토', provider: 'demo' });
  const task = original.assign({ agentId: agent.id, title: '기존 업무' });
  const legacy = store.load();
  delete legacy.agents[0].projectName;
  delete legacy.agents[0].executionPreference;
  delete legacy.agents[0].settingsRevision;
  store.save(legacy);
  const restored = createOffice(store).snapshot();
  assert.equal(restored.agents[0].id, agent.id);
  assert.equal(restored.agents[0].projectName, '');
  assert.equal(restored.agents[0].executionPreference, null);
  assert.equal(restored.agents[0].settingsRevision, 0);
  assert.equal(restored.tasks[0].id, task.id);
  assert.equal(restored.tasks[0].status, 'paused');
});

test('project and verified defaults persist independently of observed execution and do not queue work on save', async (t) => {
  const f = await fixture(t);
  const preference = { model: 'verified-model', reasoningEffort: 'high' };
  const saved = await f.request(`/agents/${f.agent.id}`, 'PATCH', { projectName: '  제품 B  ', executionPreference: preference, settingsRevision: 0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.projectName, '제품 B');
  assert.equal(saved.body.connection.scope, 'actual-project');
  assert.deepEqual(saved.body.executionPreference, preference);
  assert.equal(saved.body.settingsRevision, 1);
  const state = (await f.request('/state')).body;
  assert.equal(state.localSessions.sessions[0].model, 'last-model');
  assert.equal(state.localSessions.sessions[0].reasoningEffort, 'low');
  assert.ok(!readdirSync(f.directory).includes('commands'));
  const restored = createOffice(f.store).snapshot().agents[0];
  assert.equal(restored.projectName, '제품 B');
  assert.deepEqual(restored.executionPreference, preference);
  assert.doesNotMatch(JSON.stringify(f.office.handoff()), /actual-project|last-model|sessionId|entryId/);
});

test('unadvertised defaults, observation-only providers and malformed projects fail atomically', async (t) => {
  const f = await fixture(t);
  for (const body of [
    { executionPreference: { model: 'not-advertised', reasoningEffort: 'high' } },
    { executionPreference: { model: 'verified-model', reasoningEffort: 'ultra' } },
    { executionPreference: { model: 'verified-model' } },
    { projectName: 'x'.repeat(81) }, { projectName: 'line\nbreak' }, { projectName: 4 },
  ]) {
    const response = await f.request(`/agents/${f.agent.id}`, 'PATCH', { name: 'must-not-change', ...body });
    assert.ok([400, 409].includes(response.status));
    assert.equal(f.office.snapshot().agents[0].name, '개발 담당');
  }
  for (const provider of ['openai', 'claude', 'gemini', 'meta', 'demo']) {
    const agent = f.office.hire({ name: '연결 전', role: '검토', provider });
    const result = await f.request(`/agents/${agent.id}`, 'PATCH', { projectName: 'reject-this', executionPreference: { model: 'verified-model', reasoningEffort: 'high' } });
    assert.equal(result.status, 409);
    assert.equal(f.office.snapshot().agents.find((item) => item.id === agent.id).projectName, '');
    assert.equal((await f.request(`/agents/${agent.id}`, 'PATCH', { projectName: '담당 지정' })).status, 200);
  }
});

test('stale editors cannot overwrite project settings or a replaced connection', async (t) => {
  const f = await fixture(t);
  const path = `/agents/${f.agent.id}`;
  assert.equal((await f.request(path, 'PATCH', { projectName: 'new', settingsRevision: 0 })).status, 200);
  const conflict = await f.request(path, 'PATCH', { projectName: 'stale', settingsRevision: 0 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'SETTINGS_CONFLICT');
  await f.request(`${path}/connection`, 'DELETE');
  assert.equal((await f.request(path, 'PATCH', { projectName: 'other', settingsRevision: 1 })).status, 409);
  assert.equal(f.office.snapshot().agents[0].projectName, 'new');
});

test('disconnected staff retain their assignment and defaults, allow assignment edits and clearing without inventing control', async (t) => {
  const f = await fixture(t);
  const path = `/agents/${f.agent.id}`;
  const preference = { model: 'verified-model', reasoningEffort: 'high' };
  await f.request(path, 'PATCH', { executionPreference: preference });
  f.snapshot.stopped = true; f.publish();
  const changed = await f.request(path, 'PATCH', { projectName: '새 담당', executionPreference: preference });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.connection.canControl, false);
  assert.equal(changed.body.projectName, '새 담당');
  assert.deepEqual(changed.body.executionPreference, preference);
  const refused = await f.request(path, 'PATCH', { executionPreference: { model: 'verified-model', reasoningEffort: 'low' } });
  assert.equal(refused.status, 409);
  const clear = await f.request(path, 'PATCH', { projectName: '', executionPreference: null });
  assert.equal(clear.status, 200);
  assert.equal(clear.body.projectName, '');
  assert.equal(clear.body.executionPreference, null);
});

test('stored preferences sent by the composer use existing validated idempotent command queue', async (t) => {
  const f = await fixture(t);
  const saved = (await f.request(`/agents/${f.agent.id}`, 'PATCH', { executionPreference: { model: 'verified-model', reasoningEffort: 'high' } })).body;
  const body = { id: randomUUID(), content: 'fixture instruction', ...saved.executionPreference };
  const receipt = await f.request(`/local-sessions/${f.sessionId}/commands`, 'POST', body);
  assert.equal(receipt.status, 202);
  assert.equal(receipt.body.status, 'pending');
  assert.equal(receipt.body.settingsApplied, false);
  assert.equal((await f.request(`/local-sessions/${f.sessionId}/commands`, 'POST', body)).body.id, body.id);
  assert.equal(readdirSync(f.commandsDir).length, 1);
  f.snapshot.execution.models = []; f.publish();
  assert.equal((await f.request(`/local-sessions/${f.sessionId}/commands`, 'POST', { ...body, id: randomUUID() })).status, 409);
});
