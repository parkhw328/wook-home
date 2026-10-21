import { apiRequest } from './api.mjs';
import {
  CommandDelivery, commandPresentation, commandUnavailableReason,
  loadCommandReceipts, saveCommandReceipts,
} from './commands.mjs';
import {
  escapeHtml as esc, statusLabel, statusClass, isOpenTask, needsAttention,
  officeCounts, taskUnavailableReason, filterTasks, displayTime, normalizeState, programUrl,
  officeName, observedSessionStatus, sessionStatusLabel, characterMotion, orderedLocalSessions,
} from './model.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ICONS = {
  office: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 9h1m4 0h1m-6 3h1m4 0h1"/>',
  task: '<rect x="5" y="4" width="15" height="17" rx="2"/><path d="M9 4V2h7v2M9 10l1 1 2-2m2 1h3M9 16l1 1 2-2m2 1h3"/>',
  handoff: '<path d="M14 4h6v6m0-6-8 8M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  message: '<path d="M21 11a9 9 0 0 1-9 9H3l2-4a9 9 0 1 1 16-5Z"/><path d="M8 10h8m-8 4h5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4m0 3v1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.office}</svg>`;
}

function fillIcons(root = document) {
  $$('[data-icon]', root).forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
}

function badge(status) {
  return `<span class="status ${statusClass(status)}">${statusLabel(status)}</span>`;
}

function avatar(agent) {
  return `<span class="avatar" data-provider="${esc(agent?.provider || '')}" aria-hidden="true">${esc(Array.from(agent?.name || '?')[0])}</span>`;
}

function emptyState(title, description, symbol = 'task') {
  return `<div class="empty-state"><span class="empty-icon">${icon(symbol)}</span><strong>${esc(title)}</strong><p>${esc(description)}</p></div>`;
}

let state = { office: { paused: false }, providers: [], agents: [], tasks: [], events: [], programs: [] };
let connected = false;
let loaded = false;
let pending = false;
let refreshing = null;
let refreshAgain = false;
let toastTimer;
let currentView = 'office';
let modalContext = null;
let modalTrigger = null;
let sceneSignature = '';
let sessionsSignature = '';
const commandDeliveries = new Map();
const commandDrafts = new Map();
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let motionEnabled = !motionPreference.matches;
const modal = $('#modal');
const body = $('#modal-body');
try {
  for (const record of loadCommandReceipts(sessionStorage)) {
    commandDeliveries.set(record.sessionId, new CommandDelivery(apiRequest, record, onCommandChange));
  }
} catch { /* Some browser privacy modes disable session storage. */ }

function setConnection(value) {
  connected = value;
  const pill = $('#connection-status');
  pill.className = `connection-pill ${value ? 'connected' : 'disconnected'}`;
  pill.innerHTML = `<i aria-hidden="true"></i>${value ? '로컬 서버 연결됨' : '서버 연결 끊김'}`;
  $('#connection-error').hidden = value;
  if (!value && !loaded) {
    $('#connection-error p').textContent = '서버가 실행 중인지 확인하세요. 연결되면 사무실을 불러옵니다.';
  } else {
    $('#connection-error p').textContent = '마지막으로 받은 상태입니다. 연결되면 자동으로 갱신합니다.';
  }
  updateControls();
  renderCharacters();
  renderSessions();
}

function toast(message, isError = false) {
  clearTimeout(toastTimer);
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast${isError ? ' error' : ''}`;
  node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, 4500);
}

function updateControls() {
  const unavailable = !connected || pending;
  ['#hire-button', '#scene-hire-button', '#resume-banner-button', '#pause-button', '#download-button'].forEach((selector) => {
    $(selector).disabled = unavailable;
  });
  $('#new-task-button').disabled = unavailable || state.office.paused || !state.agents.some((agent) => !taskUnavailableReason(state, agent));
  $('#new-task-button').title = !state.agents.some((agent) => !taskUnavailableReason(state, agent)) ? '업무를 맡길 수 있는 체험용 직원이 필요합니다.' : '';
  $$('[data-mutation]', body).forEach((button) => {
    button.disabled = unavailable || button.dataset.blocked === 'true';
  });
  renderSessionCommand();
}

function renderStats() {
  const counts = officeCounts(state);
  for (const [key, unit] of [['agents', '명'], ['working', '건'], ['waiting', '건'], ['completed', '건']]) {
    $(`#stat-${key}`).innerHTML = `${counts[key]}<small>${unit}</small>`;
  }
  $('#team-count').textContent = counts.agents;
  $('#nav-task-count').textContent = counts.unfinished;
  $('#paused-notice').hidden = !state.office.paused;
  $('#office-meta').textContent = state.office.paused ? '업무 일시 중지' : '로컬 사무실';
  $('#app-version').textContent = `v${state.office.version || '개발 중'} · 로컬 작업 공간`;
  const name = officeName(state.office);
  $$('[data-office-name]').forEach((node) => { node.textContent = name; node.title = name; });
  $('#brand-link').setAttribute('aria-label', `${name} 사무실`);
  document.title = `${name} · ${VIEW_COPY[currentView][0]}`;
  $('meta[name="description"]').content = `${name} · AI 직원과 로컬 CLI의 작업 상태를 확인하는 사무실`;
}

function officeOccupants() {
  const sessions = orderedLocalSessions(state.localSessions).map((session) => ({
    ...session, source: 'session', status: observedSessionStatus(state.localSessions, session, connected),
  }));
  const agents = state.agents.map((agent) => ({ ...agent, source: 'agent' }));
  return [...sessions, ...agents];
}

function renderCharacters() {
  const occupants = officeOccupants();
  const displayed = occupants.slice(0, 6);
  const signature = JSON.stringify([displayed.map(({ id, source, status, name }) => ({ id, source, status, name })), connected, state.office.paused]);
  $('#office-scene').classList.toggle('motion-disabled', !motionEnabled);
  $('#scene-empty').hidden = occupants.length > 0;
  $('#office-meta').textContent = `${occupants.length}명${occupants.length > 6 ? ' · 사무실에는 6명 표시' : ' · 현재 사무실'}`;
  if (signature === sceneSignature) return;
  sceneSignature = signature;
  const previous = document.activeElement?.closest('#desk-grid') ? document.activeElement : null;
  const previousSource = previous?.dataset.session ? 'session' : previous?.dataset.agent ? 'agent' : null;
  const previousId = previousSource ? previous.dataset[previousSource] : null;
  $('#desk-grid').innerHTML = displayed.map((occupant, index) => {
    const isSession = occupant.source === 'session';
    const label = isSession ? sessionStatusLabel(occupant.status) : statusLabel(occupant.status);
    const movement = characterMotion(occupant.status, connected && (isSession || !state.office.paused));
    const provider = state.providers.find((item) => item.id === occupant.provider);
    const source = isSession ? 'CLI 관찰' : provider?.kind === 'demo' ? '체험 직원' : '등록 직원';
    const compactName = isSession ? occupant.name.replace(/^Codex\s*·\s*/, '')
      : Array.from(occupant.name).length > 3 ? `${Array.from(occupant.name).slice(0, 2).join('')}…` : occupant.name;
    return `<button type="button" class="office-character station-${index} variant-${index % 3} motion-${movement} ${statusClass(occupant.status)}" data-${occupant.source}="${esc(occupant.id)}" aria-label="${esc(occupant.name)} · ${source} · ${label} 상세 보기">
      <span class="character-shadow" aria-hidden="true"></span>
      <span class="character-body" aria-hidden="true"><span class="character-head"><i></i></span><span class="character-shirt"></span><span class="character-arm arm-left"></span><span class="character-arm arm-right"></span><span class="character-leg leg-left"></span><span class="character-leg leg-right"></span></span>
      <span class="character-indicator" aria-hidden="true">${movement === 'typing' ? '···' : movement === 'attention' ? '?' : isSession ? '>_' : '·'}</span>
      <span class="character-label"><strong><span class="character-name">${esc(occupant.name)}</span><span class="compact-character-name" aria-hidden="true">${esc(compactName)}</span></strong><small>${source}</small></span>
    </button>`;
  }).join('');
  if (previousId) $$(`[data-${previousSource}]`, $('#desk-grid')).find((node) => node.dataset[previousSource] === previousId)?.focus({ preventScroll: true });
}

function renderAgents() {
  renderCharacters();
  $('#agent-list').innerHTML = state.agents.length ? state.agents.map((agent) => `<button type="button" class="agent-card" data-agent="${esc(agent.id)}">${avatar(agent)}<span class="agent-info"><strong>${esc(agent.name)}</strong><small>${esc(agent.role)}</small></span>${badge(agent.status)}</button>`).join('')
    : emptyState('첫 동료를 기다리고 있어요', '체험용 직원을 채용해 업무 흐름을 시작해 보세요.', 'people');
  const symbols = { openai: '◎', claude: '✳', gemini: '✧', meta: '∞' };
  $('#provider-list').innerHTML = state.providers.filter((provider) => provider.kind === 'external').map((provider) => `<div class="provider-item" title="${esc(provider.reason)}"><span class="provider-symbol" aria-hidden="true">${symbols[provider.id] || '◇'}</span><strong>${esc(provider.name)}</strong><small>${provider.available ? '연결 가능' : '연동 준비 중'}</small></div>`).join('');
}

function renderSessions() {
  const local = state.localSessions;
  const label = !connected ? '서버 연결 끊김' : local?.status === 'connected' ? '관찰 연결됨' : local?.status === 'disconnected' ? '관찰 연결 끊김' : '관찰 연결 대기';
  $('#sessions-connection').textContent = label;
  const sessions = orderedLocalSessions(local);
  const signature = JSON.stringify([label, local?.control?.enabled, sessions.map(({ id, name, status }) => ({ id, name, status }))]);
  const focused = document.activeElement?.closest('#session-list') ? document.activeElement.dataset.session : null;
  if (signature !== sessionsSignature) {
    sessionsSignature = signature;
    $('#session-list').innerHTML = sessions.length ? sessions.map((session) => {
    const status = observedSessionStatus(local, session, connected);
    return `<button type="button" class="session-card" data-session="${esc(session.id)}"><span class="session-symbol" aria-hidden="true">&gt;_</span><span class="session-info"><strong>${esc(session.name)}</strong><small>Codex · ${local?.control?.enabled ? '지시 전송 연결됨' : '상태 관찰'}</small></span><span class="status ${statusClass(status)}">${sessionStatusLabel(status)}</span></button>`;
    }).join('') : emptyState('로컬 CLI의 상태를 연결하세요', 'PC에서 상태 연결기를 실행하면 현재 작업 공간의 Codex 세션이 나타납니다. 대화 내용은 전송하지 않습니다.', 'activity');
    if (focused) $$('[data-session]', $('#session-list')).find((node) => node.dataset.session === focused)?.focus({ preventScroll: true });
  }
  if (modalContext?.type === 'session' && modal.open) {
    const session = sessions.find((item) => item.id === modalContext.id);
    if (session) {
      const status = observedSessionStatus(local, session, connected);
      if ($('#observed-status', body)) $('#observed-status', body).textContent = sessionStatusLabel(status);
      if ($('#observed-last-event', body)) $('#observed-last-event', body).textContent = displayTime(session.lastActivityAt);
      if ($('#observed-connection', body)) $('#observed-connection', body).textContent = label;
    } else {
      if ($('#observed-status', body)) $('#observed-status', body).textContent = '확인 필요 · 관찰 목록에서 사라짐';
      if ($('#observed-connection', body)) $('#observed-connection', body).textContent = '이 세션의 현재 상태를 확인할 수 없습니다.';
    }
    renderSessionCommand();
  }
}

function renderInbox() {
  const attention = state.tasks.filter(needsAttention);
  $('#inbox-count').textContent = attention.length;
  $('#inbox-list').innerHTML = attention.length ? attention.slice(0, 4).map((task) => {
    const agent = state.agents.find((item) => item.id === task.agentId);
    return `<button type="button" class="inbox-item" data-task="${esc(task.id)}"><div>${badge(task.status)}<small>${esc(agent?.name || '직원')}</small></div><strong>${esc(task.title)}</strong><small>${task.status === 'waiting_input' ? '질문을 확인하고 답변해 주세요' : '체험 결과를 확인하고 승인해 주세요'} <span aria-hidden="true">→</span></small></button>`;
  }).join('') : `<div class="inbox-empty"><span class="empty-icon">${icon('check')}</span><strong>지금은 여유로운 데스크</strong><p>${state.office.paused ? '업무를 재개하면 대기 중인 내용을 확인할 수 있어요.' : '응답이 필요하면 이곳에 모아 드릴게요.'}</p></div>`;
  $('#event-list').innerHTML = state.events.length ? state.events.slice(0, 5).map((event) => `<div class="event-item">${esc(event.message)}<time datetime="${esc(event.createdAt)}">${displayTime(event.createdAt)}</time></div>`).join('') : '<p class="event-empty">아직 조용한 사무실이에요.<br>동료를 맞이하면 소식이 쌓이기 시작합니다.</p>';
}

function taskRow(task) {
  const agent = state.agents.find((item) => item.id === task.agentId);
  return `<button type="button" class="task-row" data-task="${esc(task.id)}">${avatar(agent)}<span class="task-row-info"><strong>${esc(task.title)}</strong><small>${esc(agent?.name || '직원')} · ${displayTime(task.updatedAt)}</small></span>${badge(task.status)}<span aria-hidden="true">›</span></button>`;
}

function renderTasks() {
  const tasks = filterTasks(state.tasks, $('#task-filter').value);
  $('#task-total').textContent = state.tasks.length;
  $('#task-list').innerHTML = tasks.length ? tasks.map(taskRow).join('') : emptyState(
    state.tasks.length ? '이 상태의 업무가 없습니다' : '첫 번째 업무를 함께 시작해 볼까요?',
    state.tasks.length ? '다른 상태를 선택해 업무를 확인하세요.' : '체험용 직원을 채용한 뒤 업무를 지시해 보세요.',
  );
}

function renderHandoff() {
  const counts = officeCounts(state);
  $('#handoff-summary').innerHTML = `<div><dt>사무실</dt><dd>${state.office.paused ? '일시 중지됨' : '운영 중'}</dd></div><div><dt>등록된 직원</dt><dd>${counts.agents}명</dd></div><div><dt>미완료 업무</dt><dd>${counts.unfinished}건</dd></div><div><dt>완료 업무</dt><dd>${counts.completed}건</dd></div>`;
  $('#pause-button').innerHTML = `${icon(state.office.paused ? 'play' : 'pause')}${state.office.paused ? '사무실 업무 재개' : '사무실 일시 중지'}`;
}

function renderPrograms() {
  const titles = { wShell: '서버 접속과 파일 전송을 한곳에서', wPost: 'API 요청과 응답을 간편하게', wText: '문서 편집과 차이 비교를 한곳에서', 'StackQueue Blog': 'StackQueue 네이버 블로그' };
  const marks = { wShell: '&gt;_', wPost: '{ }', wText: 'Tt', 'StackQueue Blog': 'SQ' };
  $('#program-list').innerHTML = state.programs.filter((program) => programUrl(program)).map((program) => {
    const isBlog = program.name === 'StackQueue Blog';
    return `<a class="program-card ${isBlog ? 'blog-card' : ''}" href="${programUrl(program)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(program.name)} ${isBlog ? '네이버 블로그' : 'GitHub 저장소'} (새 탭)"><header><span class="program-icon" aria-hidden="true">${marks[program.name]}</span><h3>${esc(program.name)}</h3><span class="external-arrow" aria-hidden="true">↗</span></header><strong>${titles[program.name]}</strong><p>${esc(program.description)}</p><span class="program-link-label">${isBlog ? '블로그에서' : 'GitHub에서'} 살펴보기 <span aria-hidden="true">→</span></span></a>`;
  }).join('');
}

function render() {
  const focus = document.activeElement;
  const focusToken = ['agent', 'task', 'session'].map((kind) => focus?.dataset[kind] ? { kind, id: focus.dataset[kind] } : null).find(Boolean);
  const focusContainer = focus?.closest('#desk-grid, #agent-list, #session-list, #inbox-list, #task-list')?.id;
  renderStats();
  renderAgents();
  renderSessions();
  renderInbox();
  renderTasks();
  renderHandoff();
  renderPrograms();
  if (focusToken && focusContainer) {
    $$(`[data-${focusToken.kind}]`, $(`#${focusContainer}`)).find((node) => node.dataset[focusToken.kind] === focusToken.id)?.focus({ preventScroll: true });
  }
  syncModal();
  updateControls();
}

async function refresh(force = false) {
  if (refreshing) {
    if (force) refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      const nextState = normalizeState(await apiRequest('/state'));
      const changed = JSON.stringify(state) !== JSON.stringify(nextState);
      state = nextState;
      loaded = true;
      setConnection(true);
      if (changed || force) render();
    } catch {
      setConnection(false);
    }
  })();
  try {
    await refreshing;
  } finally {
    refreshing = null;
    if (refreshAgain) {
      refreshAgain = false;
      await refresh();
    }
  }
}

const VIEW_COPY = {
  office: ['나의 사무실', 'A PLACE TO MAKE THINGS HAPPEN', '오늘도, 함께 만드는 일.', '동료를 모으고, 일을 나누고, 다음 한 걸음을 만들어 보세요.'],
  tasks: ['업무 보드', 'ONE TASK AT A TIME', '작은 일부터, 하나씩.', '질문에 답하고 결과를 확인하며 함께 일을 완성해 보세요.'],
  handoff: ['작업 인계', 'PICK UP WHERE YOU LEFT OFF', '오늘의 일을, 다음으로.', '잠시 멈추더라도 일의 흐름은 이어질 수 있도록.'],
};

function navigate() {
  const view = location.hash.slice(1);
  currentView = Object.hasOwn(VIEW_COPY, view) ? view : 'office';
  const [label, eyebrow, title, description] = VIEW_COPY[currentView];
  $('#page-label').textContent = label;
  $('#page-eyebrow').textContent = eyebrow;
  $('#page-title').textContent = title;
  $('#page-description').textContent = description;
  document.title = `${officeName(state.office)} · ${label}`;
  $$('.view').forEach((node) => { node.hidden = node.id !== `view-${currentView}`; });
  $$('.nav-link').forEach((node) => {
    const active = node.dataset.view === currentView;
    node.classList.toggle('active', active);
    if (active) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
}

function openModal(title, eyebrow, content, context) {
  if (!modal.open) modalTrigger = document.activeElement;
  modalContext = context;
  $('#modal-title').textContent = title;
  $('#modal-eyebrow').textContent = eyebrow;
  modal.setAttribute('aria-labelledby', 'modal-title');
  body.innerHTML = content;
  fillIcons(body);
  if (!modal.open) modal.showModal();
  $('#modal-title').tabIndex = -1;
  $('#modal-title').focus({ preventScroll: true });
  updateControls();
}

function closeModal() {
  if (pending) return;
  modal.close();
}

function formError(message) {
  const node = $('#form-error', body);
  if (node) {
    node.textContent = message;
    node.hidden = false;
  } else {
    toast(message, true);
  }
}

function errorSlot() {
  return '<div id="form-error" class="form-error" role="alert" hidden></div>';
}

async function mutate(path, payload, successMessage, method = 'POST', after) {
  if (pending) return;
  if (!connected) { formError('서버와 연결된 후 다시 시도해 주세요.'); return; }
  pending = true;
  updateControls();
  if ($('#form-error', body)) $('#form-error', body).hidden = true;
  let result;
  try {
    result = await apiRequest(path, { method, body: payload });
  } catch (error) {
    if (error.code === 'CONNECTION_ERROR') setConnection(false);
    formError(error.message);
    pending = false;
    updateControls();
    await refresh();
    return;
  }
  // Keep the confirmed write visible even if the subsequent state read fails.
  const collection = path.startsWith('/agents') ? 'agents' : path.startsWith('/tasks') ? 'tasks' : null;
  if (collection && result?.id) {
    const index = state[collection].findIndex((item) => item.id === result.id);
    if (index === -1) state[collection].push(result);
    else state[collection][index] = result;
  } else if (path.startsWith('/office/')) {
    state.office = result;
  }
  await refresh(true);
  pending = false;
  render();
  updateControls();
  if (after) after(result);
  toast(successMessage);
}

function providerOptions(selected = 'demo') {
  return state.providers.map((provider) => `<option value="${esc(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${esc(provider.name)}${provider.kind === 'demo' ? ' · 체험용' : provider.available ? '' : ' · 등록만 가능'}</option>`).join('');
}

function updateProviderFields() {
  const provider = state.providers.find((item) => item.id === $('#agent-provider', body)?.value);
  if (!provider) return;
  const model = $('#agent-model', body);
  const effort = $('#agent-effort', body);
  model.innerHTML = provider.models.length ? provider.models.map((item) => `<option>${esc(item)}</option>`).join('') : '<option value="">연동 후 설정 가능</option>';
  effort.innerHTML = provider.reasoningEfforts.length ? provider.reasoningEfforts.map((item) => `<option value="${esc(item)}">${item === 'none' ? '해당 없음' : esc(item)}</option>`).join('') : '<option value="">지원 옵션 미확정</option>';
  model.disabled = !provider.models.length;
  effort.disabled = !provider.reasoningEfforts.length;
  $('#provider-help', body).textContent = provider.kind === 'demo' ? '실제 AI를 호출하지 않는 체험용 직원입니다. 고정된 질문과 결과로 업무 흐름을 경험합니다.' : (provider.reason || '직원 정보만 등록합니다. 실제 AI 연결과 업무 실행은 준비 중입니다.');
}

function openHire() {
  if (!connected) return;
  openModal('새로운 동료를 맞이하세요', 'GROW YOUR LITTLE TEAM', `<form id="hire-form" class="form-stack"><div class="field-row"><div class="form-field"><label for="agent-name">직원 이름</label><input id="agent-name" name="name" placeholder="예: 모아" maxlength="40" required autocomplete="off"></div><div class="form-field"><label for="agent-role">담당 역할</label><input id="agent-role" name="role" placeholder="예: 아이디어 정리" maxlength="120" required autocomplete="off"></div></div><div class="form-field"><label for="agent-provider">AI 공급자</label><select id="agent-provider" name="provider">${providerOptions()}</select><p class="field-help" id="provider-help"></p></div><div class="field-row"><div class="form-field"><label for="agent-model">모델</label><select id="agent-model" name="model"></select></div><div class="form-field"><label for="agent-effort">추론 강도</label><select id="agent-effort" name="reasoningEffort"></select></div></div><div class="info-box">${icon('spark')}<span>직원의 이름과 역할은 나중에 바꿀 수 있어요. 연결 가능한 공급자의 실제 지원 옵션만 표시합니다.</span></div>${errorSlot()}<div class="form-actions"><button type="button" class="button" data-close>취소</button><button class="button button-primary" type="submit" data-mutation>직원 채용하기</button></div></form>`, { type: 'hire' });
  updateProviderFields();
  $('#agent-name', body).focus();
}

function openAgent(id) {
  const agent = state.agents.find((item) => item.id === id);
  if (!agent) return;
  const provider = state.providers.find((item) => item.id === agent.provider);
  const reason = taskUnavailableReason(state, agent);
  const tasks = filterTasks(state.tasks.filter((task) => task.agentId === id), 'all');
  const capabilities = { createSession: '새 업무 실행', observeSession: '세션 관찰', resumeSession: '세션 재개', interrupt: '업무 중단', changeModel: '모델 변경' };
  openModal(agent.name, 'MEET YOUR TEAMMATE', `<div class="detail-heading">${avatar(agent)}<div><h3>${esc(agent.role)}</h3><p>${esc(provider?.name || agent.provider)}${provider?.kind === 'demo' ? ' · 체험용 직원' : ''}</p></div>${badge(agent.status)}</div><dl class="detail-facts"><div><dt>실행 위치</dt><dd>로컬 저장 공간</dd></div><div><dt>연결 상태</dt><dd>${provider?.kind === 'demo' ? '체험용 · 외부 AI 호출 없음' : '외부 AI 미연결'}</dd></div><div><dt>모델</dt><dd>${esc(agent.model || '연동 후 설정 가능')}</dd></div><div><dt>추론 강도</dt><dd>${agent.reasoningEffort === 'none' ? '해당 없음' : esc(agent.reasoningEffort || '지원 옵션 미확정')}</dd></div></dl><div class="capability-list">${Object.entries(capabilities).map(([key, label]) => `<span class="capability-tag ${provider?.capabilities?.[key] ? 'supported' : ''}">${label} · ${provider?.capabilities?.[key] ? '지원' : '미지원'}</span>`).join('')}</div>${reason ? `<p class="field-help">${esc(reason)}</p>` : '<p class="field-help">체험용 직원에게 업무를 맡겨 질문과 승인 흐름을 확인하세요.</p>'}<div class="detail-actions"><button type="button" class="button" data-edit-agent="${esc(id)}" data-mutation>직원 정보 수정</button><button type="button" class="button button-primary" data-new-task="${esc(id)}" data-mutation data-blocked="${Boolean(reason)}" ${reason ? 'disabled' : ''}>${icon('plus')}업무 지시</button></div><h3 class="detail-section-title">이 직원의 업무</h3>${tasks.length ? tasks.slice(0, 8).map(taskRow).join('') : emptyState('아직 맡은 업무가 없어요', '업무를 지시하면 진행 내용을 이곳에서 확인할 수 있습니다.')}`, { type: 'agent', id, signature: agentSignature(id) });
}

function openSession(id) {
  const session = state.localSessions?.sessions?.find((item) => item.id === id);
  if (!session) return;
  const status = observedSessionStatus(state.localSessions, session, connected);
  const draft = commandDeliveries.get(id)?.record.content ?? commandDrafts.get(id) ?? '';
  openModal(session.name, 'LOCAL CLI · SESSION', `<div class="info-box">${icon('activity')}<span>명령 허용 모드에서 기존 Codex 세션에 지시할 수 있습니다. 답변과 실행 결과는 원래 CLI에서 확인하세요.</span></div>
    <dl class="detail-facts session-facts"><div><dt>관찰된 상태</dt><dd id="observed-status">${sessionStatusLabel(status)}</dd></div><div><dt>마지막 활동</dt><dd id="observed-last-event">${displayTime(session.lastActivityAt)}</dd></div><div><dt>연결 상태</dt><dd id="observed-connection">${state.localSessions.status === 'connected' && connected ? '관찰 연결됨' : '관찰 연결 끊김'}</dd></div><div><dt>작업 공간</dt><dd>${esc(state.localSessions.workspace || '현재 작업 공간')}</dd></div></dl>
    <p class="field-help">사무실 중지는 외부 CLI를 멈추지 않습니다. <a class="inline-link" href="https://github.com/parkhw328/wook-home/wiki/CLI" target="_blank" rel="noopener noreferrer">상태·연결 도움말 ↗</a></p>
    <section class="command-section" aria-labelledby="command-heading"><h3 id="command-heading">이 세션에 지시하기</h3><p class="field-help" id="command-availability"></p>
      <form id="session-command-form" class="form-stack" data-id="${esc(id)}"><div class="form-field"><label for="session-command">전달할 지시</label><textarea id="session-command" name="content" rows="4" maxlength="4000" required placeholder="원래 CLI에 이어서 수행할 일을 적어 주세요.">${esc(draft)}</textarea></div>${errorSlot()}<div class="form-actions"><button class="button button-primary" type="submit" id="send-command">지시 보내기</button></div></form>
      <div id="command-receipt" role="status" aria-live="polite"></div>
    </section>`, { type: 'session', id });
  renderSessionCommand();
}

function renderSessionCommand() {
  if (!modal.open || modalContext?.type !== 'session' || !$('#session-command', body)) return;
  const id = modalContext.id;
  const delivery = commandDeliveries.get(id);
  const record = delivery?.record;
  const reason = commandUnavailableReason(state, id, connected);
  $('#command-availability', body).textContent = reason || '지시는 Codex 큐에 전달됩니다. 기존 작업이 끝나면 실행되며, CLI의 원래 권한과 승인 정책을 따릅니다.';
  const input = $('#session-command', body);
  $('#session-command-form', body).hidden = Boolean(record && !record.content);
  input.readOnly = Boolean(record);
  input.disabled = !record && Boolean(reason);
  $('#send-command', body).disabled = Boolean(reason || record || pending);
  $('#send-command', body).hidden = Boolean(record);
  const receipt = $('#command-receipt', body);
  if (!record) { receipt.innerHTML = ''; delete receipt.dataset.signature; return; }
  const presentation = commandPresentation(record);
  const signature = JSON.stringify([record.status, record.error, record.lookupError, delivery.busy, reason]);
  if (receipt.dataset.signature === signature) return;
  receipt.dataset.signature = signature;
  receipt.innerHTML = `<div class="command-status"><strong>${presentation.title}</strong><p>${esc(presentation.description)}</p>${record.restored ? '<p>새로고침 전 지시의 접수 기록입니다. 지시 원문은 브라우저에 저장하지 않습니다.</p>' : ''}${record.lookupError ? `<p class="command-warning">${esc(record.lookupError)}</p>` : ''}${presentation.retry ? `<button type="button" class="button button-small" data-retry-command="${esc(id)}" ${delivery.busy || reason ? 'disabled' : ''}>같은 지시 다시 전송</button>` : ''}${record.status === 'unconfirmed' || record.lookupError ? `<button type="button" class="button button-small" data-check-command="${esc(id)}" ${delivery.busy ? 'disabled' : ''}>접수 상태 다시 확인</button>` : ''}${presentation.final ? `<button type="button" class="button button-small" data-fresh-command="${esc(id)}">새 지시 작성</button>` : ''}</div>`;
}

function onCommandChange() {
  try { saveCommandReceipts(sessionStorage, commandDeliveries); } catch { /* Keep in-memory tracking. */ }
  renderSessionCommand();
}

async function sendSessionCommand(id, content) {
  if (commandDeliveries.has(id)) return;
  const reason = commandUnavailableReason(state, id, connected);
  if (reason) { formError(reason); return; }
  const delivery = new CommandDelivery(apiRequest, {
    id: crypto.randomUUID(), sessionId: id, content,
  }, onCommandChange);
  commandDeliveries.set(id, delivery);
  commandDrafts.set(id, content);
  await delivery.send();
}

function agentSignature(id) {
  return JSON.stringify([state.agents.find((agent) => agent.id === id), state.tasks.filter((task) => task.agentId === id), state.office.paused]);
}

function openEditAgent(id) {
  const agent = state.agents.find((item) => item.id === id);
  if (!agent) return;
  openModal('동료의 역할을 다듬어 주세요', 'TEAMMATE SETTINGS', `<form id="edit-agent-form" class="form-stack" data-id="${esc(id)}"><div class="form-field"><label for="edit-name">직원 이름</label><input id="edit-name" name="name" value="${esc(agent.name)}" maxlength="40" required></div><div class="form-field"><label for="edit-role">담당 역할</label><input id="edit-role" name="role" value="${esc(agent.role)}" maxlength="120" required></div><p class="field-help">이름과 역할은 저장 즉시 반영됩니다. 공급자 변경은 지원하지 않습니다.</p>${errorSlot()}<div class="form-actions"><button type="button" class="button" data-agent="${esc(id)}">돌아가기</button><button type="submit" class="button button-primary" data-mutation>변경 사항 저장</button></div></form>`, { type: 'edit-agent', id });
  $('#edit-name', body).focus();
}

function openNewTask(agentId) {
  const available = state.agents.filter((agent) => !taskUnavailableReason(state, agent));
  if (!available.length) { toast('업무를 맡길 수 있는 체험용 직원이 필요합니다.', true); return; }
  openModal('함께할 일을 알려 주세요', 'LET’S MAKE A START', `<form id="new-task-form" class="form-stack"><div class="form-field"><label for="task-agent">담당 직원</label><select id="task-agent" name="agentId">${available.map((agent) => `<option value="${esc(agent.id)}" ${agent.id === agentId ? 'selected' : ''}>${esc(agent.name)} · ${esc(agent.role)}</option>`).join('')}</select></div><div class="form-field"><label for="task-title">업무 이름</label><input id="task-title" name="title" placeholder="예: 새 프로젝트 아이디어 정리" maxlength="120" required autocomplete="off"></div><div class="form-field"><label for="task-description">업무 설명 <span class="muted">선택</span></label><textarea id="task-description" name="description" rows="4" maxlength="4000" placeholder="목표, 필요한 결과물, 참고할 내용을 알려 주세요."></textarea></div><div class="info-box">${icon('spark')}<span>체험용 실행입니다. 실제 AI가 업무를 수행하지 않으며, 고정된 질문 → 답변 → 결과 승인 흐름으로 진행합니다.</span></div>${errorSlot()}<div class="form-actions"><button type="button" class="button" data-close>취소</button><button class="button button-primary" type="submit" data-mutation>업무 시작하기</button></div></form>`, { type: 'new-task' });
  $('#task-title', body).focus();
}

function taskSignature(task) {
  return JSON.stringify([task, state.office.paused]);
}

function openTask(id, draft = '') {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  const agent = state.agents.find((item) => item.id === task.agentId);
  const provider = state.providers.find((item) => item.id === agent?.provider);
  const actionable = !state.office.paused;
  const messages = (task.messages || []).map((message) => `<div class="message ${['user', 'system'].includes(message.role) ? message.role : 'assistant'}"><small>${message.role === 'user' ? 'Commander' : message.role === 'system' ? '시스템' : `${esc(agent?.name || '직원')}${provider?.kind === 'demo' ? ' · 체험용' : ''}`}</small>${esc(message.content)}</div>`).join('');
  let actions;
  if (task.status === 'waiting_input' && actionable) {
    actions = `<form id="answer-form" class="form-stack" data-id="${esc(id)}">
      <div class="form-field"><label for="task-answer">직원의 질문에 답변해 주세요</label>
        <textarea id="task-answer" name="content" rows="3" maxlength="4000" required placeholder="원하는 방향이나 판단 기준을 적어 주세요.">${esc(draft)}</textarea>
      </div>
      <div class="task-command-row">
        <button type="button" class="button button-danger" data-cancel-task="${esc(id)}" data-mutation>업무 취소</button>
        <button class="button button-primary" type="submit" data-mutation>답변 보내기</button>
      </div>
    </form>`;
  } else if (task.status === 'waiting_approval' && actionable) {
    actions = `<p class="field-help">결과를 검토한 후 승인하면 이 업무가 완료됩니다.</p>
      <div class="task-command-row">
        <button type="button" class="button button-danger" data-cancel-task="${esc(id)}" data-mutation>업무 취소</button>
        <button type="button" class="button button-primary" data-approve-task="${esc(id)}" data-mutation>${icon('check')}결과 승인</button>
      </div>`;
  } else if (isOpenTask(task)) {
    actions = `<div class="info-box">${icon('pause')}
        <span>${state.office.paused || task.status === 'paused' ? '업무가 일시 중지되었습니다. 사무실 업무를 재개하면 이어서 진행할 수 있습니다.' : '업무 상태를 확인하고 있습니다.'}</span>
      </div>
      <div class="task-command-row">
        <button type="button" class="button button-danger" data-cancel-task="${esc(id)}" data-mutation>업무 취소</button>
        ${state.office.paused ? '<button type="button" class="button button-primary" data-resume-office data-mutation>사무실 업무 재개</button>' : ''}
      </div>`;
  } else {
    actions = `<p class="task-completion">${task.status === 'completed' ? 'Commander가 결과를 승인한 업무입니다.' : task.status === 'cancelled' ? '취소된 업무입니다. 완료한 업무에는 포함되지 않습니다.' : '실패한 업무입니다. 완료한 업무에는 포함되지 않습니다.'}</p>`;
  }
  const content = `<div class="task-modal-meta"><span>${esc(agent?.name || '직원')} · ${displayTime(task.createdAt)}</span>${badge(task.status)}</div>
    ${task.description ? `<p class="task-description">${esc(task.description)}</p>` : ''}
    ${provider?.kind === 'demo' ? '<p class="field-help task-description">체험용 업무 · 실제 AI 추론 없이 생성되는 예시 응답입니다.</p>' : ''}
    <div class="message-list">${messages}</div>
    ${task.result ? `<div class="task-result"><h3>${provider?.kind === 'demo' ? '체험용 결과' : '업무 결과'}</h3><p>${esc(typeof task.result === 'string' ? task.result : JSON.stringify(task.result, null, 2))}</p></div>` : ''}
    ${errorSlot()}${actions}`;
  openModal(task.title, 'TASK & CONVERSATION', content, { type: 'task', id, signature: taskSignature(task) });
}

function syncModal() {
  if (!modal.open || !modalContext || pending) return;
  if (modalContext.type === 'task') {
    const task = state.tasks.find((item) => item.id === modalContext.id);
    if (task && taskSignature(task) !== modalContext.signature) {
      const answer = $('#task-answer', body);
      const draft = answer?.value || '';
      const selection = document.activeElement === answer ? [answer.selectionStart, answer.selectionEnd] : null;
      openTask(task.id, draft);
      const updatedAnswer = $('#task-answer', body);
      if (selection && updatedAnswer) {
        updatedAnswer.focus({ preventScroll: true });
        updatedAnswer.setSelectionRange(...selection);
      }
    }
  } else if (modalContext.type === 'agent' && agentSignature(modalContext.id) !== modalContext.signature) {
    openAgent(modalContext.id);
  }
}

function requestCancel(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  openModal('이 업무를 취소할까요?', 'CANCEL TASK', `<p class="task-description">${esc(task.title)}</p><p class="field-help">업무와 대화 기록은 남으며, 완료 상태로 처리되지 않습니다.</p>${errorSlot()}<div class="form-actions"><button type="button" class="button" data-task="${esc(id)}">계속 진행</button><button type="button" class="button button-danger" data-confirm-cancel="${esc(id)}" data-mutation>업무 취소하기</button></div>`, { type: 'cancel-task', id });
}

async function toggleOffice(resumeOnly = false) {
  const resume = resumeOnly || state.office.paused;
  await mutate(`/office/${resume ? 'resume' : 'pause'}`, {}, resume ? '사무실 업무를 재개했습니다.' : '사무실을 중지하고 업무 상태를 저장했습니다.', 'POST', () => {
    syncModal();
  });
}

async function downloadHandoff() {
  if (!connected || pending) return;
  pending = true;
  updateControls();
  try {
    const record = await apiRequest('/handoff');
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `stackqueue-handoff-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('인계 기록을 내려받았습니다. 공유 전 입력 내용을 확인하세요.');
  } catch (error) {
    toast(error.message, true);
    if (error.code === 'CONNECTION_ERROR') setConnection(false);
  } finally {
    pending = false;
    updateControls();
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.hasAttribute('data-close')) { closeModal(); return; }
  if (button.dataset.retryCommand) { void commandDeliveries.get(button.dataset.retryCommand)?.retry(); return; }
  if (button.dataset.checkCommand) { void commandDeliveries.get(button.dataset.checkCommand)?.check(); return; }
  if (button.dataset.freshCommand) {
    const id = button.dataset.freshCommand;
    commandDeliveries.delete(id);
    commandDrafts.delete(id);
    onCommandChange();
    openSession(id);
    $('#session-command', body)?.focus();
    return;
  }
  if (button.dataset.agent) { openAgent(button.dataset.agent); return; }
  if (button.dataset.session) { openSession(button.dataset.session); return; }
  if (button.dataset.task) { openTask(button.dataset.task); return; }
  if (button.dataset.editAgent) { openEditAgent(button.dataset.editAgent); return; }
  if (button.dataset.newTask) { openNewTask(button.dataset.newTask); return; }
  if (button.dataset.cancelTask) { requestCancel(button.dataset.cancelTask); return; }
  if (button.dataset.confirmCancel) {
    const id = button.dataset.confirmCancel;
    void mutate(`/tasks/${encodeURIComponent(id)}/cancel`, {}, '업무를 취소했습니다.', 'POST', () => openTask(id));
    return;
  }
  if (button.dataset.approveTask) {
    const id = button.dataset.approveTask;
    void mutate(`/tasks/${encodeURIComponent(id)}/approve`, {}, '결과를 승인하고 업무를 완료했습니다.', 'POST', () => openTask(id));
    return;
  }
  if (button.hasAttribute('data-resume-office')) void toggleOffice(true);
});

body.addEventListener('change', (event) => {
  if (event.target.id === 'agent-provider') updateProviderFields();
});

body.addEventListener('input', (event) => {
  if (event.target.id === 'session-command' && modalContext?.type === 'session') commandDrafts.set(modalContext.id, event.target.value);
});

body.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  if (pending || !form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  Object.keys(data).forEach((key) => { data[key] = data[key].trim(); });
  if (form.id === 'session-command-form') {
    if (!data.content) { formError('전달할 지시를 입력해 주세요.'); return; }
    void sendSessionCommand(form.dataset.id, data.content);
  } else if (form.id === 'hire-form') {
    if (!data.name || !data.role) { formError('이름과 역할을 입력해 주세요.'); return; }
    if (!data.model) delete data.model;
    if (!data.reasoningEffort) delete data.reasoningEffort;
    void mutate('/agents', data, '새 동료가 사무실에 합류했습니다.', 'POST', (agent) => openAgent(agent.id));
  } else if (form.id === 'edit-agent-form') {
    if (!data.name || !data.role) { formError('이름과 역할을 입력해 주세요.'); return; }
    void mutate(`/agents/${encodeURIComponent(form.dataset.id)}`, data, '직원 정보를 수정했습니다.', 'PATCH', () => openAgent(form.dataset.id));
  } else if (form.id === 'new-task-form') {
    if (!data.title) { formError('업무 이름을 입력해 주세요.'); return; }
    void mutate('/tasks', data, '업무를 시작했습니다. 직원의 질문을 확인해 주세요.', 'POST', (task) => openTask(task.id));
  } else if (form.id === 'answer-form') {
    if (!data.content) { formError('답변 내용을 입력해 주세요.'); return; }
    const id = form.dataset.id;
    void mutate(`/tasks/${encodeURIComponent(id)}/messages`, data, '답변을 전달했습니다. 체험 결과를 확인해 주세요.', 'POST', () => openTask(id));
  }
});

$('#hire-button').addEventListener('click', openHire);
$('#scene-hire-button').addEventListener('click', openHire);
$('#new-task-button').addEventListener('click', () => openNewTask());
$('#all-tasks-button').addEventListener('click', () => { location.hash = 'tasks'; });
$('#close-modal').addEventListener('click', closeModal);
$('#task-filter').addEventListener('change', renderTasks);
$('#retry-button').addEventListener('click', () => { void refresh(true); });
$('#pause-button').addEventListener('click', () => { void toggleOffice(); });
$('#resume-banner-button').addEventListener('click', () => { void toggleOffice(true); });
$('#download-button').addEventListener('click', () => { void downloadHandoff(); });
function updateMotionPreference() {
  if (motionPreference.matches) motionEnabled = false;
  $('#motion-toggle').setAttribute('aria-pressed', String(motionEnabled));
  $('#motion-toggle').textContent = motionEnabled ? '움직임 켜짐' : '움직임 꺼짐';
  $('#motion-toggle').disabled = motionPreference.matches;
  $('#motion-toggle').title = motionPreference.matches ? '시스템의 동작 줄이기 설정을 따릅니다.' : '캐릭터의 장식 움직임을 켜거나 끕니다.';
  renderCharacters();
}
$('#motion-toggle').addEventListener('click', () => {
  motionEnabled = !motionEnabled;
  updateMotionPreference();
});
motionPreference.addEventListener('change', updateMotionPreference);
modal.addEventListener('cancel', (event) => { if (pending) event.preventDefault(); });
modal.addEventListener('click', (event) => {
  if (event.target !== modal || pending) return;
  const bounds = modal.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeModal();
});
modal.addEventListener('close', () => {
  modalContext = null;
  if (modalTrigger?.isConnected) modalTrigger.focus({ preventScroll: true });
  else $('#hire-button').focus({ preventScroll: true });
});
window.addEventListener('hashchange', navigate);
window.addEventListener('online', () => { void refresh(true); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(true); });

fillIcons();
updateMotionPreference();
navigate();
updateControls();
void refresh(true);
setInterval(() => {
  if (document.hidden || pending) return;
  void refresh();
  for (const delivery of commandDeliveries.values()) if (delivery.shouldPoll()) void delivery.check();
}, 2500);
