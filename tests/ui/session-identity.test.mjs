import test from 'node:test';
import assert from 'node:assert/strict';
import { identityMarkup, staffIdentity, sessionAlias, lifecycleLabel } from '../../public/session-identity.mjs';
import { officeOccupants } from '../../public/office-activity.mjs';
import { unassignedLocalSessions, officeCounts } from '../../public/model.mjs';

test('same alias and identical UUID suffixes remain distinct in full identity markup', () => {
  const sessions = ['1111', '2222', '3333'].map((part) => ({ id: `00000000-${part}-4000-8000-000000000001` }));
  const state = { agents: sessions.map((session, i) => ({ id: `employee-${i}`, name: '동료', connection: { sessionId: session.id } })) };
  for (const [i, session] of sessions.entries()) {
    assert.equal(sessionAlias(state, session), '동료');
    assert.ok(staffIdentity(state.agents[i]).includes(`<code>${session.id}</code>`));
  }
  assert.doesNotMatch(identityMarkup('<script>&'), /<script>/);
  assert.match(staffIdentity({ connection: { entryId: 'process:opaque-identity' } }), /session-id 미확인/);
  assert.match(lifecycleLabel({ lifecycle: 'live' }, false), /확인 불가/);
});

test('registration transfers one pending session to staff count and a single actor without hiding other pending records', () => {
  const state = { office: {}, tasks: [], agents: [], localSessions: { status: 'connected', sessions: [{ id: 'one', lifecycle: 'live' }, { id: 'two' }] } };
  assert.equal(officeCounts(state).agents, 0);
  assert.equal(officeOccupants(state).length, 0);
  state.agents.push({ id: 'employee', connection: { sessionId: 'one', status: 'connected' } });
  assert.equal(officeCounts(state).agents, 1);
  assert.equal(officeOccupants(state).length, 1);
  assert.deepEqual(unassignedLocalSessions(state).map((session) => session.id), ['two']);
});
