import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSummary, observedProject, projectField, commandSelection } from '../../public/staff-settings.mjs';

test('manual assignments remain separate from verified CLI workspace and web observations never imply a project', () => {
  const local = { workspace: 'actual', sessions: [{ id: 'one' }] };
  const agent = { projectName: 'Assigned', connection: { source: 'cli', kind: 'session', sessionId: 'one', status: 'connected' } };
  assert.match(projectSummary(agent, local), /Assigned/);
  assert.equal(observedProject(agent, local), 'actual');
  assert.match(projectSummary({ ...agent, projectName: '' }, local), /CLI 작업 · actual/);
  assert.equal(observedProject({ connection: { source: 'web', kind: 'conversation', scope: 'browser' } }, local), '');
  assert.equal(observedProject({ connection: { source: 'cli', kind: 'process' } }, local), '');
  assert.equal(observedProject(agent, { ...local, sessions: [] }), '');
  assert.equal(projectSummary({}), '담당 프로젝트 · 미배정');
  assert.doesNotMatch(projectField({ projectName: '\"><img src=x onerror=alert(1)>' }), /<img/);
});

test('employee defaults reach the next command while an explicit draft, including CLI keep-current, takes priority', () => {
  const preference = { model: 'verified', reasoningEffort: 'high' };
  const state = { agents: [{ executionPreference: preference, connection: { source: 'cli', kind: 'session', sessionId: 'one' } }] };
  const drafts = new Map();
  assert.deepEqual(commandSelection(state, 'one', drafts), preference);
  assert.deepEqual(commandSelection(state, 'two', drafts), {});
  drafts.set('one', { model: '', reasoningEffort: '' });
  assert.deepEqual(commandSelection(state, 'one', drafts), { model: '', reasoningEffort: '' });
  drafts.delete('one');
  assert.deepEqual(commandSelection(state, 'one', drafts), preference);
  delete state.agents[0].connection;
  assert.deepEqual(commandSelection(state, 'one', drafts), {});
});
