import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createSessionSearch, canonicalConversation } from '../../server/session-search.js';
import { readSearchHistory, createSearchHistoryCollector } from '../../scripts/lib/session-search-history.mjs';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const id = '10000000-0000-0000-0000-000000000001';
const timestamp = '2026-10-22T10:00:00.000Z';
const msg = (role, text, extra = {}) => ({ type: 'response_item', timestamp, payload: { type: 'message', role, content: [{ type: 'input_text', text }], ...extra } });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'office-search-'));
  const cleanup = { close: null };
  t.after(() => { cleanup.close?.(); rmSync(root, { recursive: true, force: true }); });
  const workspace = join(root, 'workspace');
  const sessionsDir = join(root, 'sessions');
  const output = join(root, 'bridge', 'search-history');
  const archiveDir = join(root, 'archived_sessions');
  const claudeDir = join(root, 'claude');
  const geminiDir = join(root, 'gemini');
  for (const dir of [workspace, sessionsDir, output, archiveDir, claudeDir, geminiDir]) mkdirSync(dir, { recursive: true });
  return { root, workspace, sessionsDir, output, archiveDir, claudeDir, geminiDir, cleanup, clock: () => Date.parse(timestamp) };
}
const writeLines = (path, lines) => writeFileSync(path, lines.map(JSON.stringify).join('\n') + '\n');
const web = (messages, observation = 'open') => ({ clientId: id, sessions: [{ provider: 'claude', url: `https://claude.ai/chat/${id}?private=discard`, observation,
  messages: messages.map((content, index) => ({ key: hash(String(index)), role: index % 2 ? 'assistant' : 'user', content, timestamp })) }] });

test('history includes old archived Codex dialogue, excludes other projects and hidden channels', async (t) => {
  const f = fixture(t);
  const file = join(f.archiveDir, 'rollout-old.jsonl');
  writeLines(file, [{ type: 'session_meta', payload: { id, cwd: f.workspace } },
    msg('system', 'hidden-system'), msg('assistant', 'hidden-thought', { channel: 'analysis' }),
    msg('user', '# AGENTS.md instructions\nhidden-instructions'),
    { type: 'response_item', payload: { type: 'function_call_output', output: 'hidden-tool' } },
    msg('user', '지난 작업 자료 api_key=private-value'), msg('assistant', '완료 자료', { channel: 'final' })]);
  const record = await readSearchHistory(file, 'openai', f.workspace);
  assert.equal(record.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(record), /hidden-|private-value/);
  assert.equal(await readSearchHistory(file, 'openai', f.root), null);
  const manifest = await createSearchHistoryCollector(f).collect();
  assert.equal(manifest.items.length, 1);
  assert.equal(manifest.items[0].provider, 'openai');
});

test('Claude and Gemini adapters select public text, enforce project identity and apply Gemini edits', async (t) => {
  const f = fixture(t);
  const claude = join(f.claudeDir, `${id}.jsonl`);
  writeLines(claude, [{ type: 'user', cwd: f.workspace, sessionId: id, uuid: 'a', timestamp, message: { content: '사용자 자료' } },
    { type: 'assistant', cwd: f.workspace, sessionId: id, uuid: 'b', timestamp, message: { content: [{ type: 'thinking', thinking: 'hidden-thought' }, { type: 'tool_use', input: 'hidden-tool' }, { type: 'text', text: 'Claude 자료' }] } }]);
  assert.equal((await readSearchHistory(claude, 'claude', f.workspace)).messages.length, 2);
  assert.equal(await readSearchHistory(claude, 'claude', f.root), null);
  const gemini = join(f.geminiDir, 'session-old.jsonl');
  writeLines(gemini, [{ sessionId: id, projectHash: hash(resolve(f.workspace)), kind: 'main' },
    { id: 'a', type: 'user', content: '원래 자료', timestamp },
    { id: 'b', type: 'gemini', content: [{ text: '숨긴 생각', thought: true }, { text: '공개 자료' }], thoughts: ['hidden-thought'], timestamp },
    { $patch: { updates: [{ id: 'a', content: '수정된 자료' }], removeIds: ['b'] } }]);
  const data = await readSearchHistory(gemini, 'gemini', f.workspace);
  assert.equal(data.messages.length, 1);
  assert.equal(data.messages[0].content, '수정된 자료');
  assert.equal(await readSearchHistory(gemini, 'gemini', f.root), null);
});

test('search survives restart, uses literal Korean/case-insensitive queries, filters, paging and safe URLs', async (t) => {
  const f = fixture(t);
  let now = Date.parse(timestamp);
  let search = createSessionSearch({ directory: f.root, clock: () => now });
  assert.throws(() => search.receiveWeb(web(['자료'])), { code: 'SEARCH_CAPTURE_DISABLED' });
  search.configure({ webEnabled: true });
  search.receiveWeb(web(Array.from({ length: 65 }, (_, i) => `검색 자료 ABC ${i} 100% _ literal <script>alert(1)</script>`)));
  assert.equal((await search.query({ query: '검색 자료 abc' })).total, 65);
  assert.equal((await search.query({ query: '%' })).total, 65);
  assert.equal((await search.query({ query: '.*' })).total, 0);
  assert.equal((await search.query({ role: 'assistant' })).total, 32);
  assert.equal((await search.query({ source: 'cli' })).total, 0);
  assert.equal((await search.query({ state: 'current' })).total, 65);
  assert.equal((await search.query({ offset: 60 })).results.length, 5);
  const result = (await search.query({})).results[0];
  assert.equal(result.session.url, `https://claude.ai/chat/${id}`);
  assert.equal((await search.detail(result.session.id)).messages.length, 65);
  search.receiveWeb(web([], 'closed'));
  assert.equal((await search.query({ state: 'stored' })).total, 65);
  search.close();
  now += 40000;
  search = createSessionSearch({ directory: f.root, clock: () => now });
  f.cleanup.close = () => search.close();
  assert.equal((await search.query({ query: '자료' })).total, 65);
  assert.equal((await search.query({})).results[0].session.observation, 'disconnected');
  assert.equal(canonicalConversation('claude', `https://claude.ai.evil.test/chat/${id}`), null);
  assert.equal(canonicalConversation('claude', `https://user:secret@claude.ai/chat/${id}`), null);
  await assert.rejects(search.detail('../office'), { code: 'SEARCH_SESSION_NOT_FOUND' });
});

test('partial browser updates preserve previous messages and malformed batches do not partially import', async (t) => {
  const search = createSessionSearch();
  t.after(() => search.close());
  search.configure({ webEnabled: true });
  search.receiveWeb(web(['첫 메시지', '답변']));
  search.receiveWeb(web(['수정된 첫 메시지']));
  assert.equal((await search.query({})).total, 2);
  assert.equal((await search.query({ query: '수정된' })).total, 1);
  const bad = web(['저장하면 안 됨']);
  bad.sessions.push({ provider: 'unknown', url: 'https://outside.test', observation: 'open', messages: [] });
  assert.throws(() => search.receiveWeb(bad), { code: 'INVALID_SEARCH_DATA' });
  assert.equal((await search.query({ query: '저장하면' })).total, 0);
  search.configure({ webEnabled: false });
  assert.equal((await search.query({})).total, 2);
});

test('normalized searches keep the matching text in excerpts when Unicode source offsets differ', async (t) => {
  const search = createSessionSearch();
  t.after(() => search.close());
  search.configure({ webEnabled: true });
  search.receiveWeb(web(['ﬁ'.repeat(200) + 'needle', '한'.repeat(200) + '대상 자료']));
  const expanded = await search.query({ query: 'needle' });
  assert.equal(expanded.total, 1);
  assert.match(expanded.results[0].snippet, /needle/);
  const composed = await search.query({ query: '대상' });
  assert.equal(composed.total, 1);
  assert.match(composed.results[0].snippet, /대상 자료/);
});

test('CLI imports are opt-in and project scoped; ended sessions remain searchable after bridge disconnection', async (t) => {
  const f = fixture(t);
  const bridgeFile = join(f.root, 'bridge', 'codex.json');
  writeLines(join(f.archiveDir, 'rollout-old.jsonl'), [{ type: 'session_meta', payload: { id, cwd: f.workspace } }, msg('user', '보관 자료')]);
  await createSearchHistoryCollector(f).collect();
  const bridge = { schemaVersion: 1, generatedAt: timestamp, sessions: [], searchHistory: { enabled: false } };
  writeFileSync(bridgeFile, JSON.stringify(bridge));
  const search = createSessionSearch({ bridgeFile, clock: f.clock, observer: { snapshot: () => ({ status: 'connected', sessions: [{ id }] }) } });
  t.after(() => search.close());
  await search.sync(true);
  assert.equal((await search.query({})).total, 0);
  writeFileSync(bridgeFile, JSON.stringify({ ...bridge, searchHistory: { enabled: true } }));
  await search.sync(true);
  assert.equal((await search.query({ query: '보관' })).total, 1);
  assert.equal((await search.query({ state: 'current' })).total, 1);
  rmSync(bridgeFile);
  await search.sync(true);
  assert.equal((await search.query({ query: '보관' })).total, 1);
});

test('CLI collection reports stopped, stale and future bridges without losing saved search records', async (t) => {
  const f = fixture(t);
  const bridgeFile = join(f.root, 'bridge', 'codex.json');
  writeLines(join(f.archiveDir, 'rollout-old.jsonl'), [{ type: 'session_meta', payload: { id, cwd: f.workspace } }, msg('user', '보관 유지')]);
  await createSearchHistoryCollector(f).collect();
  const bridge = { schemaVersion: 1, generatedAt: timestamp, sessions: [], searchHistory: { enabled: true } };
  writeFileSync(bridgeFile, JSON.stringify(bridge));
  const search = createSessionSearch({ bridgeFile, clock: f.clock });
  t.after(() => search.close());
  assert.equal((await search.status()).collection, 'enabled');
  for (const change of [
    { stopped: true },
    { generatedAt: new Date(f.clock() - 21000).toISOString() },
    { generatedAt: new Date(f.clock() + 6000).toISOString() },
  ]) {
    writeFileSync(bridgeFile, JSON.stringify({ ...bridge, ...change }));
    await search.sync(true);
    assert.equal((await search.status()).collection, 'disconnected');
    assert.equal((await search.query({ query: '보관 유지' })).total, 1);
  }
  writeFileSync(bridgeFile, JSON.stringify(bridge));
  await search.sync(true);
  assert.equal((await search.status()).collection, 'enabled');
});

test('unreadable CLI records are counted and invalid bridge data is not reported as disabled capture', async (t) => {
  const f = fixture(t);
  const bridgeFile = join(f.root, 'bridge', 'codex.json');
  writeLines(join(f.archiveDir, 'rollout-old.jsonl'), [{ type: 'session_meta', payload: { id, cwd: f.workspace } }, msg('user', '검증 자료')]);
  const manifest = await createSearchHistoryCollector(f).collect();
  writeFileSync(join(f.output, `${manifest.items[0].key}.json`), JSON.stringify({ schemaVersion: 9 }));
  writeFileSync(bridgeFile, JSON.stringify({ schemaVersion: 1, generatedAt: timestamp, sessions: [], searchHistory: { enabled: true } }));
  const search = createSessionSearch({ bridgeFile, clock: f.clock });
  t.after(() => search.close());
  const status = await search.status();
  assert.equal(status.cli.skipped, manifest.skipped + 1);
  assert.equal((await search.query({})).total, 0);

  writeFileSync(bridgeFile, '{');
  const restarted = createSessionSearch({ bridgeFile, clock: f.clock });
  t.after(() => restarted.close());
  assert.equal((await restarted.status()).collection, 'unavailable');
});

test('search API isolates private archives from state/handoff and rejects cross-origin capture and reads', async (t) => {
  const store = createStore(':memory:');
  const server = createHttpServer(createOffice(store));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, method = 'POST', extra = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  assert.equal((await request('/api/search/settings', { webEnabled: true }, 'PUT')).status, 200);
  assert.equal((await request('/api/search/web', web(['private-search-text']))).status, 200);
  assert.equal((await (await request('/api/search/query', { query: 'private-search' })).json()).total, 1);
  assert.equal((await request('/api/search/query', {}, 'POST', { Origin: 'https://outside.test' })).status, 403);
  assert.equal((await request('/api/search/web', web(['blocked']), 'POST', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/api/search/query', { query: 'x'.repeat(201) })).status, 400);
  for (const path of ['/api/state', '/api/handoff', '/api/search/status']) assert.doesNotMatch(await (await fetch(base + path)).text(), /private-search-text/);
});
