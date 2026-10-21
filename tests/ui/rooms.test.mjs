import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS, HALL, routeBetween, roomTasks, taskRoom } from '../../public/rooms.mjs';
import { ConversationReader, conversationMarkup, filterMessages } from '../../public/conversation.mjs';

test('every room-to-room route leaves through its door, follows the corridor, and enters through the destination door', () => {
  for (const from of [HALL, ...ROOMS]) for (const to of [HALL, ...ROOMS]) {
    const route = routeBetween(from.id, to.id);
    if (from.id === to.id) { assert.deepEqual(route, []); continue; }
    assert.deepEqual(route[0], { x: from.x, y: from.y });
    assert.deepEqual(route.at(-1), { x: to.x, y: to.y });
    if (from.id !== HALL.id) assert.deepEqual(route[1], { x: from.x, y: from.doorY });
    if (to.id !== HALL.id) assert.deepEqual(route.at(-2), { x: to.x, y: to.doorY });
    for (let i = 1; i < route.length; i += 1) {
      const [a, b] = [route[i - 1], route[i]];
      assert.ok(a.x === b.x || a.y === b.y, 'no diagonal wall crossings');
      if (a.x !== b.x) assert.equal(a.y, HALL.y, 'horizontal travel stays in the corridor');
    }
  }
});

test('room reports prioritize approval, preserve failures, and do not mutate task execution', () => {
  const tasks = ['failed', 'completed', 'waiting_input', 'waiting_approval', 'paused', 'working'].map((status) => ({ id: status, status, updatedAt: '2026-10-21' }));
  const before = structuredClone(tasks);
  assert.equal(roomTasks('executive', tasks)[0].status, 'waiting_approval');
  assert.deepEqual(roomTasks('meeting', tasks).map((item) => item.id), ['waiting_input']);
  assert.equal(taskRoom(tasks[0]), 'executive');
  assert.equal(taskRoom(tasks[2]), 'meeting');
  assert.ok(roomTasks('executive', tasks).some((item) => item.status === 'failed'));
  assert.deepEqual(tasks, before);
});

test('terminal text remains inert and search combines roles and literal text', () => {
  const messages = [{ role: 'user', content: '<img src=x onerror=alert(1)>\n보고 A' }, { role: 'assistant', content: '보고 B' }];
  const html = conversationMarkup(messages);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.equal(filterMessages(messages, '보고', 'assistant').length, 1);
  assert.equal(filterMessages(messages, 'not found').length, 0);
});

test('late conversation responses never overwrite a newly selected session', async () => {
  const requests = [];
  const reader = new ConversationReader((url) => new Promise((resolve) => requests.push({ url, resolve })), () => {});
  reader.select('first');
  reader.select('second');
  requests[1].resolve({ status: 'ready', messages: [{ content: 'second' }] });
  await new Promise((resolve) => setImmediate(resolve));
  requests[0].resolve({ status: 'ready', messages: [{ content: 'first' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reader.data.messages[0].content, 'second');
  reader.select(null);
  assert.equal(reader.data, null);
});

test('connection errors retain the last received messages without replaying commands', async () => {
  let fail = false;
  const reader = new ConversationReader(async () => { if (fail) throw new Error('offline'); return { status: 'ready', messages: [{ content: 'received' }] }; }, () => {});
  reader.select('first');
  await new Promise((resolve) => setImmediate(resolve));
  fail = true;
  await reader.refresh();
  assert.equal(reader.data.status, 'disconnected');
  assert.equal(reader.data.messages[0].content, 'received');
});
