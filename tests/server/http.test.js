import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wook-home-http-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Office</title>');
  writeFileSync(join(directory, 'app.mjs'), 'export const ready = true;');
  const store = createStore(':memory:');
  const server = createHttpServer(createOffice(store), { publicDir: directory });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { base, post };
}

test('HTTP contract supports hire, demo workflow, handoff and static modules', async (t) => {
  const { base, post } = await fixture(t);
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.status, 'ok');
  const response = await post('/api/agents', { name: '테스트 직원', role: '검토', provider: 'demo' });
  assert.equal(response.status, 201);
  const agent = await response.json();
  const task = await (await post('/api/tasks', { agentId: agent.id, title: 'API 업무' })).json();
  assert.equal(task.status, 'waiting_input');
  assert.equal((await post(`/api/tasks/${task.id}/messages`, { content: '확인' })).status, 200);
  assert.equal((await post(`/api/tasks/${task.id}/approve`, {})).status, 200);
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.tasks[0].status, 'completed');
  assert.equal(state.programs.length, 3);
  const handoff = await fetch(base + '/api/handoff');
  assert.match(handoff.headers.get('content-disposition'), /attachment/);
  assert.equal((await handoff.json()).tasks[0].id, task.id);
  const page = await fetch(base);
  assert.match(await page.text(), /Office/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const module = await fetch(base + '/app.mjs');
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /javascript/);
});

test('cross-origin and non-local Host requests cannot reach state or mutations', async (t) => {
  const { base, post } = await fixture(t);
  const denied = await post('/api/agents', { name: '직원', role: '검토', provider: 'demo' }, { Origin: 'https://example.invalid' });
  assert.equal(denied.status, 403);
  const read = await fetch(base + '/api/state', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(read.status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    get(base + '/api/state', { headers: { Host: 'example.invalid' } }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  const navigation = await fetch(base, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(navigation.status, 200);
  assert.equal((await (await fetch(base + '/api/state')).json()).agents.length, 0);
});

test('invalid JSON, unsupported fields and non-public files are rejected', async (t) => {
  const { base, post } = await fixture(t);
  const invalid = await fetch(base + '/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
  const contentType = await fetch(base + '/api/agents', { method: 'POST', body: '{}' });
  assert.equal(contentType.status, 415);
  assert.equal((await post('/api/agents', { apiKey: 'test-only' })).status, 400);
  for (const path of ['/resources/sample.jpg', '/server/index.js', '/.env', '/%2e%2e%2fpackage.json', '/api/missing']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
});

test('oversized payloads are rejected without registering an employee', async (t) => {
  const { base, post } = await fixture(t);
  const response = await post('/api/agents', { name: 'x'.repeat(40000), role: '검토', provider: 'demo' });
  assert.equal(response.status, 413);
  assert.equal((await (await fetch(base + '/api/state')).json()).agents.length, 0);
});
