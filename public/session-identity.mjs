import { escapeHtml as esc } from './model.mjs';

export function identityMarkup(id, label = 'session-id') {
  return id ? `<span class="session-identity"><span>${esc(label)}</span><code>${esc(id)}</code></span>` : '';
}

export function staffIdentity(agent) {
  const link = agent.connection;
  return link?.sessionId ? identityMarkup(link.sessionId)
    : link?.entryId ? identityMarkup(link.entryId, '감지 ID · session-id 미확인') : '';
}

export function lifecycleLabel(session, online = true) {
  if (!online || session.status === 'disconnected') return '연결 끊김 · 생존 확인 불가';
  return session.lifecycle === 'live' ? '살아 있는 세션'
    : session.lifecycle === 'not_loaded' ? '저장 기록 · 현재 적재되지 않음' : '세션 생존 확인 필요';
}

export function sessionAlias(state, session) {
  return state.agents.find((agent) => agent.connection?.sessionId === session.id)?.name || '미등록 Codex';
}
