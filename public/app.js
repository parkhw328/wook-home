import { apiRequest } from './api.mjs';
import { formValues, sameDraft, settleDraft } from './form-drafts.mjs';
import { executionFields, updateExecutionFields, executionSelectionReason, effortLabel, newCommandId } from './execution-controls.mjs';
import { projectSummary, projectField, observedProject, preferenceSummary, commandSelection } from './staff-settings.mjs';
import { connectionLocation, connectionSummary, connectionMarkup } from './staff-connections.mjs';
import { identityMarkup, staffIdentity, lifecycleLabel, sessionAlias } from './session-identity.mjs';
import { initializeIdentityTooltip } from './identity-tooltip.mjs';
import { officeOccupants as observedOccupants } from './office-activity.mjs';
import { OfficeWorkspace } from './workspace.mjs';
import { DialogLayer } from './dialog-layer.mjs';
import { CliConversationDialog } from './cli-dialog.mjs';
import { occupantRoom } from './rooms.mjs';
import {
  CommandDelivery, commandPresentation, commandUnavailableReason,
  loadCommandReceipts, saveCommandReceipts,
} from './commands.mjs';
import {
  escapeHtml as esc, statusLabel, statusClass, isOpenTask, needsAttention,
  officeCounts, officeStatItems, taskUnavailableReason, filterTasks, displayTime, normalizeState, programUrl, providerLinks,
  officeName, observedSessionStatus, sessionStatusLabel, characterMotion, orderedLocalSessions, unassignedLocalSessions,
} from './model.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
initializeIdentityTooltip(document);
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
const formDrafts = new Map();
let lastTaskAgentId = null;
let sceneSignature = '';
let sessionsSignature = '';
let providersSignature = '';
let programsSignature = '';
const commandDeliveries = new Map();
const commandDrafts = new Map();
const executionDrafts = new Map();
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let motionEnabled = !motionPreference.matches;
const modal = $('#modal');
const body = $('#modal-body');
const modalLayer = new DialogLayer(modal, { onClose: () => { saveFormDraft(); modalContext = null; } });
$('#sidebar-programs').open = !window.matchMedia('(max-width: 900px)').matches;
const cliDialog = new CliConversationDialog({ request: apiRequest, getState: () => ({ state, connected }), onCommand: openSession, onAgent: openAgent });
const workspace = new OfficeWorkspace($('#office-workspace'), {
  onSession: (id) => cliDialog.open(id),
  onTaskAction(action, id, content) {
    if (action === 'approve' && workspace.room !== 'executive') return;
    void mutate(`/tasks/${encodeURIComponent(id)}/${action === 'answer' ? 'messages' : 'approve'}`,
      action === 'answer' ? { content } : {}, action === 'answer' ? '답변을 전달했습니다. 대표이사실에서 결과 보고를 확인하세요.' : '보고를 확인하고 결과를 승인했습니다.', 'POST', () => openTask(id));
  },
});
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
  renderStatDetails();
  syncModal();
  cliDialog.update();
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
  if ($('#modal-pending', body)) $('#modal-pending', body).hidden = !pending;
  $$('[data-office-stat]').forEach((button) => { button.disabled = !loaded; });
  ['#hire-button', '#scene-hire-button', '#resume-banner-button', '#pause-button', '#download-button'].forEach((selector) => {
    $(selector).disabled = unavailable;
  });
  $('#new-task-button').disabled = unavailable || state.office.paused || !state.agents.some((agent) => !taskUnavailableReason(state, agent));
  $('#new-task-button').title = !state.agents.some((agent) => !taskUnavailableReason(state, agent)) ? '업무를 맡길 수 있는 체험용 직원이 필요합니다.' : '';
  $$('[data-mutation]', body).forEach((button) => {
    button.disabled = unavailable || button.dataset.blocked === 'true';
  });
  renderSessionCommand();
  renderStaffSettings();
  workspace.update(state, connected, motionEnabled, pending);
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
  $('#app-version').textContent = state.office.version ? `v${state.office.version}` : '개발 중';
  const name = officeName(state.office);
  $$('[data-office-name]').forEach((node) => { node.textContent = name; node.title = name; });
  $('#brand-link').setAttribute('aria-label', `${name} 사무실`);
  document.title = `${name} · ${VIEW_COPY[currentView][0]}`;
  $('meta[name="description"]').content = `${name} · AI 직원과 로컬 CLI의 작업 상태를 확인하는 사무실`;
}

function officeOccupants() {
  return observedOccupants(state, connected);
}

function renderCharacters() {
  const occupants = officeOccupants();
  const used = {};
  const displayed = occupants.filter((occupant) => {
    const room = occupantRoom(occupant);
    used[room] = (used[room] || 0) + 1;
    return used[room] <= (room === 'office' ? 8 : ['meeting', 'executive'].includes(room) ? 4 : 2);
  }).slice(0, 16);
  const signature = JSON.stringify([displayed.map(({ id, source, status, name, sessionStatus, sceneActivity, workArchive, connection }) => ({ id, source, status, name, sessionStatus, sceneActivity, workArchive, sessionId: connection?.sessionId, entryId: connection?.entryId })), connected, state.office.paused]);
  $('#office-scene').classList.toggle('motion-disabled', !motionEnabled);
  $('#scene-empty').hidden = occupants.length > 0;
  $('#office-meta').textContent = `${state.localSessions?.sessions?.length || 0} CLI · ${state.agents.length} 직원${occupants.length > displayed.length ? ` · 화면 ${displayed.length}명 표시` : ''}`;
  if (signature === sceneSignature) return;
  sceneSignature = signature;
  const previous = document.activeElement?.closest('#desk-grid') ? document.activeElement : null;
  const previousSource = previous?.dataset.session ? 'session' : previous?.dataset.agent ? 'agent' : null;
  const previousId = previousSource ? previous.dataset[previousSource] : null;
  $('#desk-grid').innerHTML = displayed.map((occupant) => {
    const isSession = occupant.source === 'session';
    const label = occupant.sceneActivity?.label || (isSession || occupant.sessionStatus ? sessionStatusLabel(occupant.sessionStatus || occupant.status) : statusLabel(occupant.status));
    const compactName = isSession ? occupant.name.replace(/^Codex\s*·\s*/, '') : occupant.name;
    return `<button type="button" class="office-person ${statusClass(occupant.status)}" data-person-id="${esc(occupant.id)}" data-${occupant.source}="${esc(occupant.id)}" data-activity="${esc(occupant.sceneActivity?.kind || '')}" aria-label="${esc(occupant.name)} · ${esc(occupant.connection?.sessionId || occupant.connection?.entryId || '')} · ${label} 상세 보기"><i aria-hidden="true"></i>${esc(compactName)}${staffIdentity(occupant, true)}${occupant.sceneActivity ? `<span class="person-activity" aria-hidden="true">${occupant.sceneActivity.kind === 'collaborating' ? '협업' : '발표'}</span>` : ''}</button>`;
  }).join('');
  workspace.scene.syncPeople(displayed);
  if (previousId) $$(`[data-${previousSource}]`, $('#desk-grid')).find((node) => node.dataset[previousSource] === previousId)?.focus({ preventScroll: true });
}

function renderAgents() {
  renderCharacters();
  const list = $('#agent-list');
  const markup = state.agents.length ? state.agents.map((agent) => `<div class="staff-card-group"><button type="button" class="agent-card" data-agent="${esc(agent.id)}">${avatar(agent)}<span class="agent-info"><strong>${esc(agent.name)}</strong>${staffIdentity(agent, true)}<small>${esc(agent.role)}</small><small class="staff-project">${esc(projectSummary(agent, state.localSessions))}</small>${agent.executionPreference ? `<small>${esc(preferenceSummary(agent))}</small>` : ''}</span>${badge(agent.status)}</button><button type="button" class="button button-small" data-edit-agent="${esc(agent.id)}" aria-label="${esc(agent.name)} 별칭과 직원 설정">별칭 · 직원 설정</button></div>`).join('')
    : emptyState('첫 동료를 기다리고 있어요', '감지한 CLI·웹을 연결하거나 체험 직원을 채용해 보세요.', 'people');
  if (list.dataset.signature !== markup) { list.innerHTML = markup; list.dataset.signature = markup; }
  const signature = JSON.stringify(state.providers);
  if (signature === providersSignature) return;
  providersSignature = signature;
  const symbols = { openai: '◎', claude: '✳', gemini: '✧', meta: '∞' };
  $('#provider-list').innerHTML = state.providers.filter((provider) => provider.kind === 'external').map((provider) => {
    const links = providerLinks(provider);
    return `<div class="provider-item"><div class="provider-heading"><span class="provider-symbol" aria-hidden="true">${symbols[provider.id] || '◇'}</span><strong>${esc(provider.name)}</strong></div><small>${provider.available ? '사무실 연결 가능' : '새 AI 실행 준비 중'}</small>${links.webUrl || links.guideUrl ? `<div class="provider-actions">${links.webUrl ? `<a class="button button-small" href="${links.webUrl}" target="_blank" rel="noopener noreferrer" aria-label="${esc(links.label)} 공식 서비스 (새 탭)">${esc(links.label)} 열기 <span aria-hidden="true">↗</span></a>` : ''}${links.guideUrl ? `<a class="inline-link" href="${links.guideUrl}" target="_blank" rel="noopener noreferrer" aria-label="${esc(provider.name)} 연결 안내 (새 탭)">연결 안내 ↗</a>` : ''}</div>` : ''}</div>`;
  }).join('');
}

function renderSessions() {
  const local = state.localSessions;
  const observing = connected && local?.status === 'connected';
  const label = !connected ? '서버 연결 끊김' : local?.status === 'connected' ? '관찰 연결됨' : local?.status === 'disconnected' ? '관찰 연결 끊김' : '관찰 연결 대기';
  $('#sessions-connection').textContent = label;
  $('#sessions-scope').textContent = local?.workspace
    ? `작업 폴더: ${local.workspace} · ${observing ? '약 5초마다 갱신' : '갱신 연결 대기'}`
    : '관찰 연결 후 작업 폴더가 표시됩니다.';
  const sessions = unassignedLocalSessions(state);
  const signature = JSON.stringify([label, local?.control?.enabled, sessions.map(({ id, name, status, lifecycle }) => ({ id, name, status, lifecycle }))]);
  const focused = document.activeElement?.closest('#session-list') ? { session: document.activeElement.dataset.session, entry: document.activeElement.dataset.connectEntry } : null;
  if (signature !== sessionsSignature) {
    sessionsSignature = signature;
    $('#session-list').innerHTML = sessions.length ? sessions.map((session) => {
    const status = observedSessionStatus(local, session, connected);
    return `<article class="unregistered-session"><button type="button" class="session-card" aria-haspopup="dialog" data-session="${esc(session.id)}"><span class="session-symbol" aria-hidden="true">&gt;_</span><span class="session-info"><strong>미등록 Codex</strong>${identityMarkup(session.id, 'session-id', true)}<small>${esc(lifecycleLabel(session, observing))}</small></span><span class="status ${statusClass(status)}">${sessionStatusLabel(status)}</span></button><button type="button" class="button button-primary" data-connect-entry="cli:${esc(session.id)}" ${!observing ? 'disabled' : ''}>직원 등록 · 별칭 지정</button></article>`;
    }).join('') : observing
      ? emptyState('등록을 기다리는 세션이 없습니다', '생존이 확인된 현재 프로젝트 세션은 직원 목록에 자동 등록됩니다.', 'activity')
      : emptyState('로컬 CLI의 상태를 연결하세요', '선택한 작업 공간의 Codex 세션을 연결하세요. 왼쪽 연결 설정에서 공개 대화 읽기를 켜고 저장하세요.', 'activity');
    if (focused?.session) $$('[data-session]', $('#session-list')).find((node) => node.dataset.session === focused.session)?.focus({ preventScroll: true });
    if (focused?.entry) $$('[data-connect-entry]', $('#session-list')).find((node) => node.dataset.connectEntry === focused.entry)?.focus({ preventScroll: true });
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
    const agent = [...state.agents, ...(state.releasedAgents || [])].find((item) => item.id === task.agentId);
    return `<button type="button" class="inbox-item" data-task="${esc(task.id)}"><div>${badge(task.status)}<small>${esc(agent?.name || '직원')}</small></div><strong>${esc(task.title)}</strong><small>${task.status === 'waiting_input' ? '질문을 확인하고 답변해 주세요' : '체험 결과를 확인하고 승인해 주세요'} <span aria-hidden="true">→</span></small></button>`;
  }).join('') : `<div class="inbox-empty"><span class="empty-icon">${icon('check')}</span><strong>지금은 여유로운 데스크</strong><p>${state.office.paused ? '업무를 재개하면 대기 중인 내용을 확인할 수 있어요.' : '응답이 필요하면 이곳에 모아 드릴게요.'}</p></div>`;
  $('#event-list').innerHTML = state.events.length ? state.events.slice(0, 5).map((event) => `<div class="event-item">${esc(event.message)}<time datetime="${esc(event.createdAt)}">${displayTime(event.createdAt)}</time></div>`).join('') : '<p class="event-empty">아직 조용한 사무실이에요.<br>동료를 맞이하면 소식이 쌓이기 시작합니다.</p>';
}

function taskRow(task) {
  const agent = [...state.agents, ...(state.releasedAgents || [])].find((item) => item.id === task.agentId);
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
  $('#pause-button').classList.toggle('button-primary', state.office.paused);
  $('#pause-button').classList.toggle('button-caution', !state.office.paused);
}

function renderPrograms() {
  const programs = state.programs.filter((program) => programUrl(program));
  const signature = JSON.stringify(programs);
  if (signature === programsSignature) return;
  programsSignature = signature;
  const summaries = { wShell: 'SSH 접속 · 파일 전송', wPost: 'API 요청 · 응답 확인', wText: '문서 편집 · 차이 비교', 'StackQueue Blog': '네이버 블로그' };
  const icons = { wShell: '/program-icons/wshell.png', wPost: '/program-icons/wpost.png', wText: '/program-icons/wtext.png' };
  $('#program-list').innerHTML = programs.map((program) => {
    const isBlog = program.name === 'StackQueue Blog';
    const icon = icons[program.name];
    const artwork = icon ? `<img src="${icon}" alt="" width="56" height="56" loading="lazy" decoding="async">` : 'SQ';
    return `<a class="program-card ${isBlog ? 'blog-card' : ''}" href="${programUrl(program)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(program.name)} ${isBlog ? '네이버 블로그' : 'GitHub 저장소'} (새 탭)"><span class="program-icon${icon ? ' program-icon--app' : ''}" aria-hidden="true">${artwork}</span><div class="program-copy"><h3>${esc(program.name)}</h3><span class="program-summary">${summaries[program.name]}</span></div></a>`;
  }).join('');
}

function render() {
  const focus = document.activeElement;
  const focusToken = ['agent', 'task', 'session'].map((kind) => focus?.dataset[kind] ? { kind, id: focus.dataset[kind] } : null).find(Boolean);
  const focusContainer = focus?.closest('#desk-grid, #agent-list, #session-list, #inbox-list, #task-list')?.id;
  const settingsFocus = focusContainer && focus?.dataset.editAgent;
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
  if (settingsFocus) $$('[data-edit-agent]', $(`#${focusContainer}`)).find((node) => node.dataset.editAgent === settingsFocus)?.focus({ preventScroll: true });
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
  search: ['자료 검색', 'FIND YOUR NEXT STEP', '지난 대화의 자료를, 한곳에서.', 'CLI와 웹 채팅에 남긴 작업 내용과 답변을 찾아 이어가세요.'],
  office: ['나의 사무실', 'YOUR TEAM. YOUR PLACE.', '문을 열면, 함께하는 일이 시작됩니다.', '복도를 지나 동료를 만나고, 대화를 나누고, 업무를 보고받으세요.'],
  tasks: ['업무 보드', 'ONE TASK AT A TIME', '작은 일부터, 하나씩.', '질문에 답하고 결과를 확인하며 함께 일을 완성해 보세요.'],
  handoff: ['작업 인계', 'PICK UP WHERE YOU LEFT OFF', '오늘의 일을, 다음으로.', '잠시 멈추더라도 일의 흐름은 이어질 수 있도록.'],
};

function navigate() {
  const view = location.hash.slice(1);
  currentView = Object.hasOwn(VIEW_COPY, view) ? view : 'office';
  const [label, eyebrow, title, description] = VIEW_COPY[currentView];
  $('#page-eyebrow').textContent = eyebrow;
  $('#page-title').textContent = title;
  $('#page-description').textContent = description;
  document.title = `${officeName(state.office)} · ${label}`;
  $$('.view').forEach((node) => { node.hidden = node.id !== `view-${currentView}`; });
  $$('.nav-link').forEach((node) => {
    const active = view === 'connection-settings' ? node.hasAttribute('data-open-connection-settings') : node.dataset.view === currentView;
    node.classList.toggle('active', active);
    if (active) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
}

function openModal(title, eyebrow, content, context) {
  saveFormDraft();
  modalContext = context;
  $('#modal-title').textContent = title;
  $('#modal-eyebrow').textContent = eyebrow;
  modal.setAttribute('aria-labelledby', 'modal-title');
  body.innerHTML = content;
  const notice = document.createElement('p');
  notice.className = 'dialog-layer-busy'; notice.id = 'modal-pending'; notice.hidden = !pending; notice.setAttribute('role', 'status');
  notice.textContent = '처리 중입니다. 창을 닫아도 이미 요청한 작업은 계속되며 결과를 알림으로 알려드립니다.';
  body.prepend(notice);
  restoreFormDraft();
  fillIcons(body);
  modalLayer.open();
  $('#modal-title').tabIndex = -1;
  $('#modal-title').focus({ preventScroll: true });
  body.scrollTop = 0;
  updateControls();
}

function closeModal() { modalLayer.close(); }

function draftKey(form) { return `${form.id}:${form.dataset.id || ''}`; }
function saveFormDraft() {
  const form = body.querySelector('#hire-form, #edit-agent-form, #new-task-form, #archive-form');
  if (form && !form.dataset.saved) formDrafts.set(draftKey(form), formValues(form));
}
function restoreFormDraft() {
  const form = body.querySelector('#hire-form, #edit-agent-form, #new-task-form, #archive-form');
  const values = form && formDrafts.get(draftKey(form));
  if (!values) return;
  for (const [name, value] of Object.entries(values)) {
    if (form.id === 'new-task-form' && name === 'agentId') continue;
    if (form.elements[name]) form.elements[name].value = value;
  }
  if (form.id === 'hire-form') {
    updateProviderFields();
    for (const name of ['model', 'reasoningEffort']) if (values[name]) form.elements[name].value = values[name];
  }
}

function formError(message) {
  const node = $('#form-error', body);
  if (node && modal.open) {
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
  const originRevision = modalLayer.revision;
  const originForm = modal.open ? body.querySelector('form') : null;
  const submittedDraft = originForm ? formValues(originForm) : null;
  const originView = location.hash;
  const originWorkspaceRevision = workspace.detailRevision;
  // Every CLI entry and dismissal supersedes a pending follow-up navigation.
  const originCliRevision = cliDialog.layer.revision;
  pending = true;
  updateControls();
  if ($('#form-error', body)) $('#form-error', body).hidden = true;
  let result;
  try {
    result = await apiRequest(path, { method, body: payload });
  } catch (error) {
    if (error.code === 'CONNECTION_ERROR') setConnection(false);
    if (modalLayer.revision === originRevision) formError(error.message);
    else toast(error.message, true);
    pending = false;
    updateControls();
    await refresh();
    return;
  }
  // Keep the confirmed write visible even if the subsequent state read fails.
  const collection = path.startsWith('/agents') ? 'agents' : path.startsWith('/tasks') ? 'tasks' : null;
  if (result?.released) {
    state.agents = state.agents.filter((agent) => agent.id !== result.id);
  } else if (collection && result?.id) {
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
  let keepEditing = false;
  let newerDraft = false;
  if (originForm && ['hire-form', 'edit-agent-form', 'new-task-form', 'archive-form'].includes(originForm.id)) {
    const currentForm = body.querySelector('form');
    const sameForm = currentForm && draftKey(currentForm) === draftKey(originForm);
    keepEditing = sameForm && !sameDraft(formValues(currentForm), submittedDraft);
    const retainedDraft = formDrafts.get(draftKey(originForm));
    newerDraft = keepEditing || Boolean(retainedDraft && !sameDraft(retainedDraft, submittedDraft));
    if (sameDraft(formValues(originForm), submittedDraft)) originForm.dataset.saved = 'true';
    settleDraft(formDrafts, draftKey(originForm), submittedDraft, result?.settingsRevision);
    if (sameForm && Number.isSafeInteger(result?.settingsRevision) && currentForm.elements.settingsRevision
      && currentForm.elements.settingsRevision.value === submittedDraft.settingsRevision) {
      currentForm.elements.settingsRevision.value = String(result.settingsRevision);
    }
    if (keepEditing) saveFormDraft();
    renderStaffSettings();
  }
  if (after && !keepEditing && modalLayer.revision === originRevision && cliDialog.layer.revision === originCliRevision && location.hash === originView && workspace.detailRevision === originWorkspaceRevision) after(result);
  toast(`${successMessage}${newerDraft ? ' 이후에 작성한 초안은 아직 저장되지 않았습니다.' : ''}`);
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
  openModal('새로운 동료를 맞이하세요', 'GROW YOUR LITTLE TEAM', `<p class="staff-hire-choice"><button type="button" class="button button-secondary" data-open-staff-connection>감지한 CLI·웹으로 등록</button><span class="field-help">아래 양식은 체험 또는 연결 없는 직원 정보 등록입니다.</span></p><form id="hire-form" class="form-stack"><div class="field-row"><div class="form-field"><label for="agent-name">직원 이름</label><input id="agent-name" name="name" placeholder="예: 모아" maxlength="40" required autocomplete="off"></div><div class="form-field"><label for="agent-role">담당 역할</label><input id="agent-role" name="role" placeholder="예: 아이디어 정리" maxlength="120" required autocomplete="off"></div></div><div class="form-field"><label for="agent-provider">AI 공급자</label><select id="agent-provider" name="provider">${providerOptions()}</select><p class="field-help" id="provider-help"></p></div><div class="field-row"><div class="form-field"><label for="agent-model">모델</label><select id="agent-model" name="model"></select></div><div class="form-field"><label for="agent-effort">추론 강도</label><select id="agent-effort" name="reasoningEffort"></select></div></div>${projectField({}, state.agents, state.localSessions, 'hire')}<div class="info-box">${icon('spark')}<span>직원의 이름과 역할은 나중에 바꿀 수 있어요. 연결 가능한 공급자의 실제 지원 옵션만 표시합니다.</span></div>${errorSlot()}<div class="form-actions"><button type="button" class="button" data-close>취소</button><button class="button button-primary" type="submit" data-mutation>직원 채용하기</button></div></form>`, { type: 'hire' });
  if (!formDrafts.has('hire-form:')) updateProviderFields();
  $('#agent-name', body).focus();
}

function commandPanel(id, title = '모델 설정과 작업 지시') {
  const draft = commandDeliveries.get(id)?.record.content ?? commandDrafts.get(id) ?? '';
  return `<section class="command-section" aria-labelledby="command-heading"><h3 id="command-heading">${esc(title)}</h3><p class="field-help">창을 닫아도 작성 중인 지시는 유지됩니다. 이미 보낸 지시는 계속 처리됩니다.</p><p class="field-help" id="command-availability"></p><div class="detail-actions"><a class="button button-small" href="#connection-settings" data-open-connection-settings data-close>연결 설정 열기</a><button type="button" class="button button-primary" data-resume-office id="command-resume" hidden>사무실 업무 재개</button></div>
    <form id="session-command-form" class="form-stack" data-id="${esc(id)}">${executionFields()}<div class="form-field"><label for="session-command">전달할 지시</label><textarea id="session-command" name="content" rows="5" maxlength="4000" required placeholder="이 직원에게 맡길 작업과 원하는 결과를 적어 주세요.">${esc(draft)}</textarea></div>${errorSlot()}<div class="form-actions"><button class="button button-primary" type="submit" id="send-command">지시 보내기</button></div></form><div id="command-receipt" role="status" aria-live="polite"></div></section>`;
}

function openReleasedAgents() {
  openModal('직원 등록 해제 기록', '업무 · 보관 메모 유지', `<p class="field-help">명단에서 해제한 직원입니다. 기존 업무와 메모는 유지되며 다시 등록해도 CLI·웹 연결은 직접 선택해야 합니다.</p>${(state.releasedAgents || []).map((agent) => `<section class="room-news"><h3>${esc(agent.name)}</h3><p>${esc(agent.role)} · ${displayTime(agent.releasedAt)}</p><p>${esc(agent.workArchive?.note || '보관 메모 없음')}</p>${state.tasks.filter((task) => task.agentId === agent.id).map(taskRow).join('')}<button type="button" class="button button-primary" data-restore-agent="${esc(agent.id)}" data-revision="${agent.settingsRevision}" data-mutation>직원으로 다시 등록</button></section>`).join('') || '<p>해제한 직원이 없습니다.</p>'}`, { type: 'released-agents' });
}

function requestReleaseAgent(id) {
  const agent = state.agents.find((item) => item.id === id);
  if (!agent) return;
  const active = state.tasks.filter((task) => task.agentId === id && !['completed', 'cancelled', 'failed'].includes(task.status));
  openModal(`${agent.name} · 직원 등록 해제`, '직원 명단 관리', `${staffIdentity(agent)}<p>직원 명단과 캐릭터에서 제외하고 관찰 연결을 해제합니다. 기존 업무와 보관 메모는 <strong>직원 등록 해제 기록</strong>에 남습니다.</p><p class="field-help">실제 CLI·웹 탭을 종료하거나 이미 보낸 지시를 취소하지 않습니다. 계속 감지되는 CLI는 미등록 세션으로 표시될 수 있습니다.</p>${active.length ? '<p class="form-error">진행 중인 체험 업무를 먼저 완료하거나 취소해 주세요.</p>' + active.map(taskRow).join('') : ''}${errorSlot()}<div class="form-actions"><button type="button" class="button" data-close>돌아가기</button><button type="button" class="button button-caution" data-confirm-release="${esc(id)}" data-revision="${agent.settingsRevision}" data-mutation data-blocked="${Boolean(active.length)}">직원 등록 해제</button></div>`, { type: 'release-agent', id });
}

function openWorkConnections() {
  openModal('업무와 연결 선택', '대화 · 지시 · 보관', `<p class="field-help">공개 대화와 후속 지시는 CLI 대화를 선택하세요. 직원 상세에서 보관·복귀·재연결할 수 있습니다. CLI의 질문 답변·실행 승인은 원래 CLI에서 처리합니다.</p>${state.agents.map((agent) => `<button type="button" class="room-entry" data-stat-agent="${esc(agent.id)}"><strong>${esc(agent.name)}</strong>${staffIdentity(agent, true)}<span>${agent.workArchive?.stored ? '창고 보관' : esc(connectionSummary(agent, state.providers.find((p) => p.id === agent.provider), connected))}</span></button>`).join('')}${orderedLocalSessions(state.localSessions).map((session) => `<div class="room-news"><strong>${esc(sessionAlias(state, session))}</strong>${identityMarkup(session.id)}<div class="detail-actions"><button type="button" class="button" data-session="${esc(session.id)}">대화 보기</button><button type="button" class="button" data-session-command="${esc(session.id)}">지시 · 접수 확인</button><button type="button" class="button" data-archive-session="${esc(session.id)}">업무 보관</button></div></div>`).join('') || '<p>관찰 중인 CLI 대화가 없습니다. 연결 설정 또는 이전 대화 검색을 확인해 주세요.</p>'}<div class="detail-actions"><button type="button" class="button" data-released-agents>직원 등록 해제 기록</button><button type="button" class="button" data-open-staff-connection>직원 다시 연결</button><a class="button" href="#connection-settings" data-open-connection-settings>연결 설정</a><a class="button" href="#search">이전 대화 검색</a></div>`, { type: 'work-connections' });
}

function openArchive(id, session = false) {
  const owner = session && state.agents.find((agent) => agent.connection?.sessionId === id);
  if (owner) return openArchive(owner.id);
  const item = session ? state.localSessions?.sessions?.find((item) => item.id === id) : state.agents.find((item) => item.id === id);
  if (!item || item.provider === 'demo') return;
  openModal(`${session ? sessionAlias(state, item) : item.name} · 업무 보관`, '창고 · 다음 행동', `${session ? identityMarkup(item.id) : staffIdentity(item)}<p class="field-help">${session ? '이 CLI 기록을 직원 업무로 등록해 보관합니다. ' : ''}보관 메모는 이 PC에만 저장하며 인계 내보내기에 포함하지 않습니다. 실제 CLI를 종료하거나 복원하지 않으며 복귀·재연결 후에도 지시는 직접 작성해야 합니다.</p><form id="archive-form" class="form-stack" data-id="${esc(id)}" data-session="${session}"><input type="hidden" name="settingsRevision" value="${item.settingsRevision || 0}"><label for="archive-note">완료한 일 · 남은 일 · 다음 행동</label><textarea id="archive-note" name="note" rows="6" maxlength="4000" placeholder="다음 세션에서 이어갈 업무를 적어 주세요.">${esc(item.workArchive?.note || '')}</textarea>${errorSlot()}${!session ? `<button type="button" class="button" data-refresh-archive="${esc(id)}">충돌 시 최신 버전 확인 · 메모 유지</button>` : ''}<div class="form-actions"><button type="button" class="button" data-close>닫기</button>${item.workArchive?.stored ? '<button type="submit" class="button" value="restore" data-mutation>메모 저장 · 사무실로 복귀</button>' : ''}<button type="submit" class="button button-primary" value="store" data-mutation>창고에 보관 · 메모 저장</button></div></form>`, { type: 'archive', id });
}

function openAgent(id) {
  const agent = state.agents.find((item) => item.id === id);
  if (!agent) return;
  const provider = state.providers.find((item) => item.id === agent.provider);
  const demo = provider?.kind === 'demo';
  const sessionId = agent.connection?.sessionId;
  const session = state.localSessions?.sessions?.find((item) => item.id === sessionId);
  const reason = taskUnavailableReason(state, agent);
  const tasks = filterTasks(state.tasks.filter((task) => task.agentId === id), 'all');
  const execution = demo ? `<p class="field-help">체험용 직원에게 업무를 맡겨 질문과 승인 흐름을 확인하세요.</p><button type="button" class="button button-primary" data-new-task="${esc(id)}" data-mutation data-blocked="${Boolean(reason)}" ${reason ? 'disabled' : ''}>업무 지시</button>${reason ? `<p class="field-help">${esc(reason)}</p>` : ''}`
    : sessionId ? commandPanel(sessionId)
      : `<section class="command-section"><h3>모델 설정과 작업 지시</h3><p class="field-help">${agent.provider === 'openai' ? '지시를 받을 Codex 대화를 연결하면 추론 모델·강도 선택과 작업 지시를 여기서 사용할 수 있습니다. 프로세스나 웹 탭 감지만으로는 지시할 대화를 정할 수 없습니다.' : '현재 이 연결은 관찰 전용입니다. 모델·추론 강도 선택과 지시 전송은 원래 CLI 또는 웹 서비스에서 진행해 주세요. 사무실의 직접 지시는 Codex 대화 연결에서 지원합니다.'}</p>${agent.provider === 'openai' ? `<button type="button" class="button button-primary" data-connect-command-agent="${esc(id)}">지시할 Codex 대화 연결</button>` : ''}</section>`;
  openModal(agent.name, 'MEET YOUR TEAMMATE', `<div class="detail-heading">${avatar(agent)}<div><h3>${esc(agent.role)}</h3><p>${esc(provider?.name || agent.provider)}${demo ? ' · 체험용 직원' : ''}</p></div>${badge(agent.status)}</div><dl class="detail-facts"><div><dt>담당 프로젝트</dt><dd>${esc(agent.projectName || '미배정')}</dd></div><div><dt>CLI 작업 프로젝트</dt><dd>${esc(observedProject(agent, state.localSessions) || '확인된 CLI 대화 없음')}${agent.connection?.status === 'disconnected' ? ' · 마지막 관찰' : ''}</dd></div>${!demo ? `<div><dt>저장한 기본 추론 설정</dt><dd>${esc(preferenceSummary(agent))}</dd></div>` : ''}<div><dt>실행 위치</dt><dd>${esc(connectionLocation(agent))}</dd></div><div><dt>연결 상태</dt><dd>${esc(connectionSummary(agent, provider, connected))}</dd></div><div><dt>${demo ? '모델' : '최근 실행 모델'}</dt><dd id="agent-observed-model">${esc(session?.model || agent.model || '최근 실행 기록 없음')}</dd></div><div><dt>최근 추론 강도</dt><dd id="agent-observed-effort">${esc(session?.reasoningEffort ? effortLabel(session.reasoningEffort) : agent.reasoningEffort === 'none' ? '해당 없음' : '최근 실행 기록 없음')}</dd></div></dl>${connectionMarkup(agent, provider, connected)}${!demo ? `<p class="field-help">${agent.workArchive?.stored ? '창고 보관 중 · 복귀 후 새 지시를 작성하세요.' : '업무를 보관하면 창고에서 다시 찾을 수 있습니다.'}</p><button type="button" class="button" data-archive-agent="${esc(id)}">보관 · 복귀 · 메모</button>` : ''}<div class="detail-actions"><button type="button" class="button button-caution" data-release-agent="${esc(id)}" data-mutation>직원 등록 해제</button><button type="button" class="button" data-edit-agent="${esc(id)}" data-mutation>별칭 · 직원 설정</button></div>${execution}${demo ? `<h3 class="detail-section-title">이 직원의 업무</h3>${tasks.length ? tasks.slice(0, 8).map(taskRow).join('') : emptyState('아직 맡은 업무가 없어요', '업무를 지시하면 진행 내용을 이곳에서 확인할 수 있습니다.')}` : ''}`, { type: 'agent', id, signature: agentSignature(id) });
  renderSessionCommand();
}

function openSession(id) {
  const session = state.localSessions?.sessions?.find((item) => item.id === id);
  if (!session) return;
  const status = observedSessionStatus(state.localSessions, session, connected);
  openModal(sessionAlias(state, session), 'LOCAL CLI · SESSION', `<div class="info-box">${icon('activity')}<span>연결 설정에서 지시 전송을 켜면 기존 Codex 세션에 지시할 수 있습니다. 세션을 클릭하면 대화기록 모달에서 공개 응답을 확인할 수 있습니다. 승인·중단은 원래 CLI에서 처리하세요.</span></div><button type="button" class="button button-small" data-session="${esc(id)}">대화기록 보기 ↗</button>
    ${identityMarkup(session.id)}<dl class="detail-facts session-facts"><div><dt>관찰된 상태</dt><dd id="observed-status">${sessionStatusLabel(status)}</dd></div><div><dt>마지막 활동</dt><dd id="observed-last-event">${displayTime(session.lastActivityAt)}</dd></div><div><dt>연결 상태</dt><dd id="observed-connection">${state.localSessions.status === 'connected' && connected ? '관찰 연결됨' : '관찰 연결 끊김'}</dd></div><div><dt>작업 공간</dt><dd>${esc(state.localSessions.workspace || '현재 작업 공간')}</dd></div></dl>
    <p class="field-help">사무실 중지는 외부 CLI를 멈추지 않습니다. <a class="inline-link" href="https://github.com/parkhw328/wook-home/wiki/CLI" target="_blank" rel="noopener noreferrer">상태·연결 도움말 ↗</a></p>
    ${commandPanel(id)}`, { type: 'session', id });
  renderSessionCommand();
}

function renderSessionCommand() {
  if (!modal.open || !$('#session-command-form', body)) return;
  const id = $('#session-command-form', body).dataset.id;
  const delivery = commandDeliveries.get(id);
  const record = delivery?.record;
  const session = state.localSessions?.sessions?.find((item) => item.id === id);
  if ($('#agent-observed-model', body)) $('#agent-observed-model', body).textContent = session?.model || '최근 실행 기록 없음';
  if ($('#agent-observed-effort', body)) $('#agent-observed-effort', body).textContent = session?.reasoningEffort ? effortLabel(session.reasoningEffort) : '최근 실행 기록 없음';
  const selection = record || commandSelection(state, id, executionDrafts);
  const reason = commandUnavailableReason(state, id, connected) || executionSelectionReason(state.localSessions?.execution, selection);
  updateExecutionFields(body, state.localSessions?.execution, selection, Boolean(record));
  $('#command-resume', body).hidden = !state.office.paused;
  $('#command-resume', body).disabled = !connected || pending;
  $('#command-availability', body).textContent = reason || '지시는 Codex 큐에 전달됩니다. 기존 작업이 끝나면 실행되며, CLI의 원래 권한과 승인 정책을 따릅니다.';
  const input = $('#session-command', body);
  $('#session-command-form', body).hidden = Boolean(record && !record.content);
  input.readOnly = Boolean(record);
  input.disabled = false;
  $('#send-command', body).disabled = Boolean(reason || record || pending);
  $('#send-command', body).hidden = Boolean(record);
  const receipt = $('#command-receipt', body);
  if (!record) { receipt.innerHTML = ''; delete receipt.dataset.signature; return; }
  const presentation = commandPresentation(record);
  const signature = JSON.stringify([record.status, record.error, record.lookupError, record.model, record.reasoningEffort, record.settingsApplied, delivery.busy, reason]);
  if (receipt.dataset.signature === signature) return;
  receipt.dataset.signature = signature;
  receipt.innerHTML = `<div class="command-status"><strong>${presentation.title}</strong><p>${esc(presentation.description)}</p>${record.model ? `<p>선택 모델: ${esc(record.model)} · ${esc(effortLabel(record.reasoningEffort))}<br>${record.settingsApplied ? '다음 실행의 기본 설정 적용을 확인했습니다.' : '설정 적용은 아직 확인되지 않았습니다.'}</p>` : ''}${record.restored ? '<p>새로고침 전 지시의 접수 기록입니다. 지시 원문은 브라우저에 저장하지 않습니다.</p>' : ''}${record.lookupError ? `<p class="command-warning">${esc(record.lookupError)}</p>` : ''}${presentation.retry ? `<button type="button" class="button button-small" data-retry-command="${esc(id)}" ${delivery.busy || reason ? 'disabled' : ''}>같은 지시 다시 전송</button>` : ''}${record.status === 'unconfirmed' || record.lookupError ? `<button type="button" class="button button-small" data-check-command="${esc(id)}" ${delivery.busy ? 'disabled' : ''}>접수 상태 다시 확인</button>` : ''}${presentation.final ? `<button type="button" class="button button-small" data-fresh-command="${esc(id)}">새 지시 작성</button>` : ''}</div>`;
}

function onCommandChange() {
  try { saveCommandReceipts(sessionStorage, commandDeliveries); } catch { /* Keep in-memory tracking. */ }
  renderSessionCommand();
}

async function sendSessionCommand(id, content) {
  if (commandDeliveries.has(id)) return;
  const selection = commandSelection(state, id, executionDrafts);
  const reason = commandUnavailableReason(state, id, connected) || executionSelectionReason(state.localSessions?.execution, selection);
  if (modalContext?.type === 'agent' && state.agents.find((agent) => agent.id === modalContext.id)?.connection?.sessionId !== id) { formError('직원 연결이 변경되었습니다. 지시할 대화를 다시 확인해 주세요.'); return; }
  if (reason) { formError(reason); return; }
  const delivery = new CommandDelivery(apiRequest, {
    id: newCommandId(), sessionId: id, content,
    ...(selection.model ? selection : {}),
  }, onCommandChange);
  commandDeliveries.set(id, delivery);
  commandDrafts.set(id, content);
  await delivery.send();
}

function agentSignature(id) {
  const agent = state.agents.find((item) => item.id === id);
  const connection = agent?.connection ? { ...agent.connection } : null;
  if (connection) delete connection.updatedAt;
  return JSON.stringify([{ ...agent, connection }, state.tasks.filter((task) => task.agentId === id), state.office.paused, connected]);
}

function renderStaffSettings() {
  const form = $('#edit-agent-form', body);
  if (!modal.open || !form) return;
  const agent = state.agents.find((item) => item.id === form.dataset.id);
  if (!agent) return;
  const model = $('#staff-model', form);
  if (model) {
    const draft = formDrafts.get(draftKey(form));
    const selection = model.dataset.initialized ? { model: model.value, reasoningEffort: $('#staff-effort', form).value }
      : draft && Object.hasOwn(draft, 'model') ? { model: draft.model, reasoningEffort: draft.reasoningEffort } : agent.executionPreference || {};
    const eligible = connected && agent.connection?.source === 'cli' && agent.connection.kind === 'session' && agent.connection.status === 'connected';
    updateExecutionFields(form, eligible ? state.localSessions?.execution : null, selection, pending, 'staff');
    model.dataset.initialized = 'true';
    $('#staff-execution-help', form).textContent = '저장하면 이 직원의 다음 지시에 기본값으로 사용합니다. 저장만으로 지시를 보내거나 실행 중인 모델·권한을 바꾸지 않습니다.'
      + (!eligible ? ' Codex 대화를 다시 연결하면 지원 모델을 선택할 수 있습니다.' : ' 실제 모델 적용 여부는 지시 접수 화면에서 확인합니다.');
    const changed = (selection.model || '') !== (agent.executionPreference?.model || '') || (selection.reasoningEffort || '') !== (agent.executionPreference?.reasoningEffort || '');
    const warning = executionSelectionReason(eligible ? state.localSessions?.execution : null, selection);
    $('#staff-selection-warning', form).textContent = warning ? `${warning}${changed ? '' : ' 저장된 기본값은 유지되며 프로젝트·이름·역할은 수정할 수 있습니다.'}` : '';
  }
  $('#staff-settings-conflict', form).hidden = Number(form.elements.settingsRevision.value) === agent.settingsRevision;
}

function openEditAgent(id) {
  const agent = state.agents.find((item) => item.id === id);
  if (!agent) return;
  const codex = agent.provider === 'openai';
  openModal('별칭과 직원 설정', 'TEAMMATE SETTINGS', `<form id="edit-agent-form" class="form-stack" data-id="${esc(id)}"><input type="hidden" name="settingsRevision" value="${agent.settingsRevision}">${staffIdentity(agent)}<div class="form-field"><label for="edit-name">직원 별칭</label><input id="edit-name" name="name" value="${esc(agent.name)}" maxlength="40" required></div><div class="form-field"><label for="edit-role">담당 역할</label><input id="edit-role" name="role" value="${esc(agent.role)}" maxlength="120" required></div>${projectField(agent, state.agents, state.localSessions)}<h3>기본 추론 설정</h3>${codex ? `${executionFields('staff')}<p id="staff-selection-warning" class="field-help" role="status"></p>` : `<p class="field-help">${agent.provider === 'demo' ? '체험 직원은 실제 모델 추론을 사용하지 않습니다.' : '이 공급자는 관찰 전용입니다. 모델과 추론 강도는 원래 CLI 또는 웹 서비스에서 설정하세요.'}</p>`}<p class="field-help">담당 프로젝트·이름·역할은 저장 즉시 반영됩니다.</p><p id="staff-settings-conflict" class="form-error" role="status" hidden>다른 화면에서 설정이나 연결이 변경됐습니다. 작성 내용은 유지했습니다. 최신 설정을 다시 불러온 뒤 변경해 주세요.</p>${errorSlot()}<div class="form-actions"><button type="button" class="button" data-reload-staff-settings="${esc(id)}">최신 설정 다시 불러오기</button><button type="button" class="button" data-stat-agent="${esc(id)}">직원 상세로</button><button type="submit" class="button button-primary" data-mutation>변경 사항 저장</button></div></form>`, { type: 'edit-agent', id });
  renderStaffSettings();
  $('#edit-name', body).focus();
}

async function reloadStaffSettings(id) {
  const revision = modalLayer.revision;
  await refresh(true);
  if (!connected || !modal.open || modalLayer.revision !== revision || modalContext?.type !== 'edit-agent' || modalContext.id !== id) return;
  const form = $('#edit-agent-form', body);
  if (form) { form.dataset.saved = 'true'; formDrafts.delete(draftKey(form)); }
  openEditAgent(id);
}

function openNewTask(agentId) {
  const available = state.agents.filter((agent) => !taskUnavailableReason(state, agent));
  if (!available.length) { toast('업무를 맡길 수 있는 체험용 직원이 필요합니다.', true); return; }
  agentId = available.find((agent) => agent.id === (agentId || lastTaskAgentId))?.id || available[0].id;
  lastTaskAgentId = agentId;
  openModal('함께할 일을 알려 주세요', 'LET’S MAKE A START', `<form id="new-task-form" class="form-stack" data-id="${esc(agentId)}"><div class="form-field"><label for="task-agent">담당 직원</label><select id="task-agent" name="agentId">${available.map((agent) => `<option value="${esc(agent.id)}" ${agent.id === agentId ? 'selected' : ''}>${esc(agent.name)} · ${esc(agent.role)}</option>`).join('')}</select></div><div class="form-field"><label for="task-title">업무 이름</label><input id="task-title" name="title" placeholder="예: 새 프로젝트 아이디어 정리" maxlength="120" required autocomplete="off"></div><div class="form-field"><label for="task-description">업무 설명 <span class="muted">선택</span></label><textarea id="task-description" name="description" rows="4" maxlength="4000" placeholder="목표, 필요한 결과물, 참고할 내용을 알려 주세요."></textarea></div><div class="info-box">${icon('spark')}<span>체험용 실행입니다. 실제 AI가 업무를 수행하지 않으며, 고정된 질문 → 답변 → 결과 승인 흐름으로 진행합니다.</span></div>${errorSlot()}<div class="form-actions"><button type="button" class="button" data-close>취소</button><button class="button button-primary" type="submit" data-mutation>업무 시작하기</button></div></form>`, { type: 'new-task' });
  $('#task-title', body).focus();
}

async function openTask(id) {
  modalLayer.close({ restoreFocus: false, reason: 'navigate' });
  location.hash = 'office';
  await workspace.selectTask(id);
  if (workspace.selection?.type === 'task' && workspace.selection.id === id) {
    $('#workbench-title').tabIndex = -1;
    $('#workbench-title').focus({ preventScroll: true });
    $('#workbench-detail').scrollIntoView({ block: 'start' });
  }
}

const STAT_DETAILS = {
  agents: { title: '함께하는 직원', unit: '명', description: '사무실 전체에 등록된 직원입니다. 직원을 선택하면 역할·연결 상태와 맡은 업무를 확인합니다.', empty: '아직 등록된 직원이 없습니다.' },
  working: { title: '진행 중인 업무', unit: '건', description: '접수·실행 중이거나 답변·승인을 기다리는 업무입니다. 항목을 선택하면 해당 방의 업무보고로 이동합니다.', empty: '지금 진행 중인 업무가 없습니다.' },
  waiting: { title: '응답·승인 대기', unit: '건', description: 'Commander의 답변 또는 결과 승인을 기다리는 업무입니다. 항목을 선택해 질문과 보고 내용을 확인하세요.', empty: '응답이나 승인을 기다리는 업무가 없습니다.' },
  completed: { title: '완료한 업무', unit: '건', description: '완료 처리된 업무입니다. 항목을 선택해 결과와 대화를 다시 확인하세요.', empty: '아직 완료한 업무가 없습니다.' },
};

function openStatDetails(key) {
  if (!Object.hasOwn(STAT_DETAILS, key)) return;
  const detail = STAT_DETAILS[key];
  openModal(detail.title, '사무실 전체 현황', `<p class="stat-detail-description">${esc(detail.description)}</p><p id="stat-detail-connection" class="stat-detail-notice" role="status" hidden>서버 연결이 끊겨 마지막으로 받은 목록을 표시합니다.</p><div id="stat-detail-list" class="stat-detail-list" tabindex="-1" aria-label="${esc(detail.title)} 목록"></div>`, { type: 'stats', key });
  renderStatDetails();
}

function renderStatDetails() {
  if (!modal.open || modalContext?.type !== 'stats') return;
  const { key } = modalContext;
  const detail = STAT_DETAILS[key];
  const items = officeStatItems(state, key);
  $('#modal-title').textContent = `${detail.title} · ${items.length}${detail.unit}`;
  $('#stat-detail-connection', body).hidden = connected;
  const list = $('#stat-detail-list', body);
  const content = items.length ? items.map((item) => key === 'agents'
    ? `<button type="button" class="agent-card stat-detail-entry" data-stat-agent="${esc(item.id)}">${avatar(item)}<span class="agent-info"><strong>${esc(item.name)}</strong>${staffIdentity(item, true)}<small>${esc(item.role)}</small><small class="staff-project">${esc(projectSummary(item, state.localSessions))}</small></span>${badge(item.status)}<span class="stat-entry-link">직원 상세 ↗</span></button>`
    : taskRow(item)).join('') : emptyState(detail.empty, '현황이 바뀌면 이 목록에도 자동으로 반영됩니다.', key === 'agents' ? 'people' : 'task');
  if (list.dataset.signature === content) return;
  const focus = document.activeElement;
  const field = key === 'agents' ? 'statAgent' : 'task';
  const focusId = list.contains(focus) ? focus.dataset[field] : null;
  const scroll = list.scrollTop;
  list.innerHTML = content;
  list.dataset.signature = content;
  if (focusId) ([...list.querySelectorAll('button')].find((node) => node.dataset[field] === focusId) || list).focus({ preventScroll: true });
  list.scrollTop = scroll;
}

function syncModal() {
  if (!modal.open || !modalContext || pending) return;
  renderStatDetails();
  if (modalContext.type === 'agent' && !state.agents.some((agent) => agent.id === modalContext.id)) {
    closeModal(); toast('이 직원의 등록이 해제되었습니다. 해제 기록에서 확인해 주세요.'); return;
  }
  if (modalContext.type === 'agent' && agentSignature(modalContext.id) !== modalContext.signature) {
    const focus = document.activeElement;
    const focusInside = modal.contains(focus);
    const focusId = focusInside ? focus.id : null;
    const focusData = focusInside && Object.keys(focus.dataset).find((key) => focus.dataset[key]);
    const focusValue = focusData && focus.dataset[focusData];
    const cursor = focusId === 'session-command' ? [focus.selectionStart, focus.selectionEnd] : null;
    const scroll = modal.scrollTop;
    const bodyScroll = body.scrollTop;
    openAgent(modalContext.id);
    const target = focusInside && (focus.isConnected ? focus : focusId ? document.getElementById(focusId)
      : [...body.querySelectorAll('button')].find((node) => focusData && node.dataset[focusData] === focusValue));
    target?.focus({ preventScroll: true });
    if (cursor) $('#session-command', body)?.setSelectionRange(...cursor);
    modal.scrollTop = scroll;
    body.scrollTop = bodyScroll;
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
  if (button.hasAttribute('data-released-agents')) { openReleasedAgents(); return; }
  if (button.dataset.releaseAgent) { requestReleaseAgent(button.dataset.releaseAgent); return; }
  if (button.dataset.confirmRelease) {
    void mutate(`/agents/${encodeURIComponent(button.dataset.confirmRelease)}/release`, { settingsRevision: Number(button.dataset.revision) }, '직원 등록을 해제했습니다. 업무와 메모는 해제 기록에서 확인하세요.', 'POST', openReleasedAgents); return;
  }
  if (button.dataset.restoreAgent) {
    void mutate(`/agents/${encodeURIComponent(button.dataset.restoreAgent)}/restore`, { settingsRevision: Number(button.dataset.revision) }, '직원을 다시 등록했습니다. 외부 연결을 직접 선택해 주세요.', 'POST', (agent) => openAgent(agent.id)); return;
  }
  if (button.hasAttribute('data-workbench-connections')) { openWorkConnections(); return; }
  if (button.dataset.refreshArchive) {
    const form = $('#archive-form', body);
    void refresh(true).then(() => {
      if (form?.isConnected && connected) {
        form.elements.settingsRevision.value = String(state.agents.find((agent) => agent.id === button.dataset.refreshArchive)?.settingsRevision ?? form.elements.settingsRevision.value);
        toast('최신 버전을 확인했습니다. 작성한 메모를 검토한 뒤 저장해 주세요.');
      }
    });
    return;
  }
  if (button.dataset.archiveAgent) { openArchive(button.dataset.archiveAgent); return; }
  if (button.dataset.archiveSession) { openArchive(button.dataset.archiveSession, true); return; }
  if (button.dataset.officeStat) { openStatDetails(button.dataset.officeStat); return; }
  if (button.dataset.statAgent) { openAgent(button.dataset.statAgent); return; }
  if (button.hasAttribute('data-room-assign')) { openNewTask(); return; }
  if (button.dataset.sessionCommand) { openSession(button.dataset.sessionCommand); return; }
  if (button.dataset.retryCommand) { void commandDeliveries.get(button.dataset.retryCommand)?.retry(); return; }
  if (button.dataset.checkCommand) { void commandDeliveries.get(button.dataset.checkCommand)?.check(); return; }
  if (button.dataset.freshCommand) {
    const id = button.dataset.freshCommand;
    commandDeliveries.delete(id);
    commandDrafts.delete(id);
    executionDrafts.delete(id);
    onCommandChange();
    if (modalContext?.type === 'agent') openAgent(modalContext.id);
    else openSession(id);
    $('#session-command', body)?.focus();
    return;
  }
  if (button.dataset.agent) {
    const sessionId = state.agents.find((agent) => agent.id === button.dataset.agent)?.connection?.sessionId;
    if (sessionId) cliDialog.open(sessionId);
    else openAgent(button.dataset.agent);
    return;
  }
  if (button.dataset.session) { workspace.selectSession(button.dataset.session); return; }
  if (button.dataset.task) { openTask(button.dataset.task); return; }
  if (button.dataset.reloadStaffSettings) {
    void reloadStaffSettings(button.dataset.reloadStaffSettings); return;
  }
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
  if (event.target.id === 'task-agent') {
    saveFormDraft();
    lastTaskAgentId = event.target.value;
    event.target.form.dataset.id = lastTaskAgentId;
  }
  if (['staff-model', 'staff-effort'].includes(event.target.id)) {
    if (event.target.id === 'staff-model') {
      const entry = state.localSessions?.execution?.models?.find((item) => item.id === event.target.value);
      updateExecutionFields(body, state.localSessions?.execution, { model: event.target.value, reasoningEffort: entry?.defaultReasoningEffort || '' }, false, 'staff');
    }
    saveFormDraft(); renderStaffSettings();
  }
  if (['command-model', 'command-effort'].includes(event.target.id)) {
    const id = $('#session-command-form', body)?.dataset.id;
    if (!id || commandDeliveries.has(id)) return;
    const model = $('#command-model', body).value;
    const entry = state.localSessions?.execution?.models?.find((item) => item.id === model);
    const reasoningEffort = event.target.id === 'command-model' ? entry?.defaultReasoningEffort || '' : $('#command-effort', body).value;
    executionDrafts.set(id, { model, reasoningEffort });
    renderSessionCommand();
  }
});

body.addEventListener('input', (event) => {
  if (event.target.id === 'session-command') commandDrafts.set($('#session-command-form', body).dataset.id, event.target.value);
});

body.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  if (pending || !form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  Object.keys(data).forEach((key) => { data[key] = data[key].trim(); });
  if (form.id === 'archive-form') {
    const isSession = form.dataset.session === 'true';
    void mutate(isSession ? `/local-sessions/${encodeURIComponent(form.dataset.id)}/archive` : `/agents/${encodeURIComponent(form.dataset.id)}/archive`,
      isSession ? { note: data.note } : { stored: event.submitter?.value !== 'restore', note: data.note, settingsRevision: Number(data.settingsRevision) },
      event.submitter?.value === 'restore' ? '업무를 복귀했습니다. 실제 연결을 확인한 뒤 새 지시를 작성하세요.' : '업무와 메모를 창고에 보관했습니다.',
      isSession ? 'POST' : 'PUT', (agent) => openAgent(agent.id));
  } else if (form.id === 'session-command-form') {
    if (!data.content) { formError('전달할 지시를 입력해 주세요.'); return; }
    void sendSessionCommand(form.dataset.id, data.content);
  } else if (form.id === 'hire-form') {
    if (!data.name || !data.role) { formError('이름과 역할을 입력해 주세요.'); return; }
    if (!data.model) delete data.model;
    if (!data.reasoningEffort) delete data.reasoningEffort;
    void mutate('/agents', data, '새 동료가 사무실에 합류했습니다.', 'POST', (agent) => openAgent(agent.id));
  } else if (form.id === 'edit-agent-form') {
    if (!data.name || !data.role) { formError('이름과 역할을 입력해 주세요.'); return; }
    data.settingsRevision = Number(data.settingsRevision);
    if ($('#staff-model', form)) {
      data.executionPreference = $('#staff-model', form).value ? { model: $('#staff-model', form).value, reasoningEffort: $('#staff-effort', form).value } : null;
    }
    delete data.model; delete data.reasoningEffort;
    void mutate(`/agents/${encodeURIComponent(form.dataset.id)}`, data, '담당 프로젝트와 직원 설정을 저장했습니다.', 'PATCH', () => openAgent(form.dataset.id));
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
  workspace.update(state, connected, motionEnabled, pending);
}
$('#motion-toggle').addEventListener('click', () => {
  motionEnabled = !motionEnabled;
  updateMotionPreference();
});
motionPreference.addEventListener('change', updateMotionPreference);
window.addEventListener('hashchange', navigate);
window.addEventListener('online', () => { void refresh(true); });
document.addEventListener('office:staff-changed', async (event) => {
  const revision = modalLayer.revision;
  const route = location.hash;
  await refresh(true);
  toast('직원 연결 정보를 반영했습니다.');
  if (event.detail?.showDetails && event.detail?.agentId && revision === modalLayer.revision && route === location.hash && !document.querySelector('dialog[open]')) openAgent(event.detail.agentId);
});
document.addEventListener('office:notice', (event) => toast(event.detail.message, Boolean(event.detail.error)));
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
