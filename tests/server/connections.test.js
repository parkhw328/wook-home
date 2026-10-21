import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnections } from '../../server/connections.js';
import { collectCliTools } from '../../scripts/lib/cli-tools.mjs';
import { readCliTools } from '../../server/cli-tools.js';

function fixture(options = {}) {
  let now = Date.parse('2026-10-21T12:00:00Z');
  const cli = { status: 'not_connected', updatedAt: null, sessions: [], control: { enabled: false } };
  const browser = { sources: { browsers: [] }, entries: [] };
  const connections = createConnections({ observer: { snapshot: () => cli }, discovery: { snapshot: () => browser },
    env: {}, fetchImpl: () => { throw new Error('Unexpected network access'); }, clock: () => now, ...options });
  return { connections, cli, browser, advance: (ms) => { now += ms; } };
}
const rows = (value) => value.checks.filter((check) => check.source === 'api');
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('unconfigured checks never use network, reject browser secrets and keep capabilities separate', async () => {
  const { connections } = fixture();
  assert.equal(connections.snapshot().checks.length, 15);
  assert.ok(rows(await connections.check({})).every((row) => row.status === 'not_configured' && !row.canControl));
  for (const input of [null, [], { url: 'http://127.0.0.1' }, { apiKey: 'secret' }, { provider: 'openai' }]) {
    await assert.rejects(connections.check(input), (error) => error.code === 'INVALID_CONNECTION_CHECK');
  }
});

test('official read-only probes keep credentials in headers and expose no raw model/account data', async () => {
  const calls = [];
  const { connections } = fixture({ env: { OPENAI_API_KEY: 'test-openai', ANTHROPIC_API_KEY: 'test-anthropic', ANTHROPIC_WORKSPACE_ID: 'test-workspace',
    GEMINI_API_KEY: 'test-gemini', GOOGLE_API_KEY: 'unused-google', MODEL_API_KEY: 'test-meta', META_API_KEY: 'unused-meta' },
  fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(url.includes('googleapis.com') ? { models: [{ name: 'private-model-name' }] } : { data: [{ id: 'private-model-name', owned_by: 'private-owner' }] });
  } });
  assert.ok(rows(connections.snapshot()).every((row) => row.status === 'not_checked'));
  const checked = await connections.check({});
  assert.equal(calls.length, 4);
  assert.ok(rows(checked).every((row) => row.status === 'reachable' && row.configured && !row.canControl));
  assert.ok(calls.every(({ options, url }) => options.method === 'GET' && options.redirect === 'manual' && !options.body && url.startsWith('https://') && !url.includes('test-')));
  assert.equal(calls.find(({ url }) => url.includes('openai')).options.headers.Authorization, 'Bearer test-openai');
  assert.equal(calls.find(({ url }) => url.includes('anthropic')).options.headers['x-api-key'], 'test-anthropic');
  assert.equal(calls.find(({ url }) => url.includes('anthropic')).options.headers['anthropic-workspace-id'], 'test-workspace');
  assert.equal(calls.find(({ url }) => url.includes('googleapis')).options.headers['x-goog-api-key'], 'test-gemini');
  assert.equal(calls.find(({ url }) => url.includes('meta')).options.headers.Authorization, 'Bearer test-meta');
  assert.doesNotMatch(JSON.stringify(checked), /test-openai|test-anthropic|test-workspace|test-gemini|test-meta|private-model-name|private-owner/);
});

test('concurrent checks share requests, throttle repeated checks and mark results stale', async () => {
  let finish;
  let calls = 0;
  const { connections, advance } = fixture({ env: { OPENAI_API_KEY: 'test-secret' }, fetchImpl: () => {
    calls += 1;
    return new Promise((resolve) => { finish = () => resolve(response({ data: [] })); });
  } });
  const first = connections.check({});
  const second = connections.check({});
  assert.equal(rows(connections.snapshot())[0].status, 'checking');
  finish();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(rows(a)[0].status, 'no_models');
  assert.equal(rows(b)[0].status, 'no_models');
  await connections.check({});
  assert.equal(calls, 1);
  advance(300001);
  assert.equal(rows(connections.snapshot())[0].status, 'stale');
  const recovery = connections.check({});
  finish();
  await recovery;
  assert.equal(calls, 2);
  assert.equal(rows(connections.snapshot())[0].status, 'no_models');
});

test('HTTP errors and redirects are classified without reading supplier error bodies', async () => {
  for (const [httpStatus, expected] of [[401, 'auth_failed'], [403, 'forbidden'], [429, 'rate_limited'], [503, 'service_error'], [400, 'request_rejected'], [302, 'redirect_blocked']]) {
    const { connections } = fixture({ env: { OPENAI_API_KEY: 'test-secret' }, fetchImpl: async () => response({ error: 'credential test-secret private-path' }, httpStatus, { location: 'https://untrusted.invalid' }) });
    const checked = await connections.check({});
    assert.equal(rows(checked)[0].status, expected);
    assert.equal(rows(checked)[0].httpStatus, httpStatus);
    assert.doesNotMatch(JSON.stringify(checked), /test-secret|private-path|untrusted/);
  }
});

test('timeout and network failure stay distinct and recover after cooldown', async () => {
  let mode = 'timeout';
  const { connections, advance } = fixture({ env: { OPENAI_API_KEY: 'test-secret' }, timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => {
      if (mode === 'timeout') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('test-secret')), { once: true }));
      if (mode === 'network') throw new Error('private host and test-secret');
      return response({ data: [{ id: 'model' }] });
    } });
  assert.equal(rows(await connections.check({}))[0].status, 'timeout');
  advance(30001); mode = 'network';
  const failed = await connections.check({});
  assert.equal(rows(failed)[0].status, 'network_error');
  assert.doesNotMatch(JSON.stringify(failed), /test-secret|private host/);
  advance(30001); mode = 'ready';
  assert.equal(rows(await connections.check({}))[0].status, 'reachable');
});

test('success status alone cannot validate an HTML, malformed or oversized body', async () => {
  const samples = [
    () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => response({ data: [{ error: 'no model' }] }),
    () => response({ models: [] }),
    () => response({ data: [], padding: 'x'.repeat(262145) }),
    () => response({ data: [] }, 200, { 'content-length': '262145' }),
  ];
  for (const fetchImpl of samples) {
    const { connections } = fixture({ env: { OPENAI_API_KEY: 'test-secret' }, fetchImpl });
    assert.equal(rows(await connections.check({}))[0].status, 'invalid_response');
  }
});

test('the timeout also covers a real HTTP response whose JSON body never finishes', async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{"data":[');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const { connections } = fixture({ env: { OPENAI_API_KEY: 'local-test-only' }, timeoutMs: 60,
    fetchImpl: (_url, options) => fetch(`http://127.0.0.1:${server.address().port}`, options) });
  assert.equal(rows(await connections.check({}))[0].status, 'timeout');
});

test('invalid local credentials are not sent and documented aliases work', async () => {
  const { connections } = fixture({ env: { OPENAI_API_KEY: 'invalid\nvalue' } });
  assert.equal(rows(await connections.check({}))[0].status, 'config_invalid');
  const calls = [];
  const alias = fixture({ env: { GOOGLE_API_KEY: 'google-fallback', META_API_KEY: 'meta-fallback' }, fetchImpl: async (url, options) => {
    calls.push(options.headers);
    return response(url.includes('googleapis') ? { models: [] } : { data: [] });
  } });
  await alias.connections.check({});
  assert.equal(calls[0]['x-goog-api-key'], 'google-fallback');
  assert.equal(calls[1].Authorization, 'Bearer meta-fallback');
});

test('web presence, bridge freshness and CLI capabilities are not API authentication', () => {
  const { connections, cli, browser } = fixture();
  cli.status = 'connected'; cli.control.enabled = true;
  browser.sources.browsers.push({ status: 'connected', updatedAt: '2026-10-21T12:00:00Z' });
  browser.entries.push({ source: 'web', provider: 'claude', status: 'open', tabCount: 2 });
  let checked = connections.snapshot();
  assert.equal(checked.checks.find((row) => row.id === 'web:claude').status, 'detected');
  assert.equal(checked.checks.find((row) => row.id === 'web:openai').status, 'no_tabs');
  assert.equal(checked.checks.find((row) => row.id === 'cli:codex').canControl, true);
  assert.ok(rows(checked).every((row) => row.status === 'not_configured'));
  cli.status = 'disconnected';
  browser.sources.browsers[0].status = 'disconnected'; browser.entries[0].status = 'disconnected';
  checked = connections.snapshot();
  assert.equal(checked.checks.find((row) => row.id === 'web:claude').status, 'disconnected');
  assert.equal(checked.checks.find((row) => row.id === 'cli:codex').canControl, false);
});

test('one fresh browser profile cannot hide another disconnected profile as no tabs', () => {
  const { connections, browser } = fixture();
  browser.sources.browsers.push({ status: 'connected' }, { status: 'disconnected' });
  const web = connections.snapshot().checks.filter((check) => check.source === 'web');
  assert.ok(web.every((check) => check.status === 'partial' && !check.canControl));
});

test('CLI process detection wins over PATH absence without claiming session control', () => {
  const { connections, cli } = fixture();
  cli.status = 'connected';
  cli.processes = { status: 'connected', platform: 'linux', updatedAt: '2026-10-21T12:00:00Z', items: [{ provider: 'claude', status: 'running' }] };
  cli.cliTools = [{ id: 'claude', installed: false }, { id: 'gemini', installed: true }];
  const checked = connections.snapshot();
  assert.equal(checked.checks.find((row) => row.id === 'cli:claude').status, 'process_detected');
  assert.equal(checked.checks.find((row) => row.id === 'cli:claude').canControl, false);
  assert.equal(checked.checks.find((row) => row.id === 'cli:gemini').status, 'not_running');
  assert.match(checked.checks.find((row) => row.id === 'cli:processes').message, /Linux 같은 사용자/);
  cli.processes.status = 'unavailable';
  assert.equal(connections.snapshot().checks.find((row) => row.id === 'cli:processes').status, 'unavailable');
});

test('CLI installation observation only checks bounded absolute PATH candidates', async () => {
  const inspected = [];
  const tools = await collectCliTools({ platform: 'win32', env: { PATH: 'C:\\Tools;;.\u003bC:\\Other' }, statImpl: async (path) => {
    inspected.push(path);
    if (path === 'C:\\Tools\\codex.cmd') return { isFile: () => true };
    if (path === 'C:\\Tools\\claude.exe') throw Object.assign(new Error('private'), { code: 'EACCES' });
    throw Object.assign(new Error('absent'), { code: 'ENOENT' });
  } });
  assert.deepEqual(tools, [{ id: 'codex', installed: true }, { id: 'claude', installed: null }, { id: 'gemini', installed: false }, { id: 'muse', installed: null }]);
  assert.ok(inspected.every((path) => path.startsWith('C:\\Tools\\') || path.startsWith('C:\\Other\\')));
  assert.doesNotMatch(JSON.stringify(tools), /C:|private/);
  assert.ok(readCliTools(tools, false).every((tool) => tool.installed === null));
  assert.deepEqual(readCliTools([{ id: 'claude', installed: true, path: 'secret' }], true)[1], { id: 'claude', installed: true });
});
