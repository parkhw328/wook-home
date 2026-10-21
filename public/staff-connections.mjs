import { apiRequest } from './api.mjs';
import { escapeHtml as esc, providerLinks } from './model.mjs';

export function connectionType(connection) {
  if (!connection) return '연결 미지정';
  if (connection.source === 'web') return connection.kind === 'conversation' ? '웹 대화 탭' : '웹 서비스 화면';
  return connection.kind === 'session' ? 'CLI 대화 기록' : 'CLI 프로세스';
}

export function connectionLocation(agent) {
  const link = agent.connection;
  if (!link) return '로컬 직원 정보';
  if (link.source === 'web') return link.scope || '브라우저';
  return `호스트 PC${link.scope ? ` · ${link.scope}` : ''}`;
}

export function connectionSummary(agent, provider) {
  if (provider?.kind === 'demo') return '체험용 · 외부 AI 호출 없음';
  return agent.connection ? `${connectionType(agent.connection)} · ${agent.connection.statusLabel}` : '감지한 CLI·웹을 연결해 주세요';
}

export function connectionMarkup(agent, provider) {
  if (provider?.kind === 'demo') return '';
  const link = agent.connection;
  const service = providerLinks(provider);
  const explanation = !link ? '이미 열어 둔 CLI 또는 AI 웹 탭을 선택해 이 직원에게 연결하세요.'
    : link.status === 'not_connected' ? '서버가 재시작되었습니다. 직원 정보는 유지되며, 현재 감지 목록에서 연결을 다시 선택해 주세요.'
      : link.source === 'web' ? '웹 탭의 열림 상태를 관찰합니다. 로그인·응답 생성 여부는 확인하지 않으며, 대화 읽기와 지시 전송은 해당 서비스에서 진행하세요.'
        : link.kind === 'process' ? '실행 프로세스를 관찰합니다. 저장 대화와의 연결이 확인되지 않아 이 항목으로 지시를 보내지는 않습니다.'
          : '연결한 Codex 대화를 확인할 수 있습니다. 지시 전송은 호스트에서 명시적으로 허용한 경우에 사용할 수 있습니다.';
  return `<section class="staff-connection-box" aria-label="직원 연결"><p>${esc(explanation)}</p>
    ${link?.source === 'web' && link.tabCount ? `<p class="field-help">같은 감지 항목의 탭 ${esc(link.tabCount)}개</p>` : ''}
    <div class="detail-actions"><button type="button" class="button" data-connect-agent="${esc(agent.id)}" data-mutation>${link ? '연결 변경·다시 연결' : 'CLI·웹 연결'}</button>
    ${link ? `<button type="button" class="button button-caution" data-disconnect-agent="${esc(agent.id)}" data-mutation>연결 해제</button>` : ''}
    ${link?.sessionId ? `<button type="button" class="button ${link.canControl ? 'button-primary' : 'button-secondary'}" data-${link.canControl ? 'session-command' : 'session'}="${esc(link.sessionId)}" data-mutation>${link.canControl ? 'CLI 지시 보내기' : 'CLI 대화 보기'}</button>` : ''}
    ${link?.source === 'web' && service.webUrl ? `<a class="button" href="${service.webUrl}" target="_blank" rel="noopener noreferrer">${esc(service.label)} 열기 ↗</a>` : ''}</div>
    <p class="field-help">연결 해제는 직원·CLI·웹 탭을 삭제하거나 종료하지 않습니다.</p></section>`;
}

export function eligibleEntries(entries, agent) {
  return entries.filter((entry) => (entry.canRegister || (agent && entry.linkedAgentId === agent.id
    && (entry.source === 'web' ? entry.status === 'open' : entry.kind === 'process' ? entry.status === 'running' : entry.status !== 'disconnected')))
    && (!agent || entry.provider === agent.provider));
}

function initialize() {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal staff-dialog';
  dialog.id = 'staff-connection-dialog';
  dialog.setAttribute('aria-labelledby', 'staff-connection-title');
  document.body.append(dialog);
  let requestGeneration = 0;
  let pending = false;
  let trigger = null;
  let entries = [];
  let agents = [];
  let requestedAgent = null;

  const find = (selector) => dialog.querySelector(selector);
  function frame(content) {
    dialog.innerHTML = `<div class="modal-header"><div><p class="eyebrow">CLI · WEB</p><h2 id="staff-connection-title" tabindex="-1">직원 연결</h2></div><button type="button" class="button" data-staff-close aria-label="직원 연결 창 닫기">닫기</button></div>${content}`;
    if (!dialog.open) dialog.showModal();
  }
  function error(message) {
    const element = find('#staff-error');
    element.textContent = message;
    element.hidden = false;
  }
  function setPending(value) {
    pending = value;
    for (const control of dialog.querySelectorAll('button, input, select')) control.disabled = value;
  }
  function selectedEntry() { return entries.find((entry) => entry.id === find('#staff-entry')?.value); }
  function selectionChanged(preserveEmployee = true) {
    const entry = selectedEntry();
    const employeeSelect = find('#staff-employee');
    const previous = preserveEmployee ? employeeSelect.value : '';
    const matching = agents.filter((agent) => agent.provider === entry?.provider);
    employeeSelect.innerHTML = `${requestedAgent ? '' : '<option value="">새 직원 등록</option>'}${matching.filter((agent) => !requestedAgent || agent.id === requestedAgent.id).map((agent) => `<option value="${esc(agent.id)}">${esc(agent.name)} · 기존 직원${agent.connection ? ' (연결 변경)' : ''}</option>`).join('')}`;
    if (matching.some((agent) => agent.id === previous)) employeeSelect.value = previous;
    if (requestedAgent) employeeSelect.value = requestedAgent.id;
    const creating = !employeeSelect.value;
    find('#staff-new-fields').hidden = !creating;
    find('#staff-name').required = creating;
    find('#staff-role').required = creating;
    find('#staff-submit').textContent = creating ? '직원 등록하고 연결' : '이 직원에게 연결';
    find('#staff-source-help').textContent = `${entry?.name || ''} · ` + (entry?.source === 'web'
      ? `${connectionType(entry)} · ${entry.scope} · ${entry.tabCount}개 탭. 관찰 전용이며 메시지는 원래 웹 서비스에서 작성하세요.`
      : entry?.kind === 'session' ? '선택한 CLI 대화 기록을 연결합니다. 지시 전송은 호스트의 허용 상태에 따릅니다.'
        : 'CLI 프로세스의 실행·종료를 관찰합니다. 대화 연결과 지시 전송은 별도로 지원되어야 합니다.');
    find('#staff-replace-help').hidden = !agents.find((agent) => agent.id === employeeSelect.value)?.connection;
  }

  async function open({ entryId, agentId } = {}) {
    if (pending) return;
    const generation = ++requestGeneration;
    if (!dialog.open) trigger = document.activeElement;
    requestedAgent = null;
    frame('<p role="status">직원과 감지 목록을 확인하고 있습니다.</p>');
    try {
      const [discovery, state] = await Promise.all([apiRequest('/discovery'), apiRequest('/state')]);
      if (generation !== requestGeneration || !dialog.open) return;
      agents = state.agents;
      requestedAgent = agentId ? agents.find((agent) => agent.id === agentId) : null;
      if (agentId && !requestedAgent) throw new Error('직원을 찾을 수 없습니다. 목록을 새로고침해 주세요.');
      entries = eligibleEntries(discovery.entries, requestedAgent);
      if (entryId && !entries.some((entry) => entry.id === entryId)) throw new Error('대상이 이미 연결되었거나 더 이상 감지되지 않습니다. 최신 목록을 확인해 주세요.');
      if (!entries.length) {
        frame('<p>연결할 수 있는 감지 대상이 없습니다. CLI 연결 프로그램이나 웹 감지를 켠 뒤 다시 확인하세요. 기존 직원과 연결할 때는 같은 공급자의 대상이 필요합니다.</p><div class="detail-actions"><button type="button" class="button" data-staff-refresh>목록 다시 확인</button><a class="inline-link" href="https://github.com/parkhw328/wook-home/wiki/Detection" target="_blank" rel="noopener noreferrer">감지 설정 안내 ↗</a></div>');
        return;
      }
      frame(`<form id="staff-connection-form" class="form-stack">
        <div class="form-field"><label for="staff-entry">연결할 CLI·웹</label><select id="staff-entry" name="entryId">${entries.map((entry) => `<option value="${esc(entry.id)}">${esc(connectionType(entry))} · ${esc(entry.name)} · ${esc(entry.scope)}</option>`).join('')}</select><p id="staff-source-help" class="field-help"></p></div>
        <div class="form-field"><label for="staff-employee">등록 방식</label><select id="staff-employee" name="agentId"></select><p id="staff-replace-help" class="field-help" hidden>이 직원의 기존 연결을 선택한 대상으로 변경합니다. 원래 CLI·웹은 종료하지 않습니다.</p></div>
        <div id="staff-new-fields" class="field-row"><div class="form-field"><label for="staff-name">직원 이름</label><input id="staff-name" name="name" maxlength="40" autocomplete="off" placeholder="예: 리서치 담당" required></div><div class="form-field"><label for="staff-role">담당 역할</label><input id="staff-role" name="role" maxlength="120" autocomplete="off" placeholder="예: 자료 조사" required></div></div>
        <p class="field-help">공급자는 선택한 대상에 맞춰 지정합니다. 직원 이름·역할은 저장되며 서버 재시작 후 감지 연결은 다시 선택합니다.</p>
        <div id="staff-error" class="form-error" role="alert" hidden></div><div class="form-actions"><button type="button" class="button" data-staff-refresh>목록 새로고침</button><button type="submit" id="staff-submit" class="button button-primary">직원 등록하고 연결</button></div></form>`);
      find('#staff-entry').value = entryId || entries.find((entry) => entry.linkedAgentId === agentId)?.id || entries[0].id;
      selectionChanged(false);
      find('#staff-entry').focus();
    } catch (failure) {
      if (generation === requestGeneration && dialog.open) frame(`<p class="form-error" role="alert">${esc(failure.message)}</p><button type="button" class="button" data-staff-refresh>목록 다시 확인</button>`);
    }
  }

  async function disconnect(agentId) {
    if (pending) return;
    trigger = document.activeElement;
    frame('<p>직원 연결을 해제하고 있습니다.</p><div id="staff-error" class="form-error" role="alert" hidden></div>');
    setPending(true);
    try {
      await apiRequest(`/agents/${encodeURIComponent(agentId)}/connection`, { method: 'DELETE' });
      dialog.close();
      document.dispatchEvent(new CustomEvent('office:staff-changed', { detail: { agentId } }));
    } catch (failure) { error(failure.message); }
    finally { setPending(false); }
  }

  dialog.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || !event.target.reportValidity()) return;
    const values = Object.fromEntries(new FormData(event.target));
    const entry = selectedEntry();
    if (!entry) return;
    setPending(true);
    try {
      const result = await apiRequest(values.agentId ? `/agents/${encodeURIComponent(values.agentId)}/connection` : '/agents/from-discovery', {
        method: values.agentId ? 'PUT' : 'POST', body: values.agentId ? { entryId: entry.id } : { entryId: entry.id, name: values.name.trim(), role: values.role.trim() },
      });
      dialog.close();
      document.dispatchEvent(new CustomEvent('office:staff-changed', { detail: { agentId: result.id } }));
    } catch (failure) { error(failure.message); }
    finally { setPending(false); }
  });
  dialog.addEventListener('change', (event) => {
    if (event.target.id === 'staff-entry' || event.target.id === 'staff-employee') selectionChanged();
  });
  dialog.addEventListener('click', (event) => {
    if (pending) return;
    if (event.target.closest('[data-staff-close]')) dialog.close();
    if (event.target.closest('[data-staff-refresh]')) void open({ agentId: requestedAgent?.id });
  });
  dialog.addEventListener('cancel', (event) => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => { requestGeneration += 1; if (trigger?.isConnected) trigger.focus({ preventScroll: true }); });
  document.addEventListener('office:connect-entry', (event) => { void open({ entryId: event.detail?.entryId }); });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-open-staff-connection')) void open();
    if (button.dataset.connectAgent) void open({ agentId: button.dataset.connectAgent });
    if (button.dataset.disconnectAgent) void disconnect(button.dataset.disconnectAgent);
  });
}

if (typeof document !== 'undefined') initialize();
