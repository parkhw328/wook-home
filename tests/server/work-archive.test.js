import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createDiscovery } from '../../server/discovery.js';
import { createStaffConnections } from '../../server/staff-connections.js';
import { createHttpServer } from '../../server/http.js';

const id = '00000000-0000-4000-8000-000000000001';
function fixture(t) {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const office = createOffice(store);
  const local = { status: 'connected', sessions: [{ id, name: '검증 업무', provider: 'openai', status: 'idle' }], control: { enabled: true } };
  const observer = { snapshot: () => structuredClone(local) };
  const discovery = createDiscovery({ observer });
  const staff = createStaffConnections({ office, observer, discovery });
  return { store, office, local, observer, discovery, staff };
}

test('archive survives observation loss and restart without storing live identifiers or exporting notes', (t) => {
  const f = fixture(t);
  f.local.status = 'disconnected';
  const agent = f.staff.archiveSession(id, { note: '남은 검증을 이어갑니다.' });
  assert.equal(agent.workArchive.stored, true);
  assert.equal(agent.connection.status, 'disconnected');
  assert.equal(agent.connection.canControl, false);
  assert.throws(() => f.staff.archiveSession(id, { note: 'duplicate' }), { code: 'ENTRY_ALREADY_LINKED' });
  assert.doesNotMatch(JSON.stringify(f.store.load()), new RegExp(id));
  assert.doesNotMatch(JSON.stringify(f.office.handoff()), /workArchive|남은 검증|connectionPreference/);
  f.local.sessions = [];
  assert.equal(f.staff.snapshot().agents.length, 1);
  const restarted = createOffice(f.store);
  const staff = createStaffConnections({ office: restarted, observer: f.observer, discovery: f.discovery });
  const recovered = staff.snapshot().agents[0];
  assert.equal(recovered.workArchive.note, agent.workArchive.note);
  assert.equal(recovered.connection.status, 'not_connected');
  assert.equal(recovered.connection.sessionId, undefined);
});

test('archive and reconnect retain notes, use revision conflicts and require explicit restore before commands', (t) => {
  const f = fixture(t);
  const agent = f.staff.archiveSession(id, { note: '<script>inert note</script>' });
  assert.equal(f.staff.isArchivedSession(id), true);
  assert.equal(agent.connection.canControl, false);
  const linked = f.staff.connect(agent.id, { entryId: `cli:${id}` });
  assert.equal(linked.workArchive.stored, true);
  assert.throws(() => f.staff.archive(agent.id, { stored: false, note: 'old', settingsRevision: agent.settingsRevision }), { code: 'SETTINGS_CONFLICT' });
  const restored = f.staff.archive(agent.id, { stored: false, note: agent.workArchive.note, settingsRevision: linked.settingsRevision });
  assert.equal(restored.connection.canControl, true);
  assert.equal(restored.workArchive.note, agent.workArchive.note);
  assert.equal(f.staff.isArchivedSession(id), false);
  assert.equal(f.office.snapshot().tasks.length, 0);
  assert.throws(() => f.staff.archive(agent.id, { stored: true, note: 'x'.repeat(4001), settingsRevision: restored.settingsRevision }), { code: 'VALIDATION_ERROR' });
  assert.equal(f.staff.snapshot().agents[0].workArchive.stored, false);
});

test('archive HTTP validates origin, revision, employee type and payload', async (t) => {
  const f = fixture(t);
  const agent = f.office.hire({ name: '보관 검증', role: '검토', provider: 'openai' });
  const demo = f.office.hire({ name: '체험', role: '검토', provider: 'demo' });
  const server = createHttpServer(f.office);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (employee, body, origin = base) => fetch(`${base}/api/agents/${employee}/archive`, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const body = { stored: true, note: '다음 행동', settingsRevision: 0 };
  assert.equal((await put(agent.id, body, 'https://invalid.test')).status, 403);
  assert.equal((await put(demo.id, body)).status, 409);
  assert.equal((await put(agent.id, { ...body, sessionId: id })).status, 400);
  assert.equal((await put(agent.id, body)).status, 200);
  assert.equal((await put(agent.id, body)).status, 409);
  assert.equal((await put(agent.id, { ...body, stored: false, settingsRevision: 1 })).status, 200);
});
