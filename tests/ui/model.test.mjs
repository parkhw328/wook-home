import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, statusLabel, statusClass, officeCounts, officeStatItems, taskUnavailableReason,
  filterTasks, normalizeState, programUrl, providerLinks,
  officeName, observedSessionStatus, sessionStatusLabel, characterMotion, orderedLocalSessions,
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

test('stat details match every count and exclude paused, failed, cancelled and observed sessions', () => {
  const state = fixture();
  state.tasks = ['working', 'running', 'queued', 'waiting_input', 'waiting_approval', 'completed', 'paused', 'failed', 'cancelled', 'disconnected', 'unknown']
    .map((status, index) => ({ id: status, status, updatedAt: `2026-10-22T03:${String(index).padStart(2, '0')}:00Z` }));
  state.localSessions = { sessions: [{ id: 'cli', status: 'completed' }] };
  const originalTasks = [...state.tasks];
  assert.deepEqual(officeStatItems(state, 'working').map((task) => task.id), ['waiting_approval', 'waiting_input', 'queued', 'running', 'working']);
  assert.deepEqual(officeStatItems(state, 'waiting').map((task) => task.id), ['waiting_approval', 'waiting_input']);
  assert.deepEqual(officeStatItems(state, 'completed').map((task) => task.id), ['completed']);
  assert.deepEqual(officeStatItems(state, 'agents').map((agent) => agent.id), ['one', 'two']);
  const counts = officeCounts(state);
  for (const key of ['agents', 'working', 'waiting', 'completed']) assert.equal(officeStatItems(state, key).length, counts[key]);
  assert.deepEqual(state.tasks, originalTasks);
});

test('stat details follow transitions without mutating staff and handle empty or unsupported categories', () => {
  const state = fixture();
  const task = { id: 'task', status: 'waiting_input' };
  state.tasks.push(task);
  assert.equal(officeStatItems(state, 'waiting')[0], task);
  task.status = 'completed';
  assert.equal(officeStatItems(state, 'waiting').length, 0);
  assert.equal(officeStatItems(state, 'working').length, 0);
  assert.equal(officeStatItems(state, 'completed')[0], task);
  officeStatItems(state, 'agents').reverse();
  assert.equal(state.agents[0].id, 'one');
  assert.deepEqual(officeStatItems(state, 'invalid'), []);
  state.agents = []; state.tasks = [];
  for (const key of ['agents', 'working', 'waiting', 'completed']) assert.deepEqual(officeStatItems(state, key), []);
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

test('observed CLI states cannot claim task completion or keep activity after losing connection', () => {
  const session = { status: 'working' };
  assert.equal(observedSessionStatus({ status: 'connected' }, session), 'working');
  assert.equal(observedSessionStatus({ status: 'disconnected' }, session), 'disconnected');
  assert.equal(observedSessionStatus({ status: 'connected' }, session, false), 'disconnected');
  assert.equal(observedSessionStatus({ status: 'connected' }, { status: 'completed' }), 'unknown');
  assert.equal(sessionStatusLabel('idle'), '턴 종료 관찰');
  assert.equal(sessionStatusLabel('working'), '활동 관찰');
  assert.equal(sessionStatusLabel('constructor'), '확인 필요');
  const state = fixture();
  state.localSessions = { status: 'connected', sessions: [{ status: 'working' }, { status: 'idle' }] };
  assert.equal(officeCounts(state).completed, 0);
  assert.equal(officeCounts(state).working, 0);
});

test('character movement stops on interruption, unknown status, and loss of connection', () => {
  assert.equal(characterMotion('working'), 'typing');
  assert.equal(characterMotion('waiting_input'), 'attention');
  assert.equal(characterMotion('waiting_approval'), 'attention');
  assert.equal(characterMotion('idle'), 'idle');
  for (const status of ['working', 'idle', 'waiting_approval']) assert.equal(characterMotion(status, false), 'still');
  for (const status of ['paused', 'unknown', 'interrupted', 'failed', 'completed', 'unavailable']) assert.equal(characterMotion(status), 'still');
});

test('the configured office name and the agreed blog URL are supported without broadening links', () => {
  assert.equal(officeName({ name: '  나의 개발실  ' }), '나의 개발실');
  assert.equal(officeName({ name: '' }), 'StackQueue Office');
  assert.equal(programUrl({ name: 'StackQueue Blog', url: 'https://blog.naver.com/stack-queue' }), 'https://blog.naver.com/stack-queue');
  assert.equal(programUrl({ name: 'StackQueue Blog', url: 'https://blog.naver.com/another-account' }), null);
});

test('new CLI activity does not move the session a user is about to select', () => {
  const first = [{ id: 'session-b', lastActivityAt: '2026-10-21T12:00:00Z' }, { id: 'session-a', lastActivityAt: '2026-10-21T11:00:00Z' }];
  const next = [{ id: 'session-a', lastActivityAt: '2026-10-21T13:00:00Z' }, { id: 'session-b', lastActivityAt: '2026-10-21T12:00:00Z' }];
  assert.deepEqual(orderedLocalSessions({ sessions: first }).map((session) => session.id), orderedLocalSessions({ sessions: next }).map((session) => session.id));
  assert.equal(first[0].id, 'session-b');
  assert.deepEqual(orderedLocalSessions(undefined), []);
});

test('provider cards only open each agreed service and the published connection guide', () => {
  const guideUrl = 'https://github.com/parkhw328/wook-home/wiki/Providers';
  const sources = [
    ['openai', 'ChatGPT', 'https://chatgpt.com/'],
    ['claude', 'Claude', 'https://claude.ai/'],
    ['gemini', 'Gemini', 'https://gemini.google.com/'],
    ['meta', 'Meta AI', 'https://www.meta.ai/'],
  ];
  for (const [id, label, webUrl] of sources) {
    const provider = { id, webUrl, guideUrl, available: false };
    assert.deepEqual(providerLinks(provider), { label, webUrl, guideUrl });
    assert.equal(provider.available, false);
    for (const invalid of ['javascript:alert(1)', 'https://chatgpt.com.example.com/', `${webUrl}unverified`]) {
      assert.equal(providerLinks({ ...provider, webUrl: invalid }).webUrl, null);
    }
    assert.equal(providerLinks({ ...provider, guideUrl: `${guideUrl}-unverified` }).guideUrl, null);
  }
  assert.equal(providerLinks({ id: 'openai', webUrl: 'https://claude.ai/' }).webUrl, null);
  assert.deepEqual(providerLinks({ id: 'constructor', webUrl: 'https://chatgpt.com/' }), {});
  assert.equal(providerLinks({ id: 'openai' }).webUrl, null);
});
