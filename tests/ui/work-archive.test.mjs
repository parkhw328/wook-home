import test from 'node:test';
import assert from 'node:assert/strict';
import { occupantRoom, ROOMS, routeBetween } from '../../public/rooms.mjs';
import { officeOccupants } from '../../public/office-activity.mjs';
import { commandUnavailableReason } from '../../public/commands.mjs';

test('warehouse distinguishes explicit storage and lost observation from idle CLI and real rest', () => {
  assert.equal(occupantRoom({ source: 'session', status: 'idle' }), 'office');
  assert.equal(occupantRoom({ source: 'agent', status: 'idle' }), 'lounge');
  for (const status of ['disconnected', 'interrupted']) assert.equal(occupantRoom({ source: 'session', status }), 'warehouse');
  assert.equal(occupantRoom({ source: 'agent', status: 'observing', workArchive: { stored: true }, sceneActivity: { room: 'meeting' } }), 'warehouse');
  const room = ROOMS.find((r) => r.id === 'warehouse');
  assert.equal(room.floor, 1);
  assert.equal(routeBetween('office', 'warehouse').at(-1).x, room.x);
});

test('archived linked staff remain one actor and never announce live activity or permit a new instruction', () => {
  const state = { office: { paused: false }, tasks: [], agents: [{ id: 'staff', provider: 'openai', status: 'observing', workArchive: { stored: true }, connection: { sessionId: 's', status: 'connected' } }],
    localSessions: { status: 'connected', control: { enabled: true }, sessions: [{ id: 's', status: 'idle' }] } };
  const actors = officeOccupants(state);
  assert.equal(actors.length, 1);
  assert.equal(actors[0].sceneActivity, null);
  assert.equal(occupantRoom(actors[0]), 'warehouse');
  assert.match(commandUnavailableReason(state, 's'), /창고/);
  state.agents[0].workArchive.stored = false;
  assert.equal(commandUnavailableReason(state, 's'), '');
  state.localSessions.sessions[0].canControl = false;
  assert.match(commandUnavailableReason(state, 's'), /지원하지/);
});
