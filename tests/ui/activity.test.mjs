import test from 'node:test';
import assert from 'node:assert/strict';
import { officeOccupants, sceneActivity, sessionRoom, activityRoomMarkup, activitySummaryMarkup } from '../../public/office-activity.mjs';
import { gesturePose } from '../../public/office-gestures.mjs';

const time = Date.parse('2026-10-22T01:00:00Z');
const activity = (kind = 'collaborating') => ({ kind, phase: kind === 'collaborating' ? 'recent' : 'active', since: new Date(time).toISOString(), expiresAt: new Date(time + 60000).toISOString(), peerSessionIds: ['b'] });
const state = () => ({ office: { paused: false }, tasks: [], agents: [], localSessions: { status: 'connected', sessions: [
  { id: 'a', name: 'A', status: 'working', lifecycle: 'live', activity: activity() }, { id: 'b', name: 'B', status: 'working', lifecycle: 'live', activity: activity() },
] } });

test('collaboration and Commander presentations route differently and expired or disconnected activity disappears', () => {
  assert.equal(sceneActivity(activity(), true, time).room, 'meeting');
  assert.equal(sceneActivity(activity('question'), true, time).pose, 'presenting');
  assert.equal(sceneActivity(activity('approval'), true, time).room, 'executive');
  assert.equal(sceneActivity(activity(), false, time), null);
  assert.equal(sceneActivity(activity(), true, time + 60001), null);
  assert.equal(sceneActivity(activity(), true, time - 6000), null);
});

test('a linked employee inherits the actual session activity once and never invents activity for a web tab', () => {
  const value = state();
  value.agents.push({ id: 'employee', name: 'linked', status: 'observing', provider: 'openai', connection: { source: 'cli', kind: 'session', sessionId: 'a', status: 'connected' } },
    { id: 'web', status: 'observing', provider: 'openai', connection: { source: 'web', kind: 'conversation', status: 'connected' } });
  const before = structuredClone(value);
  const actors = officeOccupants(value, true, time);
  assert.equal(actors.length, 2); assert.equal(actors.some((actor) => actor.source === 'session' && actor.id === 'a'), false);
  assert.equal(actors.find((actor) => actor.id === 'employee').sceneActivity.room, 'meeting');
  assert.equal(actors.find((actor) => actor.id === 'web').sceneActivity, null);
  assert.deepEqual(value, before);
  assert.ok(officeOccupants(value, false, time).every((actor) => !actor.sceneActivity));
  value.localSessions.sessions[0].lifecycle = 'not_loaded';
  assert.equal(officeOccupants(value, true, time).find((actor) => actor.id === 'employee').sceneActivity, null);
});

test('demo questions and reviews are presentations until answered, approved, paused or disconnected', () => {
  const value = state(); value.agents = [{ id: 'demo', provider: 'demo', status: 'waiting_input' }];
  value.tasks = [{ id: 'task', agentId: 'demo', status: 'waiting_input' }];
  const current = () => officeOccupants(value, true, time).find((actor) => actor.id === 'demo').sceneActivity;
  assert.equal(current().kind, 'question'); assert.equal(current().room, 'executive');
  value.tasks[0].status = 'waiting_approval'; assert.equal(current().kind, 'approval');
  value.office.paused = true; assert.equal(current(), null);
  value.office.paused = false; value.tasks[0].status = 'completed'; assert.equal(current(), null);
});

test('presentation, discussion and walking are distinct and reduced motion has no oscillation', () => {
  const presenting = gesturePose('presenting', 1);
  const discussing = gesturePose('discussing', 1);
  assert.ok(presenting.rightArm.x < -.8, 'presenter raises a pointing arm');
  assert.notDeepEqual(presenting, discussing);
  const walking = gesturePose('presenting', 1, true);
  assert.notEqual(walking.leftLeg, 0);
  assert.equal(walking.leftLeg, -walking.rightLeg);
  assert.deepEqual(walking, gesturePose('discussing', 1, true), 'walking overrides a meeting pose');
  for (const pose of ['presenting', 'discussing', 'typing']) {
    assert.deepEqual(gesturePose(pose, 1, true, false), gesturePose(pose, 9, false, false));
    assert.equal(gesturePose(pose, 1, false, false).bob, 0);
  }
  assert.deepEqual(gesturePose('still', 1), gesturePose('still', 99));
});

test('room participants open their own session, escape names and never offer a false approval action', () => {
  const value = state(); value.localSessions.sessions[0].name = '<script>private</script>';
  value.localSessions.sessions[1].activity = activity('question');
  value.agents = value.localSessions.sessions.map((session) => ({ id: `staff-${session.id}`, name: session.name, provider: 'openai', status: 'observing', connection: { source: 'cli', kind: 'session', sessionId: session.id, status: 'connected' } }));
  const actors = officeOccupants(value, true, time);
  assert.equal(sessionRoom(value, 'a', true, time), 'meeting');
  assert.equal(sessionRoom(value, 'b', true, time), 'executive');
  assert.equal(sessionRoom(value, 'b', false, time), 'warehouse');
  const meeting = activityRoomMarkup('meeting', actors, 'a');
  const presentation = activityRoomMarkup('executive', actors, 'b');
  assert.match(meeting, /data-workspace-session="a"/); assert.doesNotMatch(meeting, /<script>/);
  assert.match(presentation, /data-workspace-session="b"/); assert.match(presentation, /원래 Codex/);
  assert.doesNotMatch(presentation, /data-report-action|data-session-command/);
  const summary = activitySummaryMarkup(actors);
  assert.match(summary, /data-room="meeting"/); assert.match(summary, /data-room="executive"/);
  assert.equal(activitySummaryMarkup(officeOccupants(value, false, time)), '');
});
