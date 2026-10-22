import test from 'node:test';
import assert from 'node:assert/strict';
import { entryDescription, entryStatus, filterEntries, checksMarkup, entriesMarkup, sourcesMarkup } from '../../public/discovery.mjs';

test('web pages and chats never claim work execution, login or CLI control', () => {
  const page = { source: 'web', kind: 'page', status: 'open', tabCount: 2, scope: '브라우저 test' };
  assert.equal(entryStatus(page), '탭 열림');
  assert.match(entryDescription(page), /서비스·새 대화 화면 · 2개 탭/);
  assert.equal(entryStatus({ ...page, status: 'disconnected' }), '감지 연결 끊김');
  assert.match(entryDescription({ ...page, kind: 'conversation' }), /대화 탭/);
  assert.equal(entryStatus({ source: 'cli', kind: 'process', status: 'exited' }), '종료 감지');
  assert.equal(entryStatus({ ...page, status: 'unknown' }), '확인 필요');
  assert.equal(entryStatus({ source: 'cli', kind: 'process', status: 'unavailable' }), '확인 필요');
  assert.match(entryDescription({ source: 'cli', kind: 'process', scope: '이 PC · Linux 같은 사용자' }), /Linux 같은 사용자/);
});

test('current observations remain distinct from ended processes and stale last-received rows', () => {
  const entry = { id: 'process:example', source: 'cli', kind: 'process', name: 'Codex', status: 'running', canRegister: true };
  assert.match(entriesMarkup([entry]), /data-tone="healthy"/);
  assert.match(entriesMarkup([{ ...entry, status: 'exited', canRegister: false }]), /data-tone="neutral"/);
  assert.match(entriesMarkup([{ ...entry, status: 'unknown', canRegister: false }]), /data-tone="warning"/);
  const offline = entriesMarkup([entry], false);
  assert.match(offline, /data-tone="error"/);
  assert.match(offline, /서버 연결 끊김/);
  assert.match(offline, /data-connect-entry="process:example" disabled/);
  assert.doesNotMatch(offline, /data-tone="healthy"|실행 중/);
  const checks = checksMarkup([{ status: 'reachable', statusLabel: '응답 정상' }], false);
  assert.match(checks, /마지막 수신 결과/);
  assert.doesNotMatch(checks, /data-tone="healthy"|응답 정상/);
});

test('source health stays independent of empty results and warns about partial browser observations', () => {
  const sources = { cli: { status: 'connected' }, processes: { status: 'unavailable' }, browsers: [{ status: 'connected', truncated: true }, { status: 'disconnected' }] };
  const markup = sourcesMarkup(sources);
  assert.match(markup, /data-tone="healthy"[^]*CLI 기록 · 감지 정상/);
  assert.match(markup, /CLI 프로세스 · 확인 불가/);
  assert.match(markup, /일부만 표시/);
  assert.equal((markup.match(/data-tone="warning"/g) || []).length, 2);
  const offline = sourcesMarkup(sources, false);
  assert.equal((offline.match(/data-tone="error"/g) || []).length, 4);
  assert.doesNotMatch(offline, /감지 정상/);
});

test('source and provider filters retain every matching entry without mixing CLI and web identities', () => {
  const rows = [{ source: 'cli', provider: 'openai' }, { source: 'web', provider: 'openai' }, { source: 'web', provider: 'claude' }];
  assert.equal(filterEntries(rows, 'all', 'all').length, 3);
  assert.deepEqual(filterEntries(rows, 'web', 'openai'), [rows[1]]);
  assert.deepEqual(filterEntries(rows, 'cli', 'claude'), []);
  assert.equal(rows.length, 3);
});

test('connection check text remains text even when a provider response contains markup', () => {
  const result = checksMarkup([{ name: '<script>bad()</script>', message: '"value" <img src=x>', action: 'check & retry', statusLabel: '<connected>' }]);
  assert.doesNotMatch(result, /<script>|<img/);
  assert.match(result, /&lt;script&gt;/);
  assert.match(result, /check &amp; retry/);
  assert.match(result, /확인 시각: 미점검/);
  const checked = checksMarkup([{ name: 'API', checkedAt: '2026-10-22T00:00:00.000Z' }]);
  assert.doesNotMatch(checked, /미점검|1970/);
});
