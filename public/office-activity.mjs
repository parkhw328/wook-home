import { orderedLocalSessions, unassignedLocalSessions, observedSessionStatus, escapeHtml as esc } from './model.mjs';

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
  const observe = (session) => ['interrupted', 'disconnected'].includes(session?.status) ? null : sceneActivity(session?.activity, live, now);
  const actors = unassignedLocalSessions(state).map((session) => ({
    ...session, source: 'session', status: observedSessionStatus(state.localSessions, session, connected), sceneActivity: observe(session),
  }));
  for (const agent of state.agents) {
    const linked = agent.connection?.status === 'connected' && sessions.find((session) => session.id === agent.connection?.sessionId);
    let activity = linked ? observe(linked) : null;
    if (!agent.connection && agent.provider === 'demo' && connected && !state.office.paused) {
      const task = state.tasks.find((item) => item.agentId === agent.id && ['waiting_input', 'waiting_approval'].includes(item.status));
      if (task) activity = { kind: task.status === 'waiting_input' ? 'question' : 'approval', room: 'executive', pose: 'presenting',
        label: task.status === 'waiting_input' ? '질문 대기 · 대표이사실' : '결과 발표 · 대표이사실', phase: 'active', taskId: task.id, peerSessionIds: [] };
    }
    actors.push({ ...agent, source: 'agent', status: connected ? agent.status : 'disconnected', sceneActivity: activity });
  }
  return actors;
}

export function sessionRoom(state, id, connected = true, now = Date.now()) {
  const actor = officeOccupants(state, connected, now).find((item) => item.source === 'session' ? item.id === id : item.connection?.sessionId === id);
  return actor?.sceneActivity?.room || 'office';
}

export function activityRoomMarkup(room, actors, selectedId) {
  const participants = actors.filter((actor) => actor.sceneActivity?.room === room && !actor.sceneActivity.taskId);
  if (!participants.length) return '';
  const label = room === 'meeting' ? '최근 협업한 세션' : '질문·승인 요청';
  return `<div class="room-section-label">${label} <span>${participants.length}</span></div>`
    + participants.map((actor) => {
      const id = actor.source === 'session' ? actor.id : actor.connection?.sessionId;
      return `<button class="room-entry activity-entry" type="button" data-workspace-session="${esc(id)}" aria-pressed="${selectedId === id}"><span class="entry-symbol" aria-hidden="true">${room === 'meeting' ? '↔' : '↗'}</span><span><strong>${esc(actor.name)}</strong><small>${esc(actor.sceneActivity.label)}</small></span></button>`;
    }).join('')
    + `<p class="activity-note">${room === 'meeting' ? '확인된 메시지 전달을 최대 60초 표시합니다. 세션을 선택해 공개 대화를 확인하세요.' : '대화를 확인하고 원래 Codex 창에서 질문에 답하거나 실행을 승인하세요.'}</p>`;
}

export function activitySummaryMarkup(actors) {
  const meetings = actors.filter((actor) => actor.sceneActivity?.room === 'meeting').length;
  const presentations = actors.filter((actor) => actor.sceneActivity?.room === 'executive').length;
  if (!meetings && !presentations) return '';
  return '<span>협업과 발표</span>'
    + (meetings ? `<button type="button" class="button button-small" data-room="meeting">최근 협업 · ${meetings}명</button>` : '')
    + (presentations ? `<button type="button" class="button button-small" data-room="executive">질문·발표 · ${presentations}명</button>` : '')
    + '<a class="inline-link" href="https://github.com/parkhw328/wook-home/wiki/Activity" target="_blank" rel="noopener noreferrer">동작 안내 ↗</a>';
}
