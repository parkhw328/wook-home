import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';
import { summarizeTabs } from '../../extensions/browser-observer/tabs.mjs';

const id = '00000000-0000-0000-0000-000000000001';
const client = '00000000-0000-0000-0000-000000000002';
const now = Date.parse('2026-10-21T12:00:00Z');

test('HTTP path receives real extension output, rejects cross-origin writes and keeps observations out of handoff', async (t) => {
  const store = createStore(':memory:');
  const office = createOffice(store);
  const server = createHttpServer(office, { clock: () => now });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = await summarizeTabs([
    { id: 1, url: `https://chatgpt.com/c/${id}?token=private-secret`, title: 'private-title' },
    { id: 2, url: 'https://claude.ai/new' }, { id: 3, url: 'https://gemini.google.com/app' }, { id: 4, url: 'https://www.meta.ai/' },
  ], client, now);
  const write = (headers = {}) => fetch(base + '/api/discovery/browser', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await write({ Origin: 'https://claude.ai' })).status, 403);
  assert.equal((await write({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await write({ Origin: base })).status, 200);
  const result = await (await fetch(base + '/api/discovery')).json();
  assert.equal(result.counts.webTabs, 4);
  assert.equal(result.counts.webConversations, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-|https:|token|title/);
  const handoff = await (await fetch(base + '/api/handoff')).text();
  assert.doesNotMatch(handoff, /webTabs|browsers|discovery|00000000-0000/);
  assert.equal((await fetch(base + `/api/discovery/browser/${client}`, { method: 'DELETE', headers: { Origin: base } })).status, 200);
  assert.equal((await (await fetch(base + '/api/discovery')).json()).counts.webTabs, 0);
});
