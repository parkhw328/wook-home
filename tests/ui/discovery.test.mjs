import test from 'node:test';
import assert from 'node:assert/strict';
import { entryDescription, entryStatus, filterEntries, checksMarkup } from '../../public/discovery.mjs';

test('web pages and chats never claim work execution, login or CLI control', () => {
  const page = { source: 'web', kind: 'page', status: 'open', tabCount: 2, scope: '브라우저 test' };
  assert.equal(entryStatus(page), '탭 열림');
  assert.match(entryDescription(page), /서비스·새 대화 화면 · 2개 탭/);
  assert.equal(entryStatus({ ...page, status: 'disconnected' }), '감지 연결 끊김');
  assert.match(entryDescription({ ...page, kind: 'conversation' }), /대화 탭/);
  assert.equal(entryStatus({ source: 'cli', kind: 'process', status: 'exited' }), '종료 감지');
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
