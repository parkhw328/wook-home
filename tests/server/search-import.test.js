import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionSearch } from '../../server/session-search.js';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';

const input = { clientId: '10000000-0000-4000-8000-000000000001', url: 'https://claude.ai/chat/10000000-0000-4000-8000-000000000002?drop=1', role: 'user', content: '한글 보관 자료 password=secret-value /home/example/private/work.txt' };

test('explicit paste works without enabling automatic capture and deduplicates retries', async (t) => {
  const search = createSessionSearch(); t.after(() => search.close());
  search.importWeb(input); search.importWeb(input);
  assert.equal((await search.status()).webEnabled, false);
  const result = await search.query({ query: '한글 보관' });
  assert.equal(result.total, 1); assert.equal(result.results[0].session.state, 'stored');
  const detail = await search.detail(result.results[0].session.id);
  assert.equal(detail.session.url, input.url.split('?')[0]);
  assert.doesNotMatch(JSON.stringify(detail), /secret-value|drop=1|\/home\/example/);
  assert.throws(() => search.receiveWeb({ clientId: input.clientId, sessions: [] }), { code: 'SEARCH_CAPTURE_DISABLED' });
});

test('manual imports require a supported conversation, public role and bounded text', async (t) => {
  const search = createSessionSearch(); t.after(() => search.close());
  for (const update of [{ url: 'https://claude.ai/' }, { url: 'https://claude.ai.evil.test/chat/id' }, { role: 'system' }, { content: ' ' }, { content: '한'.repeat(20001) }, { content: '# AGENTS.md instructions\nprivate' }, { clientId: 'invalid' }]) {
    assert.throws(() => search.importWeb({ ...input, ...update }));
  }
  assert.equal((await search.query({})).total, 0);
});

test('HTTP import accepts Korean at the text limit and rejects cross-origin writes', async (t) => {
  const store = createStore(':memory:'); const server = createHttpServer(createOffice(store));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (values, origin = base) => fetch(`${base}/api/search/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(values) });
  assert.equal((await send({ ...input, content: '한'.repeat(20000) })).status, 200);
  const denied = await send(input, 'https://outside.example');
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'ORIGIN_REJECTED');
});
