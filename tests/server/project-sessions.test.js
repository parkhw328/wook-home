import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectLoadedSessions } from '../../scripts/lib/codex-control.mjs';
import { mergeLoadedSessions } from '../../scripts/lib/codex-observer.mjs';
import { workspaceIdentity } from '../../scripts/lib/workspace-identity.mjs';
import { createSessionObserver } from '../../server/sessions.js';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';
import { activeOfficeProjects } from '../../public/office-activity.mjs';
import { configureProjectFloors, FLOORS, ROOMS } from '../../public/rooms.mjs';

const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
const now = Date.parse('2026-10-31T00:00:00Z');
const timestamp = new Date(now).toISOString();
const projects = ['/first/app', '/second/app'].map(workspaceIdentity);
const saved = () => ({ schemaVersion: 1, generatedAt: timestamp, ...projects[0], sessions: [], conversations: { enabled: true } });

test('loaded sessions reach separate project floors through bridge, API and registration, including equal folder names and restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'office-project-sessions-'));
  const bridgeFile = join(directory, 'codex.json');
  const store = createStore(directory);
  let office = createOffice(store);
  let server;
  let base;
  const start = async () => {
    server = createHttpServer(office, { bridgeFile, clock: () => now });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const state = async () => (await fetch(base + '/api/state')).json();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close(); rmSync(directory, { recursive: true, force: true }); configureProjectFloors();
  });
  const loaded = await collectLoadedSessions({ workspace: '/first/app' }, async () => ({
    request: async (method, params) => method === 'thread/loaded/list' ? { data: ids } : { thread: {
      id: params.threadId, cwd: ['/first/app', '/second/app'][ids.indexOf(params.threadId)],
      status: { type: 'idle' }, updatedAt: now / 1000, preview: 'never exported', turns: [],
    } }, close() {},
  }));
  const bridge = mergeLoadedSessions(saved(), loaded);
  const publish = () => writeFileSync(bridgeFile, JSON.stringify(bridge));
  publish(); await start();
  const first = await state();
  assert.equal(first.agents.length, 2);
  assert.deepEqual(first.agents.map((agent) => agent.observedProjectId), projects.map((project) => project.workspaceKey));
  assert.deepEqual(first.agents.map((agent) => agent.connection.scope), ['app', 'app']);
  configureProjectFloors(activeOfficeProjects(first));
  assert.equal(FLOORS.length, 4);
  assert.equal(new Set(ROOMS.filter((room) => room.kind === 'office').map((room) => room.projectId)).size, 2);
  assert.doesNotMatch(JSON.stringify(first), /\/first\/app|\/second\/app|never exported/);

  office.editAgent(first.agents[1].id, { name: 'Saved alias', projectName: 'Manual assignment', settingsRevision: 0 });
  office.observeProject(first.agents[1].id, projects[0]); // Repair a legacy wrong assignment while already linked.
  const repaired = await state();
  assert.equal(repaired.agents[1].observedProjectId, projects[1].workspaceKey);
  assert.equal(repaired.agents[1].name, 'Saved alias');
  assert.equal(repaired.agents[1].projectName, 'Manual assignment');

  await new Promise((resolve) => server.close(resolve));
  office = createOffice(store); await start();
  const restarted = await state();
  assert.deepEqual(restarted.agents.map((agent) => agent.id), first.agents.map((agent) => agent.id));
  assert.equal(restarted.agents[1].name, 'Saved alias');
  bridge.sessions = [bridge.sessions[0]]; publish();
  const absent = await state();
  assert.equal(activeOfficeProjects(absent).length, 1);
  assert.equal(absent.agents.length, 2);
  assert.equal(absent.projects.length, 3, 'historical and manual projects remain stored');
  bridge.sessions = mergeLoadedSessions(saved(), loaded).sessions; publish();
  assert.equal(activeOfficeProjects(await state()).length, 2);
  const handoff = JSON.stringify(office.handoff());
  for (const id of ids) assert.ok(!handoff.includes(id));
});

test('merging loaded project metadata preserves selected conversations but never carries them into a different project', () => {
  const observed = { ...saved(), sessions: [{ id: ids[0], status: 'idle', lastActivityAt: timestamp, conversation: { messages: ['selected text'] } }] };
  const loaded = { status: 'ready', ids, sessions: ids.map((id, index) => ({ id, lifecycle: 'live', status: 'idle', lastActivityAt: timestamp, ...projects[index] })) };
  const result = mergeLoadedSessions(observed, loaded);
  assert.deepEqual(result.sessions[0].conversation, observed.sessions[0].conversation);
  assert.equal(result.sessions[1].conversation, undefined);
  assert.equal(result.sessions[1].canControl, false);
  loaded.sessions[0] = { ...loaded.sessions[0], ...projects[1] };
  const moved = mergeLoadedSessions(observed, loaded);
  assert.equal(moved.sessions[0].conversation, undefined);
  assert.equal(moved.sessions[0].workspaceKey, projects[1].workspaceKey);
  assert.equal(moved.sessions[0].canControl, false);
  assert.equal(mergeLoadedSessions(observed, { status: 'ready', ids: [ids[0]], sessions: [] }).sessions[0].lifecycle, 'unknown');
  assert.equal(mergeLoadedSessions(observed, { status: 'unavailable', ids: [] }).sessions[0].lifecycle, 'unknown');
  assert.equal(mergeLoadedSessions(observed, { status: 'ready', ids: [] }).sessions[0].lifecycle, 'not_loaded');
});

test('project metadata is validated, old bridges remain supported and other-project conversation files cannot be read', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'office-project-scope-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'codex.json');
  const session = { id: ids[0], lifecycle: 'live', status: 'idle', lastActivityAt: timestamp };
  const observer = createSessionObserver({ file, clock: () => now });
  const publish = (extra) => writeFileSync(file, JSON.stringify({ ...saved(), sessions: [{ ...session, ...extra }] }));
  publish({});
  assert.equal(observer.snapshot().sessions[0].workspaceKey, projects[0].workspaceKey);
  mkdirSync(join(directory, 'conversations'));
  writeFileSync(join(directory, 'conversations', `${ids[0]}.json`), JSON.stringify({ schemaVersion: 1, sessionId: ids[0], generatedAt: timestamp,
    messages: [{ role: 'user', content: 'old selected project content', timestamp }] }));
  for (const extra of [projects[1], { workspace: '/private/path', workspaceKey: projects[0].workspaceKey }, { workspace: 'app', workspaceKey: 'invalid' }]) {
    publish(extra);
    const current = observer.snapshot().sessions[0];
    assert.equal(current.canControl, false);
    assert.doesNotMatch(JSON.stringify(current), /\/private\/path/);
    assert.equal(observer.conversation(ids[0]).reason, 'outside_workspace');
    assert.deepEqual(observer.conversation(ids[0]).messages, []);
  }
});
