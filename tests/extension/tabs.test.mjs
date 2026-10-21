import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { identifyPage, isOfficeUrl, officeOrigins, summarizeTabs, SITE_PATTERNS } from '../../extensions/browser-observer/tabs.mjs';

const conversation = '00000000-0000-0000-0000-000000000001';
const client = '00000000-0000-0000-0000-000000000002';

test('four providers, multiple windows and duplicate conversations keep only anonymous metadata', async () => {
  const result = await summarizeTabs([
    { id: 1, windowId: 1, url: `https://chatgpt.com/c/${conversation}?token=private-secret`, title: 'private-title' },
    { id: 2, windowId: 2, url: `https://chatgpt.com/c/${conversation}#private-fragment` },
    { id: 3, url: `https://claude.ai/chat/${conversation}` },
    { id: 4, url: 'https://claude.ai/new' },
    { id: 5, url: 'https://gemini.google.com/app/1234567890abcdef' },
    { id: 6, url: `https://www.meta.ai/prompt/${conversation}` },
    { id: 7, url: 'https://meta.ai/' },
    { id: 8, url: 'https://claude.ai/new', incognito: true },
    { id: 9, url: 'https://private.example/account' },
  ], client);
  assert.equal(result.tabs.length, 7);
  assert.deepEqual([...new Set(result.tabs.map((tab) => tab.provider))], ['openai', 'claude', 'gemini', 'meta']);
  assert.equal(result.tabs[0].key, result.tabs[1].key);
  assert.notEqual(result.tabs[0].key, result.tabs[2].key);
  assert.equal(result.tabs[3].kind, 'page');
  assert.equal(result.tabs[6].kind, 'page');
  assert.doesNotMatch(JSON.stringify(result.tabs), /private-|https:|title|windowId|token|00000000-0000/);
  const other = await summarizeTabs([{ id: 1, url: `https://chatgpt.com/c/${conversation}` }], '00000000-0000-0000-0000-000000000003');
  assert.notEqual(result.tabs[0].key, other.tabs[0].key);
});

test('lookalike domains, wrong protocols, credentials and nonstandard ports are not AI tabs', () => {
  for (const url of ['https://claude.ai.attacker.example/chat/x', 'https://evilclaude.ai/', 'http://claude.ai/', 'https://private-secret@claude.ai/', 'https://claude.ai:444/', 'javascript:alert(1)', 'https://muse.ai/', 'https://ai.meta.com/muse/']) {
    assert.equal(identifyPage(url), null, url);
  }
  assert.equal(identifyPage('https://claude.ai/login').kind, 'page');
  assert.equal(identifyPage('https://gemini.google.com/app').kind, 'page');
});

test('closed and navigated-away tabs disappear; large inventories explicitly report truncation', async () => {
  const many = Array.from({ length: 130 }, (_, id) => ({ id, url: 'https://claude.ai/new' }));
  const result = await summarizeTabs(many, client);
  assert.equal(result.tabs.length, 128);
  assert.equal(result.truncated, true);
  assert.equal(new Set(result.tabs.map((tab) => tab.key)).size, 128);
  const empty = await summarizeTabs([{ id: 1, url: 'https://example.com/' }], client);
  assert.deepEqual(empty.tabs, []);
  assert.equal(empty.truncated, false);
});

test('the extension can be contacted only by a local office top-level URL', () => {
  assert.equal(isOfficeUrl('http://localhost:8080/'), true);
  assert.equal(isOfficeUrl('http://127.0.0.1:8081/index.html#office'), true);
  for (const value of ['http://localhost.attacker.com/', 'https://localhost/', 'http://user:password@localhost/', 'http://localhost/unrelated', 'http://192.168.0.1/']) assert.equal(isOfficeUrl(value), false);
  assert.deepEqual(officeOrigins(), ['http://localhost:8080', 'http://127.0.0.1:8080']);
  assert.deepEqual(officeOrigins('http://127.0.0.1:8082/'), ['http://localhost:8082', 'http://127.0.0.1:8082']);
  assert.throws(() => officeOrigins('https://remote.example/'));
});

test('manifest keeps scoped access and separates metadata discovery from gated AI message capture', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../extensions/browser-observer/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, SITE_PATTERNS);
  assert.deepEqual(manifest.content_scripts[0].matches, ['http://localhost/*', 'http://127.0.0.1/*']);
  assert.deepEqual(manifest.content_scripts[1].matches, SITE_PATTERNS);
  assert.deepEqual(manifest.content_scripts[1].js, ['capture-core.js', 'capture.js']);
  assert.equal(manifest.externally_connectable, undefined);
});

test('the actual background worker rejects remote callers and redacts its replies', async () => {
  let listener;
  let queries = 0;
  globalThis.chrome = {
    runtime: { onMessage: { addListener(value) { listener = value; } } },
    storage: { local: { async get() { return { clientId: client }; }, async set() {} } },
    tabs: { async query(options) { queries += 1; assert.deepEqual(options.url, SITE_PATTERNS); return [{ id: 1, title: 'private-title', url: 'https://claude.ai/new?token=private-token' }]; } },
  };
  try {
    await import('../../extensions/browser-observer/background.mjs');
    assert.equal(listener({ type: 'stackqueue:collect' }, { url: 'https://claude.ai/', tab: {}, frameId: 0 }, () => assert.fail()), undefined);
    assert.equal(listener({ type: 'stackqueue:collect' }, { url: 'http://localhost:8080/', tab: {}, frameId: 1 }, () => assert.fail()), undefined);
    assert.equal(queries, 0);
    const denied = await new Promise((done) => listener({ type: 'stackqueue:collect' }, { url: 'http://localhost:4444/', tab: {}, frameId: 0 }, done));
    assert.equal(denied.ok, false);
    assert.equal(queries, 0);
    const response = await new Promise((done) => listener({ type: 'stackqueue:collect' }, { url: 'http://localhost:8080/', tab: {}, frameId: 0 }, done));
    assert.equal(response.ok, true);
    assert.equal(response.snapshot.tabs.length, 1);
    assert.doesNotMatch(JSON.stringify(response), /private-|token|title|https:/);
  } finally { delete globalThis.chrome; }
});
