// World coordinates: x = across a floor, y = elevation, z = toward the corridor.
export const FLOOR_HEIGHT = 4.4;
export const CORRIDOR_Z = 2.35;
export const LIFT_X = -5.9;
export const FLOORS = Object.freeze([
  { id: 3, title: '리더십', description: '회의실 · 대표이사실' },
  { id: 2, title: '워크스페이스', description: '사무실 · 동료의 데스크' },
  { id: 1, title: '라운지', description: '휴게실 · 다과실 · 로비' },
]);
export const ROOMS = Object.freeze([
  { id: 'office', name: '사무실', number: '201', floor: 2, subtitle: '업무 · CLI 세션', description: '동료의 책상에서 업무를 맡기고, CLI 대화를 이어서 확인하세요.', x: 1.1, z: .8, doorZ: 1.25, left: -4.8, right: 6.6 },
  { id: 'meeting', name: '회의실', number: '301', floor: 3, subtitle: '질문 · 논의', description: '답변을 기다리는 업무를 열고 동료의 질문에 답하세요.', x: -2.35, z: .7, doorZ: 1.25, left: -4.8, right: .15 },
  { id: 'executive', name: '대표이사실', number: '302', floor: 3, subtitle: '업무보고 · 승인', description: '진행 상황과 결과를 보고받고, 검토한 결과를 승인하세요.', x: 3.4, z: .95, doorZ: 1.25, left: .35, right: 6.6 },
  { id: 'lounge', name: '휴게실', number: '101', floor: 1, subtitle: '휴식 · 대기', description: '업무를 기다리는 동료가 모이는 공간입니다. 입장과 퇴실은 실제 실행을 바꾸지 않습니다.', x: -2.35, z: .7, doorZ: 1.25, left: -4.8, right: .15 },
  { id: 'pantry', name: '다과실', number: '102', floor: 1, subtitle: '커피 · 사무실 소식', description: '잠시 쉬어 가며 사무실의 최근 소식을 확인하세요.', x: 3.4, z: .7, doorZ: 1.25, left: .35, right: 6.6 },
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
  return task?.status === 'waiting_input' ? 'meeting'
    : ['waiting_approval', 'completed', 'failed', 'cancelled', 'paused'].includes(task?.status) ? 'executive' : 'office';
}
export function roomTasks(roomId, tasks) {
  if (roomId === 'meeting') return tasks.filter((task) => task.status === 'waiting_input');
  if (roomId === 'executive') return [...tasks].sort((a, b) => Number(b.status === 'waiting_approval') - Number(a.status === 'waiting_approval') || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (roomId === 'office') return tasks.filter((task) => !['completed', 'cancelled', 'failed'].includes(task.status));
  return [];
}
export function occupantRoom(occupant) {
  if (occupant.source === 'session') return 'office';
  if (occupant.status === 'waiting_input') return 'meeting';
  if (occupant.status === 'waiting_approval') return 'executive';
  if (occupant.status === 'idle') return 'lounge';
  return 'office';
}
export function occupantPosition(roomId, index) {
  const room = roomById(roomId);
  if (roomId === 'office') return worldPoint(room, [-3.35, -.65, 2.05, 4.75][index % 4], index < 4 ? .75 : -1.05);
  return worldPoint(room, room.x + (index % 2 ? .8 : -.8), .7);
}
