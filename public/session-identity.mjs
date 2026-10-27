import { escapeHtml as esc } from './model.mjs';

export function identityMarkup(id, label = 'session-id', embedded = false) {
  if (!id) return '';
  const attributes = `class="session-identity" data-session-identity="${esc(id)}" data-identity-label="${esc(label)}"`;
  // Cards already have a keyboard target. Never nest another button in them.
  return embedded ? `<span ${attributes} aria-hidden="true">ID</span>`
    : `<button type="button" ${attributes} aria-label="전체 ${esc(label)} 확인">ID</button>`;
}

export function staffIdentity(agent, embedded = false) {
  const link = agent.connection;
  return link?.sessionId ? identityMarkup(link.sessionId, 'session-id', embedded)
    : link?.entryId ? identityMarkup(link.entryId, '감지 ID · session-id 미확인', embedded) : '';
}

export function discoveryName(entry) {
  return entry.kind === 'session' ? entry.linkedAgentName || 'Codex 세션' : entry.name;
}

// The search API's display name contains the provider and full origin ID.
export function savedSessionIdentity(session) {
  const [name, ...parts] = (session.name || '').split(' · ');
  return { name, id: parts.join(' · ') };
}

export function lifecycleLabel(session, online = true) {
  if (!online || session.status === 'disconnected') return '연결 끊김 · 생존 확인 불가';
  return session.lifecycle === 'live' ? '살아 있는 세션'
    : session.lifecycle === 'not_loaded' ? '저장 기록 · 현재 적재되지 않음' : '세션 생존 확인 필요';
}

export function sessionAlias(state, session) {
  return state.agents.find((agent) => agent.connection?.sessionId === session.id)?.name || '미등록 Codex';
}
