export const STATUS_LABELS = Object.freeze({
  idle: '업무 대기',
  working: '진행 중',
  running: '진행 중',
  queued: '접수 대기',
  waiting_input: '답변 대기',
  waiting_approval: '승인 대기',
  completed: '완료',
  cancelled: '취소됨',
  failed: '실패',
  paused: '일시 중지',
  unavailable: '미연결',
  disconnected: '연결 끊김',
  interrupted: '중단 관찰',
  unknown: '확인 필요',
});

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed']);
const ATTENTION_STATUSES = new Set(['waiting_input', 'waiting_approval']);

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function statusLabel(status) {
  return Object.hasOwn(STATUS_LABELS, status) ? STATUS_LABELS[status] : '상태 확인 필요';
}

export function statusClass(status) {
  return Object.hasOwn(STATUS_LABELS, status) ? status : 'unknown';
}

export function isOpenTask(task) {
  return !TERMINAL_STATUSES.has(task.status);
}

export function needsAttention(task) {
  return ATTENTION_STATUSES.has(task.status);
}

export function officeCounts(state) {
  return {
    agents: state.agents.length,
    working: state.tasks.filter((task) => ['working', 'running', 'queued', 'waiting_input', 'waiting_approval'].includes(task.status)).length,
    waiting: state.tasks.filter(needsAttention).length,
    completed: state.tasks.filter((task) => task.status === 'completed').length,
    unfinished: state.tasks.filter(isOpenTask).length,
  };
}

export function taskUnavailableReason(state, agent) {
  if (!agent) return '먼저 체험용 직원을 채용하세요.';
  if (state.office.paused) return '사무실 업무를 재개한 뒤 지시할 수 있습니다.';
  const provider = state.providers.find((item) => item.id === agent.provider);
  if (!provider?.available || !provider.capabilities?.createSession) {
    return provider?.reason || '이 공급자의 업무 실행은 아직 지원하지 않습니다.';
  }
  if (state.tasks.some((task) => task.agentId === agent.id && isOpenTask(task))) {
    return '이 직원의 진행 중인 업무를 완료하거나 취소한 뒤 새 업무를 지시하세요.';
  }
  return '';
}

export function filterTasks(tasks, filter) {
  return tasks.filter((task) => {
    if (filter === 'attention') return needsAttention(task);
    if (filter === 'active') return isOpenTask(task);
    if (filter === 'completed' || filter === 'cancelled') return task.status === filter;
    return true;
  }).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

export function displayTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '시간 정보 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function normalizeState(value) {
  if (!value || !value.office || typeof value.office.paused !== 'boolean'
    || !['providers', 'agents', 'tasks', 'events', 'programs'].every((key) => Array.isArray(value[key]))) {
    throw new Error('서버 상태를 읽을 수 없습니다. 잠시 후 다시 연결해 주세요.');
  }
  return value;
}

const PROGRAM_URLS = Object.freeze({
  wShell: 'https://github.com/parkhw328/wook-shell',
  wPost: 'https://github.com/parkhw328/wook-post',
  wText: 'https://github.com/parkhw328/wook-text',
  'StackQueue Blog': 'https://blog.naver.com/stack-queue',
});

export function programUrl(program) {
  return program?.url === PROGRAM_URLS[program?.name] ? program.url : null;
}

export function officeName(office) {
  return typeof office?.name === 'string' && office.name.trim() ? office.name.trim() : 'StackQueue Office';
}

export function orderedLocalSessions(localSessions) {
  return [...(localSessions?.sessions || [])].sort((a, b) => a.id.localeCompare(b.id));
}

export function observedSessionStatus(localSessions, session, connection = true) {
  if (!connection || localSessions?.status !== 'connected') return 'disconnected';
  return ['working', 'idle', 'interrupted', 'unknown', 'disconnected'].includes(session.status) ? session.status : 'unknown';
}

export function sessionStatusLabel(status) {
  const labels = { working: '활동 관찰', idle: '턴 종료 관찰', interrupted: '중단 관찰', unknown: '확인 필요', disconnected: '관찰 연결 끊김' };
  return Object.hasOwn(labels, status) ? labels[status] : '확인 필요';
}

export function characterMotion(status, connected = true) {
  if (!connected) return 'still';
  if (status === 'working' || status === 'running') return 'typing';
  if (status === 'waiting_input' || status === 'waiting_approval') return 'attention';
  if (status === 'idle') return 'idle';
  return 'still';
}
