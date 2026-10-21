import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS, HALL, routeBetween, roomTasks, taskRoom, worldPoint, isHall, roomById, hallForFloor, CORRIDOR_Z, LIFT_X, DESKS, occupantPosition, pathToDoor } from '../../public/rooms.mjs';
import { ConversationReader, conversationMarkup, filterMessages } from '../../public/conversation.mjs';

test('every floor and room route uses doors, corridors and the open lift shaft without crossing walls or slabs', () => {
  const spaces = [HALL, hallForFloor(2), hallForFloor(3), ...ROOMS];
  for (const from of spaces) for (const to of spaces) {
    const route = routeBetween(from.id, to.id);
    if (from.id === to.id) { assert.deepEqual(route, []); continue; }
    assert.deepEqual(route[0], worldPoint(from));
    assert.deepEqual(route.at(-1), worldPoint(to));
    if (!isHall(from.id)) assert.deepEqual(route[1], worldPoint(from, from.x, from.doorZ));
    if (!isHall(to.id)) assert.deepEqual(route.at(-2), worldPoint(to, to.x, to.doorZ));
    for (let i = 1; i < route.length; i += 1) {
      const [a, b] = [route[i - 1], route[i]];
      assert.equal(['x', 'y', 'z'].filter((axis) => a[axis] !== b[axis]).length, 1, 'only one world axis changes at a time');
      if (a.x !== b.x) assert.equal(a.z, CORRIDOR_Z, 'cross-room travel stays in the corridor');
      if (a.y !== b.y) { assert.equal(a.x, LIFT_X); assert.equal(a.z, CORRIDOR_Z); }
    }
  }
});

test('leaving a room stays on the same floor and each mandatory space is assigned to a real floor', () => {
  assert.deepEqual(new Set(ROOMS.map((room) => room.floor)), new Set([1, 2, 3]));
  for (const room of ROOMS) {
    const hall = hallForFloor(room.floor);
    assert.equal(roomById(hall.id).floor, room.floor);
    assert.ok(routeBetween(room.id, hall.id).every((point) => point.y === worldPoint(room).y));
  }
});

test('all nine desk stations reach the door through clear aisles without crossing furniture', () => {
  for (let seat = 0; seat < 16; seat += 1) {
    const home = occupantPosition('office', seat);
    const route = pathToDoor('office', home);
    assert.deepEqual(route[0], home);
    assert.deepEqual(route.at(-1), worldPoint(roomById('office')));
    for (let i = 1; i < route.length; i += 1) {
      const [a, b] = [route[i - 1], route[i]];
      assert.equal(['x', 'y', 'z'].filter((axis) => a[axis] !== b[axis]).length, 1);
      for (const { x, z, width, depth } of DESKS) {
        const crosses = Math.max(a.x, b.x) > x - width / 2 && Math.min(a.x, b.x) < x + width / 2
          && Math.max(a.z, b.z) > z - depth / 2 && Math.min(a.z, b.z) < z + depth / 2;
        assert.equal(crosses, false, `seat ${seat} crosses desk ${x}, ${z}`);
      }
    }
  }
});

test('room reports prioritize approval, preserve failures, and do not mutate task execution', () => {
  const tasks = ['failed', 'completed', 'waiting_input', 'waiting_approval', 'paused', 'working'].map((status) => ({ id: status, status, updatedAt: '2026-10-21' }));
  const before = structuredClone(tasks);
  assert.equal(roomTasks('executive', tasks)[0].status, 'waiting_approval');
  assert.deepEqual(roomTasks('meeting', tasks), []);
  assert.equal(taskRoom(tasks[0]), 'executive');
  assert.equal(taskRoom(tasks[2]), 'executive');
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

test('collaboration and presentation seats reach their door without crossing the table or the executive partition', () => {
  for (const [id, pose] of [['meeting', 'discussing'], ['executive', 'presenting']]) for (let seat = 0; seat < 4; seat++) {
    const home = occupantPosition(id, seat, pose);
    const route = pathToDoor(id, home);
    assert.deepEqual(route.at(-1), worldPoint(roomById(id)));
    for (let i = 1; i < route.length; i++) {
      const [a, b] = [route[i - 1], route[i]];
      if (id === 'meeting') assert.equal(Math.max(a.x, b.x) > 6.5 && Math.min(a.x, b.x) < 10.3 && Math.max(a.z, b.z) > -3.85 && Math.min(a.z, b.z) < -2.15, false);
      else if (Math.min(a.x, b.x) < 2.95 && Math.max(a.x, b.x) > 2.95) assert.ok(a.z > -2 && b.z > -2, 'presentation route goes around the glass partition');
    }
  }
});
