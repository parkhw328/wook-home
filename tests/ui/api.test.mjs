import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, ApiError } from '../../public/api.mjs';

test('mutating requests use same-origin JSON and never retry a conflict', async (context) => {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({ error: { code: 'OFFICE_PAUSED', message: '사무실이 일시 중지되었습니다.' } }), { status: 409 });
  });
  await assert.rejects(() => apiRequest('/tasks', { method: 'POST', body: { title: '한 번만 실행' } }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'OFFICE_PAUSED');
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/tasks');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), { title: '한 번만 실행' });
});

test('network failure stays an explicit connection error without replaying a mutation', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('network down'); });
  await assert.rejects(() => apiRequest('/agents', { method: 'POST', body: { name: '테스트' } }), (error) => {
    assert.equal(error.code, 'CONNECTION_ERROR');
    assert.match(error.message, /연결/);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('non-JSON responses are not interpreted as successful application state', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('<html>proxy error</html>'));
  await assert.rejects(() => apiRequest('/state'), /서버 응답/);
});

test('successful responses keep server-provided states intact', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ status: 'waiting_approval', result: '체험용 결과' })));
  assert.deepEqual(await apiRequest('/tasks/one/messages', { method: 'POST', body: { content: '답변' } }), { status: 'waiting_approval', result: '체험용 결과' });
});
