import test from 'node:test';
import assert from 'node:assert/strict';
import { configureProjectFloors, ROOMS, FLOORS, occupantRoom, roomTasks, routeBetween, FLOOR_HEIGHT } from '../../public/rooms.mjs';

test('project rooms and paths isolate staff and tasks on stable dedicated floors', () => {
  try {
    configureProjectFloors([{ id: 'a', name: 'Same name', source: 'folder', floor: 2 }, { id: 'b', name: 'Same name', source: 'folder', floor: 3 }]);
    assert.equal(FLOORS.length, 4);
    assert.equal(ROOMS.find((r) => r.id === 'executive').floor, 4);
    const a = { id: 'a-staff', observedProjectId: 'a', assignedProjectId: 'b', sessionLifecycle: 'live' };
    const b = { id: 'b-staff', assignedProjectId: 'b', status: 'working' };
    assert.equal(occupantRoom(a), 'office'); assert.equal(occupantRoom(b), 'office-b');
    assert.equal(occupantRoom({ status: 'working' }), 'warehouse');
    assert.equal(occupantRoom({ ...a, sceneActivity: { room: 'meeting' } }), 'meeting');
    assert.equal(occupantRoom({ ...b, sceneActivity: { room: 'meeting' } }), 'meeting-b');
    const tasks = [{ id: 'one', agentId: 'a-staff', status: 'working' }, { id: 'two', projectId: 'b', status: 'working' }];
    assert.deepEqual(roomTasks('office', tasks, [a, b]).map((t) => t.id), ['one']);
    assert.deepEqual(roomTasks('office-b', tasks, [a, b]).map((t) => t.id), ['two']);
    const route = routeBetween('office', 'office-b');
    assert.equal(route.at(-1).y, 2 * FLOOR_HEIGHT);
    assert.ok(route.some((point, index) => index && route[index - 1].y !== point.y && point.x === -11.85 && point.z === 5.25));
  } finally { configureProjectFloors(); }
});
