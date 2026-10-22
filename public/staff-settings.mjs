import { escapeHtml as esc } from './model.mjs';
import { effortLabel } from './execution-controls.mjs';

export function projectSummary(agent, local) {
  const observed = observedProject(agent, local);
  return agent.projectName ? `담당 프로젝트 · ${agent.projectName}` : observed
    ? `CLI 작업 · ${observed}${agent.connection.status !== 'connected' ? ' · 마지막 관찰' : ''} (배정 미지정)` : '담당 프로젝트 · 미배정';
}

export function observedProject(agent, local) {
  if (agent.connection?.source !== 'cli' || agent.connection.kind !== 'session'
    || !local?.sessions?.some((session) => session.id === agent.connection.sessionId)) return '';
  return agent.connection.scope || local.workspace || '';
}

export function projectField(agent = {}, agents = [], local, prefix = 'edit') {
  const suggestions = [...new Set([...agents.map((item) => item.projectName), observedProject(agent, local)].filter(Boolean))];
  const observed = observedProject(agent, local);
  return `<div class="form-field staff-project-field"><label for="${prefix}-project">담당 프로젝트 <span class="muted">선택</span></label><input id="${prefix}-project" name="projectName" list="${prefix}-projects" maxlength="80" value="${esc(agent.projectName)}" autocomplete="off" placeholder="예: 고객 포털"><datalist id="${prefix}-projects">${suggestions.map((name) => `<option value="${esc(name)}"></option>`).join('')}</datalist><p class="field-help">프로젝트 이름을 입력하거나 기존 이름을 선택하세요. 비우면 배정이 해제됩니다.${observed ? ` 연결된 CLI 프로젝트: ${esc(observed)}.` : ''} 배정은 담당 표시이며, CLI 작업 폴더는 연결한 대화를 따릅니다.</p></div>`;
}

export function preferenceSummary(agent) {
  const value = agent.executionPreference;
  return value?.model ? `${value.model} · ${effortLabel(value.reasoningEffort)}` : '현재 CLI 설정 유지';
}

// An unsent explicit choice wins over the saved employee default. Empty choice
// is intentional too, and must never fall back to a previously saved model.
export function commandSelection(state, sessionId, drafts) {
  if (drafts.has(sessionId)) return drafts.get(sessionId);
  const agent = state.agents.find((item) => item.connection?.source === 'cli'
    && item.connection.kind === 'session' && item.connection.sessionId === sessionId);
  return agent?.executionPreference || {};
}
