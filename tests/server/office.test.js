import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';

function fixture(t) {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const office = createOffice(store);
  const hire = () => office.hire({ name: '체험 직원', role: '업무 흐름 안내', provider: 'demo' });
  return { office, hire };
}

test('demo task requires an answer then approval before completion', (t) => {
  const { office, hire } = fixture(t);
  const agent = hire();
  assert.equal(agent.model, 'local-demo');
  const task = office.assign({ agentId: agent.id, title: '첫 업무' });
  assert.equal(task.status, 'waiting_input');
  assert.throws(() => office.approve(task.id, {}), { code: 'INVALID_STATE' });
  const answered = office.answer(task.id, { content: '결과물을 확인하고 싶어요.' });
  assert.equal(answered.status, 'waiting_approval');
  assert.equal(answered.messages.length, 3);
  assert.match(answered.result, /체험 결과/);
  assert.equal(office.approve(task.id, {}).status, 'completed');
  assert.equal(office.snapshot().agents[0].status, 'idle');
  assert.throws(() => office.approve(task.id, {}), { code: 'INVALID_STATE' });
});

test('external staff are registered honestly and cannot execute tasks', (t) => {
  const { office } = fixture(t);
  for (const provider of ['openai', 'claude', 'gemini', 'meta']) {
    const agent = office.hire({ name: '연결 준비', role: '검토', provider });
    assert.equal(agent.status, 'unavailable');
    assert.equal(agent.model, '');
    assert.throws(() => office.assign({ agentId: agent.id, title: '실행' }), { code: 'PROVIDER_UNAVAILABLE' });
  }
  assert.equal(office.snapshot().tasks.length, 0);
});

test('pause blocks work; resume preserves the approval stage', (t) => {
  const { office, hire } = fixture(t);
  const agent = hire();
  const task = office.assign({ agentId: agent.id, title: '일시 중지할 업무' });
  office.answer(task.id, { content: '진행' });
  office.pause();
  assert.equal(office.snapshot().tasks[0].status, 'paused');
  assert.equal(office.snapshot().agents[0].status, 'paused');
  assert.throws(() => office.approve(task.id, {}), { code: 'OFFICE_PAUSED' });
  assert.throws(() => office.assign({ agentId: agent.id, title: '새 업무' }), { code: 'OFFICE_PAUSED' });
  office.resume({});
  assert.equal(office.snapshot().tasks[0].status, 'waiting_approval');
  assert.equal(office.snapshot().agents[0].status, 'waiting_approval');
});

test('duplicate work and duplicate answers are rejected without losing data', (t) => {
  const { office, hire } = fixture(t);
  const agent = hire();
  const task = office.assign({ agentId: agent.id, title: '하나의 업무' });
  assert.throws(() => office.assign({ agentId: agent.id, title: '겹치는 업무' }), { code: 'AGENT_BUSY' });
  office.answer(task.id, { content: '한 번의 답변' });
  assert.throws(() => office.answer(task.id, { content: '중복' }), { code: 'INVALID_STATE' });
  assert.equal(office.snapshot().tasks.length, 1);
  assert.equal(office.snapshot().tasks[0].messages.length, 3);
});

test('cancelled tasks stay cancelled through resume and release the employee', (t) => {
  const { office, hire } = fixture(t);
  const agent = hire();
  const task = office.assign({ agentId: agent.id, title: '취소 업무' });
  office.pause();
  office.cancel(task.id, {});
  office.resume({});
  assert.equal(office.snapshot().tasks[0].status, 'cancelled');
  assert.equal(office.snapshot().agents[0].status, 'idle');
  assert.throws(() => office.cancel(task.id, {}), { code: 'INVALID_STATE' });
  assert.equal(office.assign({ agentId: agent.id, title: '다음 업무' }).status, 'waiting_input');
});

test('unsupported settings and malformed inputs leave stored state unchanged', (t) => {
  const { office, hire } = fixture(t);
  assert.throws(() => office.hire({ name: '직원', role: '검토', provider: 'unknown' }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => office.hire({ name: ' ', role: '검토', provider: 'demo' }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => office.hire({ name: '직원', role: '검토', provider: 'openai', model: 'unverified' }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => office.hire({ name: '직원', role: '검토', provider: 'demo', apiKey: 'test-only' }), { code: 'VALIDATION_ERROR' });
  const agent = hire();
  assert.throws(() => office.editAgent(agent.id, { name: '변경 이름', reasoningEffort: 'high' }), { code: 'CAPABILITY_UNAVAILABLE' });
  assert.equal(office.snapshot().agents[0].name, agent.name);
  assert.equal(office.snapshot().agents.length, 1);
});

test('activity summaries do not duplicate user-provided content', (t) => {
  const { office, hire } = fixture(t);
  const agent = hire();
  const task = office.assign({ agentId: agent.id, title: 'private-user-title', description: 'private-user-body' });
  office.answer(task.id, { content: 'private-user-answer' });
  assert.doesNotMatch(JSON.stringify(office.snapshot().events), /private-user/);
  assert.equal(office.handoff().tasks[0].description, 'private-user-body');
  assert.match(office.handoff().notice, /공개 전/);
});

test('SQLite restart preserves work and pauses unfinished tasks until resume', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'wook-home-test-'));
  let store = createStore(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let office = createOffice(store);
  const agent = office.hire({ name: '보존 직원', role: '인계 검토', provider: 'demo' });
  const task = office.assign({ agentId: agent.id, title: '보존 업무' });
  office.answer(task.id, { content: '보존할 답변' });
  store.close();
  store = createStore(directory);
  office = createOffice(store);
  assert.equal(office.snapshot().office.paused, true);
  assert.equal(office.snapshot().tasks[0].status, 'paused');
  assert.equal(office.snapshot().agents[0].id, agent.id);
  office.resume({});
  assert.equal(office.snapshot().tasks[0].status, 'waiting_approval');
  assert.equal(office.snapshot().tasks[0].messages[1].content, '보존할 답변');
});
