import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';

test('connection routes expose metadata, reject caller credentials and enforce the office origin', async (t) => {
  const store = createStore(':memory:');
  const server = createHttpServer(createOffice(store));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const initial = await fetch(base + '/api/connections');
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  const body = await initial.json();
  assert.equal(body.checkedAt, null);
  assert.equal(body.checks.length, 15);
  assert.ok(body.checks.filter((check) => check.source === 'api').every((check) => !check.canControl));
  // Never send a valid check in this test: inherited host credentials must not be used.
  const invalid = await fetch(base + '/api/connections/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://untrusted.invalid', apiKey: 'caller-secret' }) });
  assert.equal(invalid.status, 400);
  const error = await invalid.json();
  assert.equal(error.error.code, 'INVALID_CONNECTION_CHECK');
  assert.doesNotMatch(JSON.stringify(error), /caller-secret|untrusted/);
  const foreignRead = await fetch(base + '/api/connections', { headers: { Origin: 'https://untrusted.invalid' } });
  assert.equal(foreignRead.status, 403);
  const foreignCheck = await fetch(base + '/api/connections/check', { method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(foreignCheck.status, 403);
  const handoff = await (await fetch(base + '/api/handoff')).json();
  assert.ok(!Object.hasOwn(handoff, 'connections'));
  assert.ok(!Object.hasOwn(handoff, 'cliTools'));
  assert.equal((await (await fetch(base + '/api/connections')).json()).checkedAt, null);
});
