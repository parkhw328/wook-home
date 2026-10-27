import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createDiscovery } from '../../server/discovery.js';
import { createStaffConnections } from '../../server/staff-connections.js';
import { createHash } from 'node:crypto';

const sessionId = '00000000-0000-0000-0000-000000000001';
const clientId = '00000000-0000-0000-0000-000000000002';
const initialTime = Date.parse('2026-10-22T01:00:00Z');

function fixture(t) {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const office = createOffice(store);
  let time = initialTime;
  const local = { status: 'connected', workspace: 'fixture-project', sessions: [{ id: sessionId, name: 'Codex', provider: 'openai', status: 'idle', lastActivityAt: new Date(time).toISOString() }], control: { enabled: true },
    processes: { status: 'connected', items: [{ id: 'process-instance', name: 'Claude Code', provider: 'claude', status: 'running' }] } };
  const discovery = createDiscovery({ observer: { snapshot: () => structuredClone(local) }, clock: () => time });
  const staff = createStaffConnections({ office, discovery });
  const tabs = [
    { id: '1', provider: 'openai', kind: 'conversation', key: 'a'.repeat(64) },
    { id: '2', provider: 'openai', kind: 'conversation', key: 'a'.repeat(64) },
    { id: '3', provider: 'claude', kind: 'page', key: 'b'.repeat(64) },
    { id: '4', provider: 'gemini', kind: 'conversation', key: 'c'.repeat(64) },
    { id: '5', provider: 'meta', kind: 'page', key: 'd'.repeat(64) },
  ];
  const publish = (value = tabs) => discovery.receive({ schemaVersion: 1, clientId, observedAt: new Date(time).toISOString(), truncated: false, tabs: value });
  publish();
  const hire = (entry) => staff.hire({ entryId: entry.id, name: '검증 직원', role: '문서 검토' });
  return { store, office, discovery, staff, local, tabs, publish, hire, tick(ms = 1000) { time += ms; } };
}

test('all web providers can register employees while duplicate tabs bind only one employee and never enable commands', (t) => {
  const f = fixture(t);
  const entries = f.staff.discoverySnapshot().entries.filter((entry) => entry.source === 'web');
  for (const entry of entries) {
    assert.equal(entry.canRegister, true);
    const agent = f.hire(entry);
    assert.equal(agent.provider, entry.provider);
    assert.equal(agent.status, 'observing');
    assert.equal(agent.connection.status, 'connected');
    assert.equal(agent.connection.canControl, false);
    assert.equal(agent.connection.sessionId, undefined);
    assert.throws(() => f.hire(entry), { code: 'ENTRY_ALREADY_LINKED' });
    assert.throws(() => f.office.assign({ agentId: agent.id, title: '웹 실행 시도' }), { code: 'PROVIDER_UNAVAILABLE' });
    const linked = f.staff.discoverySnapshot().entries.find((item) => item.id === entry.id);
    assert.equal(linked.canRegister, false);
    assert.equal(linked.linkedAgentId, agent.id);
  }
  assert.equal(f.office.snapshot().agents.length, 4);
  assert.equal(f.staff.snapshot().agents.find((agent) => agent.provider === 'openai').connection.tabCount, 2);
});

test('CLI records carry the actual session command capability, processes never borrow it, and office pause disables commands only', (t) => {
  const f = fixture(t);
  const record = f.hire(f.staff.discoverySnapshot().entries.find((entry) => entry.kind === 'session'));
  const process = f.hire(f.staff.discoverySnapshot().entries.find((entry) => entry.kind === 'process'));
  assert.equal(record.connection.canControl, true);
  assert.equal(record.connection.sessionId, sessionId);
  assert.equal(process.connection.canControl, false);
  assert.equal(process.connection.sessionId, undefined);
  f.office.pause({});
  assert.equal(f.staff.snapshot().agents[0].connection.canControl, false);
  assert.equal(f.staff.snapshot().agents[0].status, 'observing');
  f.office.resume({});
  f.local.control.enabled = false;
  assert.equal(f.staff.snapshot().agents[0].connection.canControl, false);
  f.local.processes.items[0].status = 'exited';
  assert.equal(f.staff.snapshot().agents[1].connection.status, 'ended');
});

test('closed tabs, disconnected observations and recovery update the same employee without registering again', (t) => {
  const f = fixture(t);
  const entry = f.staff.discoverySnapshot().entries.find((item) => item.source === 'web' && item.provider === 'openai');
  const agent = f.hire(entry);
  f.tick(); f.publish(f.tabs.filter((tab) => tab.provider !== 'openai'));
  assert.equal(f.staff.snapshot().agents[0].connection.status, 'missing');
  f.tick(); f.publish();
  assert.equal(f.staff.snapshot().agents[0].connection.status, 'connected');
  f.tick(91000);
  assert.equal(f.staff.snapshot().agents[0].connection.status, 'disconnected');
  assert.equal(f.staff.discoverySnapshot().entries.find((item) => item.id === entry.id).canRegister, false);
  f.tick(); f.publish();
  assert.equal(f.staff.snapshot().agents[0].id, agent.id);
  assert.equal(f.office.snapshot().agents.length, 1);
});

test('link validation rejects stale targets, mismatched providers, unknown IDs and client-supplied capabilities atomically', (t) => {
  const f = fixture(t);
  const web = f.staff.discoverySnapshot().entries.find((entry) => entry.source === 'web' && entry.provider === 'openai');
  const claude = f.office.hire({ name: 'Claude 직원', role: '검토', provider: 'claude' });
  assert.throws(() => f.staff.connect(claude.id, { entryId: web.id }), { code: 'PROVIDER_MISMATCH' });
  assert.throws(() => f.staff.hire({ entryId: web.id, name: '직원', role: '검토', canControl: true }), { code: 'INVALID_STAFF_CONNECTION' });
  assert.throws(() => f.staff.hire({ entryId: 'missing', name: '직원', role: '검토' }), { code: 'ENTRY_UNAVAILABLE' });
  assert.throws(() => f.staff.hire({ entryId: web.id, name: '', role: '검토' }), { code: 'VALIDATION_ERROR' });
  assert.equal(f.staff.discoverySnapshot().entries.find((entry) => entry.id === web.id).canRegister, true);
  f.local.status = 'disconnected';
  assert.throws(() => f.staff.hire({ entryId: `cli:${sessionId}`, name: '직원', role: '검토' }), { code: 'ENTRY_UNAVAILABLE' });
  f.tick(91000);
  assert.throws(() => f.hire(web), { code: 'ENTRY_UNAVAILABLE' });
  assert.equal(f.office.snapshot().agents.length, 1);
});

test('existing employees can reconnect and detach without deleting the employee or closing the observed source', (t) => {
  const f = fixture(t);
  const entries = f.staff.discoverySnapshot().entries;
  const cli = entries.find((entry) => entry.kind === 'session');
  const web = entries.find((entry) => entry.source === 'web' && entry.provider === 'openai');
  const agent = f.hire(cli);
  f.staff.connect(agent.id, { entryId: web.id });
  assert.equal(f.staff.discoverySnapshot().entries.find((entry) => entry.id === cli.id).canRegister, true);
  assert.equal(f.staff.snapshot().agents[0].connection.source, 'web');
  f.staff.disconnect(agent.id);
  assert.equal(f.staff.snapshot().agents[0].connection, undefined);
  assert.equal(f.staff.discoverySnapshot().entries.find((entry) => entry.id === web.id).canRegister, true);
  assert.equal(f.discovery.snapshot().counts.webTabs, 5);
  assert.equal(f.office.snapshot().agents.length, 1);
});

test('restart preserves employee identity but not observed IDs, browser details or live capabilities; handoff excludes all link metadata', (t) => {
  const f = fixture(t);
  const web = f.staff.discoverySnapshot().entries.find((entry) => entry.source === 'web');
  const agent = f.hire(web);
  const persisted = JSON.stringify(f.store.load());
  assert.doesNotMatch(persisted, /web:|cli:|tabCount|entryId|fixture-project|00000000-|[a-d]{64}/);
  const handoff = JSON.stringify(f.office.handoff());
  assert.doesNotMatch(handoff, /connectionPreference|connection|browser|web:|00000000-|[a-d]{64}/);
  const office = createOffice(f.store);
  const restarted = createStaffConnections({ office, discovery: f.discovery });
  const after = restarted.snapshot().agents[0];
  assert.equal(after.id, agent.id);
  assert.equal(after.connection.status, 'not_connected');
  assert.equal(after.connection.canControl, false);
  assert.equal(after.connection.entryId, undefined);
  restarted.connect(agent.id, { entryId: web.id });
  assert.equal(restarted.snapshot().agents[0].connection.status, 'connected');
});

test('three live sessions with identical prefix and suffix auto-register once; aliases remain attached after restart', (t) => {
  const f = fixture(t);
  const ids = ['1111', '2222', '3333'].map((middle) => `00000000-${middle}-4000-8000-000000000001`);
  f.local.sessions = ids.map((id) => ({ ...f.local.sessions[0], id, lifecycle: 'live' }));
  const agents = f.staff.snapshot().agents;
  assert.equal(agents.length, 3);
  assert.deepEqual(agents.map((agent) => agent.connection.sessionId), ids);
  for (const agent of agents) f.staff.edit(agent.id, { name: '동일 별칭', settingsRevision: agent.settingsRevision });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(f.staff.snapshot().agents.length, 3);
    assert.ok(f.staff.discoverySnapshot().entries.filter((entry) => entry.kind === 'session').every((entry) => !entry.canRegister));
  }
  assert.throws(() => f.staff.hire({ entryId: `cli:${ids[0]}`, name: '중복', role: '검증' }), { code: 'ENTRY_ALREADY_LINKED' });
  const restarted = createStaffConnections({ office: createOffice(f.store), discovery: f.discovery });
  assert.deepEqual(restarted.snapshot().agents.map((agent) => [agent.id, agent.name, agent.connection.sessionId]),
    agents.map((agent, index) => [agent.id, '동일 별칭', ids[index]]));
  const persisted = JSON.stringify(f.store.load());
  const exported = JSON.stringify(f.office.handoff());
  const snapshot = JSON.stringify(restarted.snapshot());
  assert.doesNotMatch(exported, /sessionRegistry|connectionPreference/);
  for (const id of ids) {
    assert.ok(!persisted.includes(id) && !exported.includes(id));
    const key = createHash('sha256').update(`openai:${id}`).digest('hex');
    assert.ok(persisted.includes(key));
    assert.ok(!exported.includes(key) && !snapshot.includes(key));
  }
});

test('saved activity, process counts, stale bridge and missing liveness never auto-register employees', (t) => {
  const f = fixture(t);
  for (const lifecycle of [undefined, 'unknown', 'not_loaded']) {
    f.local.sessions[0].lifecycle = lifecycle;
    f.local.sessions[0].status = 'working';
    assert.equal(f.staff.snapshot().agents.length, 0);
  }
  f.local.sessions[0].lifecycle = 'live';
  f.local.status = 'disconnected';
  assert.equal(f.staff.snapshot().agents.length, 0);
  f.local.status = 'connected';
  f.local.control.enabled = false;
  const agent = f.staff.snapshot().agents[0];
  assert.equal(agent.connection.canControl, false, 'registration grants no command permission');
  f.local.sessions[0].lifecycle = 'not_loaded';
  assert.equal(f.staff.snapshot().agents[0].id, agent.id, 'unloading retains the employee and alias');
  f.local.sessions = [];
  assert.equal(f.staff.snapshot().agents[0].connection.status, 'missing');
  assert.equal(f.staff.snapshot().agents[0].connection.sessionId, sessionId, 'last known full identity remains visible');
});

test('release and disconnect stay opted out after restart until explicit registration or reconnection', (t) => {
  for (const action of ['release', 'disconnect']) {
    const f = fixture(t);
    f.local.sessions[0].lifecycle = 'live';
    const agent = f.staff.snapshot().agents[0];
    f.staff[action](agent.id, { settingsRevision: agent.settingsRevision });
    const office = createOffice(f.store);
    const restarted = createStaffConnections({ office, discovery: f.discovery });
    const entry = restarted.discoverySnapshot().entries.find((item) => item.kind === 'session');
    assert.equal(entry.canRegister, true);
    assert.equal(restarted.snapshot().agents.length, action === 'release' ? 0 : 1);
    if (action === 'release') restarted.hire({ entryId: entry.id, name: '직접 등록', role: '검증' });
    else restarted.connect(agent.id, { entryId: entry.id, settingsRevision: office.snapshot().agents[0].settingsRevision });
    assert.equal(restarted.discoverySnapshot().entries.find((item) => item.id === entry.id).canRegister, false);
  }
});

test('manual connection replacement suppresses the previous session and stale edits cannot erase that choice', (t) => {
  const f = fixture(t);
  f.local.sessions[0].lifecycle = 'live';
  const agent = f.staff.snapshot().agents[0];
  const other = { ...f.local.sessions[0], id: sessionId.replace(/1$/, '3'), lifecycle: 'unknown' };
  f.local.sessions.push(other);
  f.staff.connect(agent.id, { entryId: `cli:${other.id}`, settingsRevision: agent.settingsRevision });
  assert.throws(() => f.staff.disconnect(agent.id, { settingsRevision: agent.settingsRevision }), { code: 'SETTINGS_CONFLICT' });
  other.lifecycle = 'live';
  const restarted = createStaffConnections({ office: createOffice(f.store), discovery: f.discovery });
  const snapshot = restarted.snapshot();
  assert.equal(snapshot.agents.length, 1);
  assert.equal(snapshot.agents[0].connection.sessionId, other.id);
  assert.equal(restarted.discoverySnapshot().entries.find((entry) => entry.sessionId === sessionId).canRegister, true);
});

test('full staff roster leaves live targets available for manual registration without breaking state reads', (t) => {
  const f = fixture(t);
  for (let i = 0; i < 100; i += 1) f.office.hire({ name: `체험 ${i}`, role: '검증', provider: 'demo' });
  f.local.sessions[0].lifecycle = 'live';
  assert.equal(f.staff.snapshot().agents.length, 100);
  assert.equal(f.staff.discoverySnapshot().entries.find((entry) => entry.kind === 'session').canRegister, true);
});

test('restart without live evidence retains known identity for display but reserves the existing employee for explicit reconnect', (t) => {
  const f = fixture(t);
  const agent = f.hire(f.staff.discoverySnapshot().entries.find((entry) => entry.kind === 'session'));
  const office = createOffice(f.store);
  const restarted = createStaffConnections({ office, discovery: f.discovery });
  const before = restarted.snapshot().agents[0];
  assert.equal(before.id, agent.id);
  assert.equal(before.connection.sessionId, sessionId);
  assert.equal(before.connection.status, 'not_connected');
  assert.equal(before.connection.canControl, false);
  const entry = restarted.discoverySnapshot().entries.find((item) => item.kind === 'session');
  assert.equal(entry.linkedAgentId, agent.id);
  assert.equal(entry.canRegister, false);
  assert.throws(() => restarted.hire({ entryId: entry.id, name: '중복', role: '검증' }), { code: 'ENTRY_ALREADY_LINKED' });
  restarted.connect(agent.id, { entryId: entry.id, settingsRevision: before.settingsRevision });
  assert.equal(restarted.snapshot().agents[0].connection.status, 'connected');
});

test('reconnecting a live archived employee preserves the alias, archive and command restriction', (t) => {
  const f = fixture(t);
  f.local.sessions[0].lifecycle = 'live';
  const agent = f.staff.snapshot().agents[0];
  f.staff.archive(agent.id, { stored: true, note: '다음 검토', settingsRevision: agent.settingsRevision });
  const restarted = createStaffConnections({ office: createOffice(f.store), discovery: f.discovery });
  const after = restarted.snapshot().agents[0];
  assert.equal(after.id, agent.id);
  assert.equal(after.name, agent.name);
  assert.equal(after.workArchive.stored, true);
  assert.equal(after.workArchive.note, '다음 검토');
  assert.equal(after.connection.lifecycle, 'live');
  assert.equal(after.connection.canControl, false);
});
