// Coordinates share the 1000 × 620 architectural plan in floor-plan.svg.
export const ROOMS = Object.freeze([
  { id: 'office', name: '사무실', number: '01', subtitle: '업무 · CLI 세션', description: '동료의 책상에서 업무를 맡기고, CLI 대화를 이어서 확인하세요.', x: 355, y: 480, doorY: 370 },
  { id: 'meeting', name: '회의실', number: '02', subtitle: '질문 · 논의', description: '답변을 기다리는 업무를 열고 동료의 질문에 답하세요.', x: 465, y: 205, doorY: 280 },
  { id: 'executive', name: '대표이사실', number: '03', subtitle: '업무보고 · 승인', description: '진행 상황과 결과를 보고받고, 검토한 결과를 승인하세요.', x: 815, y: 205, doorY: 280 },
  { id: 'lounge', name: '휴게실', number: '04', subtitle: '휴식 · 대기', description: '업무를 기다리는 동료가 모이는 공간입니다. 입장과 퇴실은 실제 실행을 바꾸지 않습니다.', x: 155, y: 205, doorY: 280 },
  { id: 'pantry', name: '다과실', number: '05', subtitle: '커피 · 사무실 소식', description: '잠시 쉬어 가며 사무실의 최근 소식을 확인하세요.', x: 815, y: 480, doorY: 370 },
]);

export const HALL = Object.freeze({ id: 'corridor', name: '복도', x: 65, y: 325, subtitle: '방을 선택해 입장하세요', description: '문을 열고 동료를 만나 보세요. 사무실에서 일을 시작하고, 회의실과 대표이사실에서 대화와 보고를 이어 갑니다.' });
export function roomById(id) { return ROOMS.find((room) => room.id === id) || HALL; }

export function routeBetween(fromId, toId) {
  const from = roomById(fromId);
  const to = roomById(toId);
  if (from.id === to.id) return [];
  const points = [{ x: from.x, y: from.y }];
  if (from.id !== HALL.id) points.push({ x: from.x, y: from.doorY }, { x: from.x, y: HALL.y });
  points.push({ x: to.x, y: HALL.y });
  if (to.id !== HALL.id) points.push({ x: to.x, y: to.doorY }, { x: to.x, y: to.y });
  return points.filter((point, i) => !i || point.x !== points[i - 1].x || point.y !== points[i - 1].y);
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
