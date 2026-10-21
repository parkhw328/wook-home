// World coordinates: x = across a floor, y = elevation, z = toward the corridor.
export const FLOOR_HEIGHT = 3.6;
export const CORRIDOR_Z = 2.8;
export const LIFT_X = -15.1;
export const BUILDING = Object.freeze({ left: -16.2, right: 16, back: -7.5, front: 4.05, roomsLeft: -14, split: 1 });
export const DESK_X = Object.freeze([-12.3, -9.5, -6.7, -3.9, -1.1, 3.7, 6.5, 9.3, 12.1]);
export const FLOORS = Object.freeze([
  { id: 3, title: '리더십', description: '회의실 · 대표이사실' },
  { id: 2, title: '워크스페이스', description: '사무실 · 동료의 데스크' },
  { id: 1, title: '라운지', description: '휴게실 · 다과실 · 로비' },
]);
export const ROOMS = Object.freeze([
  { id: 'office', name: '사무실', number: '201', floor: 2, subtitle: '업무 · CLI 세션', description: '동료의 책상에서 업무를 맡기고, CLI 대화를 이어서 확인하세요.', x: 1.8, z: .9, doorZ: 1.55, left: -14, right: 15.8 },
  { id: 'meeting', name: '회의실', number: '301', floor: 3, subtitle: '세션 협업 · 논의', description: '협업한 동료와 세션을 확인하고 관련 대화를 살펴보세요.', x: -6.5, z: .9, doorZ: 1.55, left: -14, right: .9 },
  { id: 'executive', name: '대표이사실', number: '302', floor: 3, subtitle: '질문 · 발표 · 승인', description: 'Commander에게 하는 질문과 발표를 확인하고, 업무 결과를 검토하세요.', x: 8.5, z: .9, doorZ: 1.55, left: 1.1, right: 15.8 },
  { id: 'lounge', name: '휴게실', number: '101', floor: 1, subtitle: '휴식 · 대기', description: '업무를 기다리는 동료가 모이는 공간입니다. 입장과 퇴실은 실제 실행을 바꾸지 않습니다.', x: -6.5, z: .9, doorZ: 1.55, left: -14, right: .9 },
  { id: 'pantry', name: '다과실', number: '102', floor: 1, subtitle: '커피 · 사무실 소식', description: '잠시 쉬어 가며 사무실의 최근 소식을 확인하세요.', x: 8.5, z: .9, doorZ: 1.55, left: 1.1, right: 15.8 },
]);
export function hallForFloor(floor = 1) {
  const level = [1, 2, 3].includes(Number(floor)) ? Number(floor) : 1;
  return { id: `corridor-${level}`, floor: level, name: `${level}층 복도`, x: LIFT_X, z: CORRIDOR_Z, subtitle: '방을 선택해 입장하세요', description: '층별로 동료의 공간을 둘러보세요. 다른 층은 엘리베이터를 타고, 복도에서 문을 통해 입장합니다.' };
}
export const HALL = Object.freeze({ ...hallForFloor(1), id: 'corridor' });
export const isHall = (id) => String(id).startsWith('corridor');
export function roomById(id) { return ROOMS.find((room) => room.id === id) || (isHall(id) ? hallForFloor(Number(id.split('-')[1]) || 1) : HALL); }
export const worldPoint = (room, x = room.x, z = room.z) => ({ x, y: (room.floor - 1) * FLOOR_HEIGHT, z });

export function routeBetween(fromId, toId) {
  const from = roomById(fromId);
  const to = roomById(toId);
  if (from.id === to.id) return [];
  const points = [worldPoint(from)];
  if (!isHall(from.id)) points.push(worldPoint(from, from.x, from.doorZ), worldPoint(from, from.x, CORRIDOR_Z));
  if (from.floor !== to.floor) points.push(worldPoint(from, LIFT_X, CORRIDOR_Z), worldPoint(to, LIFT_X, CORRIDOR_Z));
  points.push(worldPoint(to, to.x, CORRIDOR_Z));
  if (!isHall(to.id)) points.push(worldPoint(to, to.x, to.doorZ), worldPoint(to));
  return points.filter((point, index) => !index || ['x', 'y', 'z'].some((axis) => point[axis] !== points[index - 1][axis]));
}

export function taskRoom(task) {
  return ['waiting_input', 'waiting_approval', 'completed', 'failed', 'cancelled', 'paused'].includes(task?.status) ? 'executive' : 'office';
}
export function roomTasks(roomId, tasks) {
  if (roomId === 'meeting') return [];
  if (roomId === 'executive') return [...tasks].sort((a, b) => Number(b.status === 'waiting_approval') - Number(a.status === 'waiting_approval') || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (roomId === 'office') return tasks.filter((task) => !['completed', 'cancelled', 'failed'].includes(task.status));
  return [];
}
export function occupantRoom(occupant) {
  if (['meeting', 'executive'].includes(occupant.sceneActivity?.room)) return occupant.sceneActivity.room;
  if (occupant.source === 'session') return 'office';
  if (['waiting_input', 'waiting_approval'].includes(occupant.status)) return 'executive';
  if (occupant.status === 'idle') return 'lounge';
  return 'office';
}
export function occupantPosition(roomId, index, pose) {
  const room = roomById(roomId);
  const activitySeat = index % 4;
  if (roomId === 'office') return worldPoint(room, DESK_X[[0, 2, 4, 6, 8, 1, 3, 5, 7][index % DESK_X.length]] - .3, index < DESK_X.length ? .7 : -3.9);
  if (roomId === 'meeting' && pose === 'discussing') return worldPoint(room, -6.5 + (activitySeat % 2 ? 2.2 : -2.2), -2.9 + Math.floor(activitySeat / 2) * 1.2);
  if (roomId === 'executive' && pose === 'presenting') return worldPoint(room, 12.1 + (activitySeat % 2) * 1.45, -3.6 + Math.floor(activitySeat / 2) * 1.45);
  return worldPoint(room, room.x + (index % 2 ? 1.1 : -1.1), .9);
}

// Walk from a desk through the open row aisle, then the central door aisle.
export function pathToDoor(roomId, position) {
  const room = roomById(roomId);
  const points = [{ ...position }];
  if (position.z >= room.doorZ) points.push(worldPoint(room, position.x, CORRIDOR_Z), worldPoint(room, room.x, CORRIDOR_Z));
  else if (roomId === 'office' && position.z < -1) points.push(worldPoint(room, position.x, -3.25), worldPoint(room, room.x, -3.25));
  else points.push(worldPoint(room, position.x, room.z));
  points.push(worldPoint(room));
  return points.filter((point, index) => !index || ['x', 'y', 'z'].some((axis) => point[axis] !== points[index - 1][axis]));
}
