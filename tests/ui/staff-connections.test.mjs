import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionType, connectionMarkup, connectionSummary, eligibleEntries } from '../../public/staff-connections.mjs';
import { providers } from '../../server/catalog.js';
import { unassignedLocalSessions } from '../../public/model.mjs';

test('web employees get observation and official service actions, never fabricated CLI controls or model capabilities', () => {
  for (const provider of providers.filter((item) => item.kind === 'external')) {
    const agent = { id: 'employee', connection: { source: 'web', kind: 'page', status: 'connected', statusLabel: '연결 관찰', tabCount: 2, canControl: false } };
    const markup = connectionMarkup(agent, provider);
    assert.match(markup, /data-connect-agent/);
    assert.match(markup, /data-disconnect-agent/);
    assert.match(markup, /로그인·응답 생성 여부는 확인하지 않으며/);
    assert.doesNotMatch(markup, /data-session-command|data-new-task/);
    assert.ok(markup.includes(provider.webUrl));
    assert.equal(connectionType(agent.connection), '웹 서비스 화면');
  }
  assert.equal(connectionMarkup({ id: 'demo' }, providers[0]), '');
});

test('linked CLI reading actions target the selected session while the employee composer owns command settings', () => {
  const agent = { id: '"><img onerror="unsafe">', connection: { source: 'cli', kind: 'session', status: 'connected', statusLabel: '연결 관찰', sessionId: 'linked-session', canControl: true } };
  assert.match(connectionMarkup(agent, providers[1]), /data-session="linked-session"/);
  assert.doesNotMatch(connectionMarkup(agent, providers[1]), /<img|onerror="unsafe"/);
  agent.connection.canControl = false;
  assert.match(connectionMarkup(agent, providers[1]), /data-session="linked-session"/);
  assert.doesNotMatch(connectionMarkup(agent, providers[1]), /data-session-command=/);
  agent.connection = { source: 'web', kind: 'conversation', status: 'not_connected', statusLabel: '다시 연결 필요', canControl: false };
  assert.match(connectionMarkup(agent, providers[1]), /서버가 재시작되었습니다/);
  assert.match(connectionSummary(agent, providers[1]), /웹 대화 탭 · 다시 연결 필요/);
});

test('connection picker excludes unavailable and other employees targets and limits existing staff to the same provider', () => {
  const entries = [
    { id: 'free', source: 'web', status: 'open', provider: 'openai', canRegister: true },
    { id: 'mine', source: 'web', status: 'open', provider: 'openai', canRegister: false, linkedAgentId: 'me' },
    { id: 'theirs', provider: 'openai', canRegister: false, linkedAgentId: 'other' },
    { id: 'stale', source: 'web', status: 'disconnected', provider: 'openai', canRegister: false, linkedAgentId: 'me' },
    { id: 'claude', provider: 'claude', canRegister: true },
  ];
  assert.deepEqual(eligibleEntries(entries).map((item) => item.id), ['free', 'claude']);
  assert.deepEqual(eligibleEntries(entries, { id: 'me', provider: 'openai' }).map((item) => item.id), ['free', 'mine']);
});

test('a registered CLI employee occupies one place while unrelated and unlinked CLI sessions stay visible', () => {
  const state = { agents: [{ id: 'staff', connection: { source: 'cli', sessionId: 'one' } }], localSessions: { sessions: [{ id: 'one' }, { id: 'two' }] } };
  assert.deepEqual(unassignedLocalSessions(state).map((session) => session.id), ['two']);
  delete state.agents[0].connection;
  assert.deepEqual(unassignedLocalSessions(state).map((session) => session.id), ['one', 'two']);
});

test('server disconnect marks retained employee observations as stale without changing the stored connection', () => {
  const agent = { id: 'employee', settingsRevision: 4, connection: { source: 'cli', kind: 'session', status: 'connected', statusLabel: '연결 관찰', sessionId: 'linked-session' } };
  const offline = connectionMarkup(agent, providers[1], false);
  assert.match(offline, /data-tone="error"/);
  assert.match(offline, /서버 연결 끊김/);
  assert.match(offline, /마지막으로 받은 정보/);
  assert.doesNotMatch(offline, /data-tone="healthy"/);
  assert.match(connectionSummary(agent, providers[1], false), /서버 연결 끊김/);
  assert.equal(agent.connection.status, 'connected');
  assert.match(connectionMarkup(agent, providers[1]), /data-tone="healthy"/);
  assert.match(connectionMarkup(agent, providers[1]), /data-revision="4"/);
  assert.equal(connectionMarkup(agent, providers[0], false), '');
});
