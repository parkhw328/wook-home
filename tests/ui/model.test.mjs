import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, statusLabel, statusClass, officeCounts, taskUnavailableReason,
  filterTasks, normalizeState, programUrl,
} from '../../public/model.mjs';

function fixture() {
  return {
    office: { paused: false },
    providers: [
      { id: 'demo', available: true, capabilities: { createSession: true } },
      { id: 'openai', available: false, reason: '실제 AI 연결 준비 중' },
    ],
    agents: [{ id: 'one', provider: 'demo' }, { id: 'two', provider: 'openai' }],
    tasks: [], events: [], programs: [],
  };
}

test('only explicit completed events count as completed, while failed and paused stay distinct', () => {
  const state = fixture();
  state.tasks = ['waiting_input', 'waiting_approval', 'paused', 'failed', 'cancelled', 'completed', 'disconnected'].map((status) => ({ status }));
  assert.deepEqual(officeCounts(state), { agents: 2, working: 2, waiting: 2, completed: 1, unfinished: 4 });
  assert.equal(statusLabel('paused'), '일시 중지');
  assert.equal(statusLabel('failed'), '실패');
  assert.equal(statusLabel('disconnected'), '연결 끊김');
  for (const status of ['unexpected', 'constructor', '__proto__']) {
    assert.equal(statusLabel(status), '상태 확인 필요');
    assert.equal(statusClass(status), 'unknown');
  }
});

test('task execution requires a supported provider, an open office, and no unfinished task', () => {
  const state = fixture();
  const [demo, external] = state.agents;
  assert.equal(taskUnavailableReason(state, demo), '');
  assert.equal(taskUnavailableReason(state, external), '실제 AI 연결 준비 중');
  assert.ok(taskUnavailableReason(state, { id: 'missing', provider: 'unknown' }));
  state.office.paused = true;
  assert.ok(taskUnavailableReason(state, demo));
  state.office.paused = false;
  for (const status of ['waiting_input', 'waiting_approval', 'paused', 'disconnected']) {
    state.tasks = [{ agentId: 'one', status }];
    assert.ok(taskUnavailableReason(state, demo), status);
  }
  state.tasks = [{ agentId: 'one', status: 'completed' }];
  assert.equal(taskUnavailableReason(state, demo), '');
});

test('task filters keep unfinished work visible and preserve the source order', () => {
  const tasks = [
    { id: 'one', status: 'waiting_input', updatedAt: '2026-10-20T03:00:00Z' },
    { id: 'two', status: 'completed', updatedAt: '2026-10-21T03:00:00Z' },
    { id: 'three', status: 'paused', updatedAt: '2026-10-21T04:00:00Z' },
    { id: 'four', status: 'waiting_approval', updatedAt: '2026-10-21T05:00:00Z' },
  ];
  assert.deepEqual(filterTasks(tasks, 'attention').map((task) => task.id), ['four', 'one']);
  assert.deepEqual(filterTasks(tasks, 'active').map((task) => task.id), ['four', 'three', 'one']);
  assert.deepEqual(filterTasks(tasks, 'completed').map((task) => task.id), ['two']);
  assert.deepEqual(tasks.map((task) => task.id), ['one', 'two', 'three', 'four']);
});

test('user messages and names render as text in both HTML text and attributes', () => {
  assert.equal(escapeHtml('<img src=x onerror="run()"> & \'name\''), '&lt;img src=x onerror=&quot;run()&quot;&gt; &amp; &#39;name&#39;');
  assert.equal(escapeHtml('</textarea><script>run()</script>'), '&lt;/textarea&gt;&lt;script&gt;run()&lt;/script&gt;');
  assert.equal(escapeHtml(null), '');
});

test('program cards only link to the agreed repository URLs', () => {
  assert.equal(programUrl({ name: 'wShell', url: 'https://github.com/parkhw328/wook-shell' }), 'https://github.com/parkhw328/wook-shell');
  for (const url of ['javascript:alert(1)', 'https://github.com.example.com/parkhw328/wook-shell', 'https://github.com/parkhw328/wook-post']) {
    assert.equal(programUrl({ name: 'wShell', url }), null);
  }
  assert.equal(programUrl({ name: 'unknown', url: 'https://example.com' }), null);
});

test('an invalid state response is a connection failure rather than an empty successful office', () => {
  const state = fixture();
  assert.equal(normalizeState(state), state);
  for (const value of [null, {}, { ...state, office: {} }, { ...state, tasks: null }, { ...state, providers: {} }]) {
    assert.throws(() => normalizeState(value), /서버 상태/);
  }
});
