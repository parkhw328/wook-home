import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { collectSearchTabs, searchConversation, selectedConversations } from '../../extensions/browser-observer/search.mjs';

const id = '00000000-0000-0000-0000-000000000001';
const url = `https://claude.ai/chat/${id}`;

test('only individually chosen conversations are read; duplicate tabs, private tabs and missing layouts remain distinct', async () => {
  assert.equal(searchConversation('https://claude.ai/new'), null);
  assert.equal(searchConversation('https://claude.ai.evil.test/chat/' + id), null);
  assert.equal(selectedConversations([{ url }, { url: `${url}?private=value` }]).length, 1);
  const calls = [];
  const tabs = [{ id: 1, url }, { id: 2, url }, { id: 3, url, incognito: true }, { id: 4, url: 'https://gemini.google.com/app/abcdef123456' }];
  const capture = async (tabId, requested) => { calls.push(tabId); return { ok: true, url: requested, messages: [{ key: 'a'.repeat(64), role: 'assistant', content: '공개 자료' }] }; };
  assert.deepEqual(await collectSearchTabs(tabs, [], capture), []);
  assert.equal(calls.length, 0);
  const data = await collectSearchTabs(tabs, [{ url }], capture);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(data.length, 1);
  assert.equal(data[0].observation, 'open');
  assert.equal((await collectSearchTabs([], [{ url }], capture))[0].observation, 'closed');
  assert.equal((await collectSearchTabs(tabs, [{ url }], async () => ({ ok: false })))[0].observation, 'unavailable');
});

test('the real AI content script checks conversation opt-in and extension sender before reading DOM', async () => {
  const source = await readFile(new URL('../../extensions/browser-observer/capture.js', import.meta.url), 'utf8');
  let listener;
  let selected = [];
  let reads = 0;
  const window = {}; window.top = window;
  const context = { window, location: { hostname: 'claude.ai', pathname: `/chat/${id}` }, document: {}, crypto: webcrypto, TextEncoder,
    chrome: { runtime: { id: 'self', onMessage: { addListener(fn) { listener = fn; } } }, storage: { local: { async get() { return { searchSelections: selected }; } } } },
    StackQueueCapture: { extract() { reads += 1; return [{ role: 'user', content: '선택한 공개 메시지', identity: 'message-1' }]; } } };
  runInNewContext(source, context);
  const message = { type: 'stackqueue:capture-public', url };
  assert.equal(listener(message, { id: 'foreign' }, () => assert.fail()), undefined);
  assert.equal((await new Promise((done) => listener(message, { id: 'self' }, done))).ok, false);
  assert.equal(reads, 0);
  selected = [{ url }];
  const captured = await new Promise((done) => listener(message, { id: 'self' }, done));
  assert.equal(captured.ok, true);
  assert.equal(captured.messages.length, 1);
  assert.match(captured.messages[0].key, /^[a-f0-9]{64}$/);
  context.location.pathname = '/new';
  assert.equal((await new Promise((done) => listener(message, { id: 'self' }, done))).ok, false);
  assert.equal(reads, 1);
});

test('public extraction never falls back to page body or retains marked thought/tool/UI nodes', async () => {
  const source = await readFile(new URL('../../extensions/browser-observer/capture-core.js', import.meta.url), 'utf8');
  const context = {};
  runInNewContext(source, context);
  let selection;
  let removed;
  const node = {
    closest: () => null, getAttribute: (name) => name === 'data-message-author-role' ? 'assistant' : null, id: 'answer',
    cloneNode: () => ({ textContent: '공개 답변', querySelectorAll: (value) => { removed = value; return [{ remove() {} }]; } }),
  };
  const root = { querySelectorAll: (value) => { selection = value; return [node]; } };
  const result = context.StackQueueCapture.extract(root, 'openai');
  assert.equal(result[0].content, '공개 답변');
  assert.match(selection, /data-message-author-role/);
  assert.match(removed, /reasoning/);
  assert.match(removed, /thoughts-panel/);
  assert.match(removed, /tool-result/);
  assert.equal(context.StackQueueCapture.extract({ querySelectorAll: () => [] }, 'meta').length, 0);
  assert.doesNotMatch(source, /document\.body|innerHTML|cookie|localStorage/);
});
