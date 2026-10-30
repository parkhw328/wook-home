import { occupantRoom, projectForAgent } from './rooms.mjs';
import { orderedLocalSessions, observedSessionStatus, escapeHtml as esc } from './model.mjs';
import { staffIdentity } from './session-identity.mjs';

export function activeOfficeProjects(state, connected = true) {
  if (!connected) return [];
  const active = new Set();
  for (const agent of state.agents) {
    if (agent.workArchive?.stored) continue;
    const connection = agent.connection;
    let present = false;
    if (connection?.status === 'connected') {
      if (connection.source === 'cli' && connection.kind === 'session') {
        present = state.localSessions?.status === 'connected'
          && state.localSessions.sessions.some((session) => session.id === connection.sessionId && session.lifecycle === 'live');
      } else {
        present = (connection.source === 'cli' && connection.kind === 'process')
          || (connection.source === 'web' && connection.kind === 'conversation');
      }
    } else if (!connection && agent.provider === 'demo' && !state.office.paused) {
      present = state.tasks.some((task) => task.agentId === agent.id && ['working', 'waiting_input', 'waiting_approval'].includes(task.status));
    }
    if (present) active.add(projectForAgent(agent));
  }
  // The full catalog remains available for assignments and offline history.
  return (state.projects || []).filter((project) => active.has(project.id));
}

export function sceneActivity(activity, connected = true, now = Date.now()) {
  if (!connected || !activity || !['collaborating', 'question', 'approval'].includes(activity.kind)) return null;
  const since = Date.parse(activity.since);
  const expiry = Date.parse(activity.expiresAt);
  const collaboration = activity.kind === 'collaborating';
  if (!Number.isFinite(since) || !Number.isFinite(expiry) || since > now + 5000 || expiry <= now
    || expiry <= since || expiry - since > (collaboration ? 60000 : 30 * 60000)
    || activity.phase !== (collaboration ? 'recent' : 'active')) return null;
  return {
    kind: activity.kind, phase: activity.phase, since: activity.since,
    room: collaboration ? 'meeting' : 'executive', pose: collaboration ? 'discussing' : 'presenting',
    label: collaboration ? '최근 협업 · 회의실' : activity.kind === 'question' ? '질문 대기 · 대표이사실' : '승인 요청 · 대표이사실',
    peerSessionIds: Array.isArray(activity.peerSessionIds) ? activity.peerSessionIds : [],
  };
}

export function officeOccupants(state, connected = true, now = Date.now()) {
  const sessions = orderedLocalSessions(state.localSessions);
  const live = connected && state.localSessions?.status === 'connected';
  const observe = (session) => session?.lifecycle !== 'live' || ['interrupted', 'disconnected'].includes(session?.status) ? null : sceneActivity(session?.activity, live, now);
  const actors = [];
  for (const agent of state.agents) {
    const linked = agent.connection?.status === 'connected' && sessions.find((session) => session.id === agent.connection?.sessionId);
    let activity = linked ? observe(linked) : null;
    if (!agent.connection && agent.provider === 'demo' && connected && !state.office.paused) {
      const task = state.tasks.find((item) => item.agentId === agent.id && ['waiting_input', 'waiting_approval'].includes(item.status));
      if (task) activity = { kind: task.status === 'waiting_input' ? 'question' : 'approval', room: 'executive', pose: 'presenting',
        label: task.status === 'waiting_input' ? '질문 대기 · 대표이사실' : '결과 발표 · 대표이사실', phase: 'active', taskId: task.id, peerSessionIds: [] };
    }
    if (agent.workArchive?.stored) activity = null;
    const sessionStatus = agent.connection?.sessionId
      ? observedSessionStatus(state.localSessions, linked || { status: 'unknown' }, connected) : undefined;
    actors.push({ ...agent, source: 'agent', sessionStatus, sessionLifecycle: live ? linked?.lifecycle : 'unknown', status: connected ? agent.status : 'disconnected', sceneActivity: activity });
  }
  return actors;
}

export function sessionRoom(state, id, connected = true, now = Date.now()) {
  const actor = officeOccupants(state, connected, now).find((item) => item.source === 'session' ? item.id === id : item.connection?.sessionId === id);
  return actor ? occupantRoom(actor) : 'warehouse';
}

export function activityRoomMarkup(room, actors, selectedId) {
  const participants = actors.filter((actor) => actor.sceneActivity?.room === room && !actor.sceneActivity.taskId);
  if (!participants.length) return '';
  const label = room === 'meeting' ? '최근 협업한 세션' : '질문·승인 요청';
  return `<div class="room-section-label">${label} <span>${participants.length}</span></div>`
    + participants.map((actor) => {
      const id = actor.source === 'session' ? actor.id : actor.connection?.sessionId;
      return `<button class="room-entry activity-entry" type="button" data-workspace-session="${esc(id)}" aria-pressed="${selectedId === id}"><span class="entry-symbol" aria-hidden="true">${room === 'meeting' ? '↔' : '↗'}</span><span><strong>${esc(actor.name)}</strong>${staffIdentity(actor, true)}<small>${esc(actor.sceneActivity.label)}</small></span></button>`;
    }).join('')
    + `<p class="activity-note">${room === 'meeting' ? '확인된 메시지 전달을 최대 60초 표시합니다. 세션을 선택해 공개 대화를 확인하세요.' : '대화를 확인하고 원래 Codex 창에서 질문에 답하거나 실행을 승인하세요.'}</p>`;
}

export function activitySummaryMarkup(actors) {
  const meetings = new Map();
  for (const actor of actors.filter((item) => item.sceneActivity?.room === 'meeting')) {
    const room = occupantRoom(actor);
    if (room !== 'warehouse') meetings.set(room, (meetings.get(room) || 0) + 1);
  }
  const presentations = actors.filter((actor) => actor.sceneActivity?.room === 'executive').length;
  if (!meetings.size && !presentations) return '';
  return '<span>협업과 발표</span>'
    + [...meetings].map(([room, count]) => `<button type="button" class="button button-small" data-room="${esc(room)}">최근 협업 · ${count}명</button>`).join('')
    + (presentations ? `<button type="button" class="button button-small" data-room="executive">질문·발표 · ${presentations}명</button>` : '')
    + '<a class="inline-link" href="https://github.com/parkhw328/wook-home/wiki/Activity" target="_blank" rel="noopener noreferrer">동작 안내 ↗</a>';
}
