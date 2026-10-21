import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscovery } from '../../server/discovery.js';

const id = '00000000-0000-0000-0000-000000000001';
const client = '00000000-0000-0000-0000-000000000002';
const now = Date.parse('2026-10-21T12:00:00Z');
const tab = (id = '1') => ({ id, provider: 'claude', kind: 'conversation', key: 'a'.repeat(64) });
const snapshot = (tabs = [tab()], time = now) => ({ schemaVersion: 1, clientId: client, observedAt: new Date(time).toISOString(), truncated: false, tabs });
const observer = { snapshot: () => ({ status: 'connected', workspace: 'project', updatedAt: new Date(now).toISOString(),
  sessions: [{ id, name: 'Codex · 0001', provider: 'openai', status: 'idle', lastActivityAt: new Date(now).toISOString() }],
  control: { enabled: true },
  processes: { status: 'connected', updatedAt: new Date(now).toISOString(), items: [{ id: 'cli-1', name: 'Codex CLI · 1', provider: 'openai', status: 'running', startedAt: new Date(now).toISOString(), endedAt: null }] },
}) };

test('CLI processes, stored sessions, multiple providers and duplicate web tabs remain distinct', () => {
  const discovery = createDiscovery({ observer, clock: () => now });
  discovery.receive(snapshot([tab(), tab('2'), { ...tab('3'), provider: 'gemini' }, { ...tab('4'), key: 'b'.repeat(64) }, { ...tab('5'), kind: 'page', key: 'c'.repeat(64) }]));
  const result = discovery.snapshot();
  assert.deepEqual(result.counts, { cli: 1, cliProcesses: 1, webTabs: 5, webConversations: 3, webPages: 1 });
  assert.equal(result.entries.filter((row) => row.source === 'web').length, 4);
  assert.equal(result.entries.find((row) => row.kind === 'conversation' && row.provider === 'claude' && row.tabCount === 2).canControl, false);
  assert.equal(result.entries.find((row) => row.kind === 'process').canControl, false);
  assert.equal(result.entries.find((row) => row.kind === 'session').canControl, true);
});

test('close, empty, connection loss, recovery and out-of-order delivery are different states', () => {
  let time = now;
  const discovery = createDiscovery({ observer, clock: () => time });
  assert.deepEqual(discovery.snapshot().sources.browsers, []);
  discovery.receive(snapshot());
  time += 1000;
  discovery.receive(snapshot([], time));
  assert.equal(discovery.snapshot().counts.webTabs, 0);
  assert.equal(discovery.snapshot().sources.browsers[0].status, 'connected');
  assert.equal(discovery.receive(snapshot()).accepted, false);
  assert.equal(discovery.receive(snapshot([tab()], time)).accepted, false);
  time += 1;
  discovery.receive(snapshot([tab()], time));
  time += 90001;
  assert.equal(discovery.snapshot().counts.webTabs, 0);
  assert.equal(discovery.snapshot().entries.find((row) => row.source === 'web').status, 'disconnected');
  discovery.receive(snapshot([tab()], time));
  assert.equal(discovery.snapshot().counts.webTabs, 1);
  discovery.forget(client);
  assert.equal(discovery.snapshot().sources.browsers.length, 0);
});

test('browser profiles do not overwrite one another and detection does not survive restart', () => {
  const discovery = createDiscovery({ observer, clock: () => now });
  discovery.receive(snapshot());
  discovery.receive({ ...snapshot(), clientId: '00000000-0000-0000-0000-000000000003' });
  assert.equal(discovery.snapshot().counts.webTabs, 2);
  assert.equal(new Set(discovery.snapshot().entries.map((row) => row.id)).size, 4);
  assert.equal(createDiscovery({ observer, clock: () => now }).snapshot().counts.webTabs, 0);
});

test('private extra fields, malformed identifiers, future clocks and oversize batches are rejected atomically', () => {
  const discovery = createDiscovery({ observer, clock: () => now });
  for (const invalid of [
    { ...snapshot(), title: 'private-title' }, snapshot([{ ...tab(), url: 'https://claude.ai/' }]),
    snapshot([{ ...tab(), provider: '__proto__' }]), snapshot([{ ...tab(), key: 'private-secret' }]),
    snapshot([{ ...tab(), id: '../secret' }]), snapshot([tab(), tab()]),
    snapshot(Array.from({ length: 129 }, (_, i) => tab(String(i)))), snapshot([tab()], now + 6000),
    snapshot([tab()], now - 90001),
  ]) assert.throws(() => discovery.receive(invalid), { code: 'INVALID_DISCOVERY' });
  assert.equal(discovery.snapshot().counts.webTabs, 0);
});
