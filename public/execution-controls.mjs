import { escapeHtml as esc } from './model.mjs';

const effortNames = { none: '없음', minimal: '최소', low: '낮음', medium: '보통', high: '높음', xhigh: '매우 높음', max: '최대', ultra: '울트라' };
export const effortLabel = (value) => value ? `${Object.hasOwn(effortNames, value) ? `${effortNames[value]} · ` : ''}${value}` : '현재 CLI 설정 유지';

export function executionSelectionReason(catalog, selection) {
  if (!selection?.model) return '';
  const model = catalog?.status === 'ready' && catalog.models.find((entry) => entry.id === selection.model);
  return model && model.reasoningEfforts.includes(selection.reasoningEffort) ? '' : '선택한 모델·강도를 현재 확인할 수 없습니다. 목록 복구를 기다리거나 현재 CLI 설정 유지를 선택하세요.';
}

export function executionFields(prefix = 'command') {
  const help = prefix === 'command' ? 'execution-help' : `${prefix}-execution-help`;
  return `<div class="field-row"><div class="form-field"><label for="${prefix}-model">추론 모델</label><select id="${prefix}-model" name="model" aria-describedby="${help}"></select></div><div class="form-field"><label for="${prefix}-effort">추론 강도</label><select id="${prefix}-effort" name="reasoningEffort" aria-describedby="${help}"></select></div></div><p id="${help}" class="field-help"></p>`;
}

// Update only options that changed; polling must not replace the form or draft.
export function updateExecutionFields(root, catalog, selection, locked = false, prefix = 'command') {
  const modelSelect = root.querySelector(`#${prefix}-model`);
  const effortSelect = root.querySelector(`#${prefix}-effort`);
  if (!modelSelect || !effortSelect) return;
  const models = catalog?.status === 'ready' ? catalog.models : [];
  const model = models.find((entry) => entry.id === selection.model);
  const markup = '<option value="">현재 CLI 설정 유지</option>'
    + (selection.model && !model ? `<option value="${esc(selection.model)}">${esc(selection.model)} · 현재 확인 불가</option>` : '')
    + models.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join('');
  if (modelSelect.dataset.signature !== markup) { modelSelect.innerHTML = markup; modelSelect.dataset.signature = markup; }
  modelSelect.value = selection.model || '';
  modelSelect.disabled = locked;
  const efforts = [...(model?.reasoningEfforts || [])];
  if (selection.reasoningEffort && !efforts.includes(selection.reasoningEffort)) efforts.push(selection.reasoningEffort);
  const effortMarkup = efforts.length && selection.model
    ? efforts.map((effort) => `<option value="${esc(effort)}">${esc(effortLabel(effort))}${effort === model?.defaultReasoningEffort ? ' (기본)' : ''}</option>`).join('')
    : '<option value="">현재 CLI 설정 유지</option>';
  if (effortSelect.dataset.signature !== effortMarkup) { effortSelect.innerHTML = effortMarkup; effortSelect.dataset.signature = effortMarkup; }
  effortSelect.value = selection.reasoningEffort || '';
  effortSelect.disabled = locked || !model;
  root.querySelector(prefix === 'command' ? '#execution-help' : `#${prefix}-execution-help`).textContent = executionSelectionReason(catalog, selection) || (selection.model
    ? '지시를 보낼 때 적용합니다. 현재 실행 중인 작업은 유지하고, 대기 중인 지시를 포함한 다음 실행부터 이 세션의 기본 모델·강도가 바뀝니다.'
    : models.length ? 'Codex에서 확인한 모델과 모델별 지원 강도입니다. 현재 CLI 설정 유지를 선택하면 실행 설정을 바꾸지 않습니다.'
      : '연결 설정에서 지시 전송을 켜면 Codex의 실제 모델 목록을 불러옵니다. 목록 확인 전에는 현재 CLI 설정으로 지시할 수 있습니다.');
}

export { browserId as newCommandId } from './browser-id.mjs';
