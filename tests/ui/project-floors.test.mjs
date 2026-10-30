import test from 'node:test';
import assert from 'node:assert/strict';
import { configureProjectFloors, ROOMS, FLOORS, occupantRoom, roomTasks, routeBetween, FLOOR_HEIGHT } from '../../public/rooms.mjs';
import { activeOfficeProjects } from '../../public/office-activity.mjs';

const projects = [
  { id: 'a', name: 'Same name', source: 'folder', floor: 2 },
  { id: 'b', name: 'Same name', source: 'folder', floor: 6 },
  { id: 'manual', name: 'Assigned', source: 'manual', floor: 8 },
];
function liveState() {
  return { office: { paused: false }, projects: structuredClone(projects), tasks: [],
    agents: [{ id: 'staff', provider: 'openai', observedProjectId: 'a', assignedProjectId: 'manual',
      connection: { status: 'connected', source: 'cli', kind: 'session', sessionId: 'one' } }],
    localSessions: { status: 'connected', sessions: [{ id: 'one', lifecycle: 'live', status: 'idle' }] } };
}

test('empty and historical projects leave only the two shared floors', () => {
  const state = liveState(); state.agents = [];
  configureProjectFloors(activeOfficeProjects(state));
  assert.deepEqual(FLOORS.map((floor) => floor.id), [2, 1]);
  assert.deepEqual(ROOMS.map((room) => room.id), ['executive', 'lounge', 'warehouse', 'pantry']);
  assert.equal(occupantRoom({ sessionLifecycle: 'live', observedProjectId: 'a' }), 'warehouse');
});

test('only registered live connections create floors; turn completion and pauses do not end a live CLI', () => {
  const state = liveState();
  const before = structuredClone(state);
  const ids = () => activeOfficeProjects(state).map((project) => project.id);
  for (const status of ['working', 'idle', 'interrupted', 'unknown']) {
    state.localSessions.sessions[0].status = status;
    assert.deepEqual(ids(), ['a']);
  }
  state.office.paused = true; assert.deepEqual(ids(), ['a']);
  for (const lifecycle of ['not_loaded', 'unknown']) {
    state.localSessions.sessions[0].lifecycle = lifecycle; assert.deepEqual(ids(), []);
  }
  state.localSessions.sessions[0].lifecycle = 'live';
  state.localSessions.status = 'disconnected'; assert.deepEqual(ids(), []);
  state.localSessions.status = 'connected';
  for (const status of ['missing', 'ended', 'unknown', 'disconnected', 'not_connected']) {
    state.agents[0].connection.status = status; assert.deepEqual(ids(), []);
  }
  state.agents[0].connection.status = 'connected';
  state.agents[0].workArchive = { stored: true, note: 'Keep this note' }; assert.deepEqual(ids(), []);
  state.agents[0].workArchive.stored = false; assert.deepEqual(ids(), ['a']);
  assert.deepEqual(activeOfficeProjects(state, false), []);
  state.localSessions.sessions = []; assert.deepEqual(ids(), []);
  assert.deepEqual(state.projects, before.projects, 'visibility never deletes the historical catalog');
  assert.equal(state.agents[0].workArchive.note, 'Keep this note');
});

test('multiple staff share one floor until the last live session leaves and reconnecting restores it', () => {
  const state = liveState();
  state.agents.push({ ...state.agents[0], id: 'second', connection: { ...state.agents[0].connection, sessionId: 'two' } });
  state.localSessions.sessions.push({ id: 'two', lifecycle: 'live', status: 'idle' });
  assert.equal(activeOfficeProjects(state).length, 1);
  state.localSessions.sessions.shift(); assert.equal(activeOfficeProjects(state).length, 1);
  state.localSessions.sessions[0].lifecycle = 'not_loaded'; assert.equal(activeOfficeProjects(state).length, 0);
  state.localSessions.sessions[0].lifecycle = 'live'; assert.equal(activeOfficeProjects(state).length, 1);
});

test('manual assignments need a connected conversation or process; service pages and idle demo staff make no floors', () => {
  const state = liveState();
  const agent = state.agents[0]; delete agent.observedProjectId;
  for (const [source, kind] of [['web', 'conversation'], ['cli', 'process']]) {
    agent.connection = { status: 'connected', source, kind };
    assert.deepEqual(activeOfficeProjects(state).map((project) => project.id), ['manual']);
  }
  agent.connection = { status: 'connected', source: 'web', kind: 'page' };
  assert.deepEqual(activeOfficeProjects(state), []);
  delete agent.connection; assert.deepEqual(activeOfficeProjects(state), []);
  agent.provider = 'demo'; assert.deepEqual(activeOfficeProjects(state), []);
  state.tasks = [{ id: 'task', agentId: agent.id, status: 'waiting_input' }];
  assert.equal(activeOfficeProjects(state).length, 1);
  state.tasks[0].status = 'completed'; assert.deepEqual(activeOfficeProjects(state), []);
});

test('visible floors compact without reusing room identities or moving historical project records', () => {
  const before = structuredClone(projects);
  try {
    configureProjectFloors(projects.slice(0, 2));
    const id = ROOMS.find((room) => room.projectId === 'b' && room.kind === 'office').id;
    configureProjectFloors([projects[1]]);
    assert.deepEqual(FLOORS.map((floor) => floor.id), [3, 2, 1]);
    assert.equal(ROOMS.find((room) => room.id === id).floor, 2);
    assert.equal(occupantRoom({ observedProjectId: 'b', sessionLifecycle: 'live' }), id);
    assert.equal(occupantRoom({ observedProjectId: 'a', sessionLifecycle: 'live' }), 'warehouse');
    assert.equal(routeBetween(id, 'executive').at(-1).y, 2 * FLOOR_HEIGHT);
    assert.deepEqual(projects, before);
  } finally { configureProjectFloors(); }
});

test('project rooms and paths isolate staff and tasks on stable dedicated floors', () => {
  try {
    configureProjectFloors([{ id: 'a', name: 'Same name', source: 'folder', floor: 2 }, { id: 'b', name: 'Same name', source: 'folder', floor: 3 }]);
    assert.equal(FLOORS.length, 4);
    assert.equal(ROOMS.find((r) => r.id === 'executive').floor, 4);
    const a = { id: 'a-staff', observedProjectId: 'a', assignedProjectId: 'b', sessionLifecycle: 'live' };
    const b = { id: 'b-staff', assignedProjectId: 'b', status: 'working' };
    assert.equal(occupantRoom(a), 'office'); assert.equal(occupantRoom(b), 'office-b');
    assert.equal(occupantRoom({ status: 'working' }), 'warehouse');
    assert.equal(occupantRoom({ ...a, sceneActivity: { room: 'meeting' } }), 'meeting');
    assert.equal(occupantRoom({ ...b, sceneActivity: { room: 'meeting' } }), 'meeting-b');
    const tasks = [{ id: 'one', agentId: 'a-staff', status: 'working' }, { id: 'two', projectId: 'b', status: 'working' }];
    assert.deepEqual(roomTasks('office', tasks, [a, b]).map((t) => t.id), ['one']);
    assert.deepEqual(roomTasks('office-b', tasks, [a, b]).map((t) => t.id), ['two']);
    const route = routeBetween('office', 'office-b');
    assert.equal(route.at(-1).y, 2 * FLOOR_HEIGHT);
    assert.ok(route.some((point, index) => index && route[index - 1].y !== point.y && point.x === -11.85 && point.z === 5.25));
  } finally { configureProjectFloors(); }
});
