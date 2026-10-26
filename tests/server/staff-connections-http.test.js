import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';

test('real discovery → registration → state → reconnect HTTP flow enforces origin and separates web observation from task execution', async (t) => {
  const store = createStore(':memory:');
  const office = createOffice(store);
  const server = createHttpServer(office);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, origin = base) => fetch(`${base}/api${path}`, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  await request('/discovery/browser', 'POST', { schemaVersion: 1, clientId: '00000000-0000-0000-0000-000000000001', observedAt: new Date().toISOString(), truncated: false, tabs: [
    { id: '1', provider: 'gemini', kind: 'page', key: 'a'.repeat(64) },
    { id: '2', provider: 'gemini', kind: 'page', key: 'b'.repeat(64) },
  ] });
  const [entry, alternate] = (await (await request('/discovery')).json()).entries;
  const body = { entryId: entry.id, name: '한국어 직원', role: '문서 검토' };
  assert.equal((await request('/agents/from-discovery', 'POST', body, 'https://gemini.google.com')).status, 403);
  const created = await request('/agents/from-discovery', 'POST', body);
  assert.equal(created.status, 201);
  const agent = await created.json();
  assert.equal(agent.name, '한국어 직원');
  assert.equal(agent.connection.canControl, false);
  assert.equal((await request('/agents/from-discovery', 'POST', body)).status, 409);
  const state = await (await request('/state')).json();
  assert.equal(state.agents.length, 1);
  assert.equal(state.agents[0].connection.source, 'web');
  assert.equal((await request('/tasks', 'POST', { agentId: agent.id, title: '자동 실행' })).status, 409);
  assert.equal((await request(`/agents/${agent.id}/connection`, 'DELETE', undefined, 'https://untrusted.invalid')).status, 403);
  assert.equal((await request(`/agents/${agent.id}/connection`, 'DELETE')).status, 200);
  assert.equal((await request(`/agents/${agent.id}/connection`, 'PUT', { entryId: entry.id })).status, 200);
  const linked = (await (await request('/discovery')).json()).entries[0];
  assert.equal(linked.linkedAgentId, agent.id);
  assert.equal(linked.canRegister, false);
  assert.doesNotMatch(await (await request('/handoff')).text(), /connection|entryId|web:|00000000-/);

  // A stale detail/connection window must not detach or replace a newer choice.
  const path = `/agents/${agent.id}/connection`;
  assert.equal((await request(path, 'PUT', { entryId: entry.id, settingsRevision: 2 })).status, 200);
  for (const method of ['PUT', 'DELETE']) {
    const conflict = await request(path, method, { ...(method === 'PUT' ? { entryId: alternate.id } : {}), settingsRevision: 2 });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'SETTINGS_CONFLICT');
  }
  for (const revision of [null, -1, '3', 1.5]) {
    assert.equal((await request(path, 'DELETE', { settingsRevision: revision })).status, 400);
  }
  assert.equal((await request(path, 'DELETE', { settingsRevision: 3, ignored: true })).status, 400);
  const unchanged = (await (await request('/state')).json()).agents[0];
  assert.equal(unchanged.settingsRevision, 3);
  assert.equal(unchanged.connection.entryId, entry.id);
  assert.equal((await request(path, 'DELETE', { settingsRevision: 3 })).status, 200);
  assert.equal((await (await request('/discovery')).json()).entries[0].canRegister, true);
});
