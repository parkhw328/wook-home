import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createDiscovery } from '../../server/discovery.js';
import { createStaffConnections } from '../../server/staff-connections.js';

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
