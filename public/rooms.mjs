// World coordinates: x = across a floor, y = elevation, z = toward the corridor.
export const FLOOR_HEIGHT = 5.2;
export const CORRIDOR_Z = 5.25;
export const LIFT_X = -11.85;
export const BUILDING = Object.freeze({ left: -13.2, right: 13.2, back: -9.6, front: 7, roomsLeft: -10.5, split: 3.65, wallHeight: 3.4 });
export const DESK_X = Object.freeze([-8.5, -4.5, -.5]);
export const DESK_Z = Object.freeze([-7.3, -3.3, .7]);
export const DESKS = Object.freeze(DESK_Z.flatMap((z) => DESK_X.map((x) => Object.freeze({ x, z, width: 2.7, depth: 1.25 }))));
export const MEETING_CENTER = Object.freeze({ x: 8.4, z: -3 });
export const FLOORS = Object.freeze([
  { id: 3, title: '대표이사실', description: '질문 · 발표 · 업무보고' },
  { id: 2, title: '워크스페이스', description: '사무실 · 유리 회의실' },
  { id: 1, title: '라운지', description: '창고 · 휴게실 · 다과실' },
]);
export const ROOMS = Object.freeze([
  { id: 'office', name: '사무실', number: '201', floor: 2, subtitle: '업무 · CLI 세션', description: '동료의 책상에서 업무를 맡기고, CLI 대화를 이어서 확인하세요.', x: 1.85, z: 2.9, doorZ: 3.6, left: -10.5, right: 3.55 },
  { id: 'meeting', name: '회의실', number: '202', floor: 2, subtitle: '세션 협업 · 논의', description: '협업한 동료와 세션을 확인하고 관련 대화를 살펴보세요.', x: 8.5, z: 2.9, doorZ: 3.6, left: 3.75, right: 13.05 },
  { id: 'executive', name: '대표이사실', number: '301', floor: 3, subtitle: '질문 · 발표 · 승인', description: 'Commander에게 하는 질문과 발표를 확인하고, 업무 결과를 검토하세요.', x: 1.85, z: 2.9, doorZ: 3.6, left: -10.5, right: 13.05 },
  { id: 'lounge', name: '휴게실', number: '101', floor: 1, subtitle: '휴식 · 대기', description: '업무를 기다리는 동료가 모이는 공간입니다. 입장과 퇴실은 실제 실행을 바꾸지 않습니다.', x: .8, z: 2.9, doorZ: 3.6, left: -3.35, right: 3.55 },
  { id: 'warehouse', name: '창고', number: '103', floor: 1, subtitle: '업무 보관 · 다시 연결', description: '보관한 업무와 연결 확인이 필요한 동료를 관리하세요. 복귀는 실제 세션 재개나 지시 재전송이 아닙니다.', x: -6.8, z: 2.9, doorZ: 3.6, left: -10.5, right: -3.55 },
  { id: 'pantry', name: '다과실', number: '102', floor: 1, subtitle: '커피 · 사무실 소식', description: '잠시 쉬어 가며 사무실의 최근 소식을 확인하세요.', x: 8.5, z: 2.9, doorZ: 3.6, left: 3.75, right: 13.05 },
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
  if (occupant.workArchive?.stored || ['disconnected', 'interrupted'].includes(occupant.status) || ['missing', 'ended', 'not_connected'].includes(occupant.connection?.status)) return 'warehouse';
  if (['meeting', 'executive'].includes(occupant.sceneActivity?.room)) return occupant.sceneActivity.room;
  if (occupant.source === 'session') return 'office';
  if (['waiting_input', 'waiting_approval'].includes(occupant.status)) return 'executive';
  if (occupant.status === 'idle') return 'lounge';
  return 'office';
}
export function occupantPosition(roomId, index, pose) {
  const room = roomById(roomId);
  const seat = index % 4;
  if (roomId === 'office') {
    const desk = DESKS[[0, 3, 6, 1, 4, 7, 2, 5, 8][index % DESKS.length]];
    return worldPoint(room, desk.x + (index < DESKS.length ? -.3 : .75), desk.z + 1.6);
  }
  if (roomId === 'meeting') return worldPoint(room, seat % 2 ? 11.45 : 5.35, -4.25 + Math.floor(seat / 2) * 3);
  if (roomId === 'executive' && pose === 'presenting') return worldPoint(room, seat % 2 ? 10.5 : 6.1, -3.5 + Math.floor(seat / 2) * 2);
  return worldPoint(room, room.x + (index % 2 ? 1.1 : -1.1), room.z);
}

// Each desk row opens into the right-hand aisle, then the room's doorway.
export function pathToDoor(roomId, position) {
  const room = roomById(roomId);
  const points = [{ ...position }];
  if (position.z >= room.doorZ) points.push(worldPoint(room, position.x, CORRIDOR_Z), worldPoint(room, room.x, CORRIDOR_Z));
  else if (roomId === 'office') {
    const aisle = DESK_Z.map((z) => z + 2.1).find((z) => z >= position.z - .01) ?? room.z;
    points.push(worldPoint(room, position.x, aisle), worldPoint(room, room.x, aisle));
  } else points.push(worldPoint(room, position.x, room.z));
  points.push(worldPoint(room));
  return points.filter((point, index) => !index || ['x', 'y', 'z'].some((axis) => point[axis] !== points[index - 1][axis]));
}
