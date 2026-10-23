import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';
import { createStaffConnections } from '../../server/staff-connections.js';
import { createDiscovery } from '../../server/discovery.js';

function fixture(t) {
  const store = createStore(':memory:');
  t.after(() => store.close());
  return { store, office: createOffice(store) };
}

test('release blocks unfinished and paused work, preserves completed reports across restart, and restores identity', (t) => {
  const { store, office } = fixture(t);
  const agent = office.hire({ name: '보고 담당', role: '검증', provider: 'demo' });
  const task = office.assign({ agentId: agent.id, title: '보고 보존' });
  assert.throws(() => office.releaseAgent(agent.id, { settingsRevision: 0 }), { code: 'AGENT_BUSY' });
  office.pause({});
  assert.throws(() => office.releaseAgent(agent.id, { settingsRevision: 0 }), { code: 'AGENT_BUSY' });
  office.resume({});
  office.answer(task.id, { content: '확인' }); office.approve(task.id, {});
  const before = office.snapshot().tasks;
  office.releaseAgent(agent.id, { settingsRevision: 0 });
  assert.equal(office.snapshot().agents.length, 0);
  assert.deepEqual(office.snapshot().tasks, before);
  assert.throws(() => office.releaseAgent(agent.id, { settingsRevision: 0 }), { code: 'NOT_FOUND' });
  const restarted = createOffice(store);
  assert.equal(restarted.snapshot().releasedAgents[0].name, '보고 담당');
  assert.throws(() => restarted.restoreAgent(agent.id, { settingsRevision: 0 }), { code: 'SETTINGS_CONFLICT' });
  const restored = restarted.restoreAgent(agent.id, { settingsRevision: 1 });
  assert.equal(restored.id, agent.id); assert.equal(restored.status, 'idle');
  assert.equal(restarted.snapshot().releasedAgents.length, 0);
  assert.deepEqual(restarted.snapshot().tasks, before);
});

test('releasing a linked archived employee frees the discovery entry and preserves local notes without restoring the connection', (t) => {
  const { office, store } = fixture(t);
  const id = '00000000-0000-4000-8000-000000000001';
  const observer = { snapshot: () => ({ status: 'connected', sessions: [{ id, name: '검증 세션', provider: 'openai', status: 'idle' }], control: { enabled: true } }) };
  const discovery = createDiscovery({ observer });
  const staff = createStaffConnections({ office, observer, discovery });
  const agent = staff.archiveSession(id, { note: '남은 일 보존' });
  staff.release(agent.id, { settingsRevision: 0 });
  assert.equal(staff.discoverySnapshot().entries[0].canRegister, true);
  assert.equal(staff.isArchivedSession(id), false);
  assert.doesNotMatch(JSON.stringify(store.load()), new RegExp(id));
  assert.equal(office.snapshot().releasedAgents[0].workArchive.note, '남은 일 보존');
  assert.doesNotMatch(JSON.stringify(office.handoff()), /남은 일 보존|workArchive/);
  const restored = staff.restore(agent.id, { settingsRevision: 1 });
  assert.equal(restored.connection, undefined);
  assert.equal(restored.workArchive.stored, true);
  assert.equal(staff.discoverySnapshot().entries[0].canRegister, true);
});

test('release and restore HTTP reject foreign origins, stale versions and unsupported fields', async (t) => {
  const { office } = fixture(t);
  const agent = office.hire({ name: '검증', role: '검증', provider: 'openai' });
  const server = createHttpServer(office);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (action, body, origin = base) => fetch(`${base}/api/agents/${agent.id}/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await call('release', { settingsRevision: 0 }, 'https://invalid.test')).status, 403);
  assert.equal((await call('release', { settingsRevision: 0, deleteWork: true })).status, 400);
  assert.equal((await call('release', {})).status, 400);
  assert.equal((await call('release', { settingsRevision: 8 })).status, 409);
  assert.equal((await call('release', { settingsRevision: 0 })).status, 200);
  assert.equal((await call('restore', { settingsRevision: 1 })).status, 200);
  assert.equal((await call('restore', { settingsRevision: 1 })).status, 404);
});
