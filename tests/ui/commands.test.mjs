import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommandDelivery, commandPresentation, commandUnavailableReason,
  loadCommandReceipts, saveCommandReceipts,
} from '../../public/commands.mjs';

const original = { id: 'one-id', sessionId: 'session', content: 'Review the result', status: 'new' };
const absent = () => Object.assign(new Error('missing'), { code: 'COMMAND_NOT_FOUND', status: 404 });
const offline = () => Object.assign(new Error('offline'), { code: 'CONNECTION_ERROR', status: 0 });

test('a lost POST response is recovered through a read without resending the command', async () => {
  const calls = [];
  const delivery = new CommandDelivery(async (path, options) => {
    calls.push({ path, options });
    if (options?.method === 'POST') throw offline();
    return { id: original.id, status: 'accepted' };
  }, original);
  await delivery.send();
  assert.equal(delivery.record.status, 'accepted');
  assert.equal(calls.filter((call) => call.options?.method === 'POST').length, 1);
  assert.equal(delivery.shouldPoll(), false);
  assert.match(commandPresentation(delivery.record).description, /작업 완료를 뜻하지 않습니다/);
});

test('an explicit retry rechecks the receipt and reuses the original id and content', async () => {
  const posts = [];
  let accepted = false;
  const delivery = new CommandDelivery(async (path, options) => {
    if (options?.method === 'POST') {
      posts.push(options.body);
      if (!accepted) throw offline();
      return { status: 'pending' };
    }
    throw absent();
  }, original);
  await delivery.send();
  assert.equal(delivery.record.status, 'not_found');
  assert.equal(posts.length, 1);
  accepted = true;
  await delivery.retry();
  assert.deepEqual(posts, [{ id: original.id, content: original.content }, { id: original.id, content: original.content }]);
  assert.equal(delivery.record.status, 'pending');
});

test('a receipt appearing before retry, or an uncertain lookup, prevents a second POST', async () => {
  for (const response of ['accepted', 'offline']) {
    const calls = [];
    const delivery = new CommandDelivery(async (path, options) => {
      calls.push(options?.method || 'GET');
      if (response === 'offline') throw offline();
      return { status: 'accepted' };
    }, { ...original, status: 'not_found' });
    await delivery.retry();
    assert.deepEqual(calls, ['GET']);
  }
});

test('concurrent sends and terminal uncertain delivery never cause automatic retransmission', async () => {
  let finish;
  let calls = 0;
  const delivery = new CommandDelivery(async () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  }, original);
  const first = delivery.send();
  await delivery.send();
  assert.equal(calls, 1);
  finish({ status: 'unknown' });
  await first;
  await delivery.send();
  assert.equal(calls, 1);
  assert.equal(delivery.shouldPoll(), false);
  assert.equal(commandPresentation(delivery.record).retry, false);
});

test('commands require connection, a current session, enabled host control and an open office', () => {
  const state = { office: { paused: false }, localSessions: { status: 'connected', sessions: [{ id: 'session' }], control: { enabled: true } } };
  assert.equal(commandUnavailableReason(state, 'session'), '');
  assert.ok(commandUnavailableReason(state, 'missing'));
  assert.ok(commandUnavailableReason(state, 'session', false));
  state.office.paused = true;
  assert.ok(commandUnavailableReason(state, 'session'));
  state.office.paused = false;
  state.localSessions.control.enabled = false;
  assert.ok(commandUnavailableReason(state, 'session'));
  state.localSessions.control.enabled = true;
  state.localSessions.status = 'disconnected';
  assert.ok(commandUnavailableReason(state, 'session'));
});

test('reload recovery persists only receipt identifiers and never the original instruction', () => {
  let stored;
  const storage = { setItem: (key, value) => { stored = value; }, getItem: () => stored };
  const record = { ...original, id: '12345678-1234-1234-1234-123456789012', sessionId: '87654321-4321-4321-4321-210987654321' };
  saveCommandReceipts(storage, new Map([['session', { record }]]));
  assert.deepEqual(JSON.parse(stored), [{ id: record.id, sessionId: record.sessionId }]);
  assert.equal(stored.includes(original.content), false);
  assert.deepEqual(loadCommandReceipts(storage), [{ id: record.id, sessionId: record.sessionId, status: 'unconfirmed', restored: true }]);
  assert.equal(commandPresentation(loadCommandReceipts(storage)[0]).retry, false);
  assert.deepEqual(loadCommandReceipts({ getItem: () => 'not json' }), []);
  assert.deepEqual(loadCommandReceipts({ getItem: () => '[{"id":"bad"}]' }), []);
  assert.equal(commandPresentation({ status: 'constructor' }).title, '접수 여부 확인 필요');
});
