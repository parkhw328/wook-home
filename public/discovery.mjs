import { browserId, localExtensionAvailable } from './browser-id.mjs';
import { apiRequest } from './api.mjs';
import { escapeHtml as esc, sessionStatusLabel, displayTime } from './model.mjs';
import './staff-connections.mjs';
import { mountBridgeSettings } from './bridge-settings.mjs';
import { connectionBadge, connectionTone } from './connection-status.mjs';
import { identityMarkup, lifecycleLabel } from './session-identity.mjs';

const GUIDE = 'https://github.com/parkhw328/wook-home/wiki/Detection';
const ENABLED_KEY = 'stackqueue.web-detection.enabled';
const CLIENT_KEY = 'stackqueue.web-detection.client';

export function entryDescription(entry) {
  if (entry.source === 'web') return `${entry.kind === 'conversation' ? '대화 탭' : '서비스·새 대화 화면'} · ${entry.tabCount}개 탭 · ${entry.scope}`;
  if (entry.kind === 'process') return `CLI 프로세스 · ${entry.scope || '이 PC'} · 대화 연결 확인 전`;
  return `CLI 기록 · ${entry.scope || '선택한 프로젝트'} · ${lifecycleLabel(entry)}`;
}

export function entryStatus(entry) {
  if (entry.source === 'web') return entry.status === 'open' ? '탭 열림' : entry.status === 'disconnected' ? '감지 연결 끊김' : '확인 필요';
  if (entry.kind === 'process') return ({ running: '실행 중', exited: '종료 감지', disconnected: '감지 연결 끊김' })[entry.status] || '확인 필요';
  return sessionStatusLabel(entry.status);
}

export function filterEntries(entries, source, provider) {
  return entries.filter((entry) => (source === 'all' || entry.source === source) && (provider === 'all' || entry.provider === provider));
}

export function checksMarkup(checks, online = true) {
  return checks.map((check) => `<article class="discovery-card" data-tone="${connectionTone(online ? check.status : 'disconnected')}"><div class="discovery-card-heading"><strong>${esc(check.name)}</strong>${connectionBadge(online ? check.statusLabel || '확인 필요' : '서버 연결 끊김', online ? check.status : 'disconnected')}</div><div class="discovery-card-body"><p>${esc(check.message)}</p><small>${esc(check.action)}<br>확인 시각: ${check.checkedAt && Number.isFinite(Date.parse(check.checkedAt)) ? esc(displayTime(check.checkedAt)) : '미점검'}${online ? '' : ' · 마지막 수신 결과'}</small></div></article>`).join('');
}

export function entriesMarkup(entries, online = true) {
  return entries.map((entry) => `<article class="discovery-card" data-tone="${connectionTone(online ? entry.status : 'disconnected')}">
    <div class="discovery-card-heading"><strong>${esc(entry.name)}</strong>${connectionBadge(online ? entryStatus(entry) : '서버 연결 끊김', online ? entry.status : 'disconnected')}</div>
    <div class="discovery-card-body">${identityMarkup(entry.sessionId || entry.id, entry.sessionId ? 'session-id' : '감지 ID · session-id 미확인')}<p>${esc(entryDescription(entry))}</p><small>${entry.kind === 'process' && entry.status === 'exited' ? '종료 시각' : entry.source === 'web' || entry.kind === 'process' ? '마지막 확인' : '마지막 활동'} ${esc(displayTime(entry.endedAt || entry.updatedAt || entry.lastActivityAt))}<br>${!online ? '마지막 수신 상태 · 현재 실행 여부 확인 불가' : entry.canControl ? '기존 CLI 목록에서 지시 가능' : '관찰 전용'}</small></div>
    <div class="discovery-card-actions">${entry.linkedAgentId ? `<button type="button" class="button button-small" data-agent="${esc(entry.linkedAgentId)}" ${!online ? 'disabled' : ''}>${esc(entry.linkedAgentName)} 보기</button>`
      : `<button type="button" class="button button-small" data-connect-entry="${esc(entry.id)}" ${!online || !entry.canRegister ? 'disabled' : ''}>직원 등록·연결</button>`}</div></article>`).join('');
}

export function sourcesMarkup(sources, online = true) {
  const labels = { connected: '감지 정상', disconnected: '감지 연결 끊김', not_connected: '연결 대기', unavailable: '확인 불가', unsupported: '미지원' };
  const badge = (name, source) => connectionBadge(`${name} · ${online ? labels[source.status] || '확인 필요' : '서버 연결 끊김'}${online && source.truncated ? ' · 일부만 표시' : ''}`,
    !online ? 'disconnected' : source.status === 'connected' && source.truncated ? 'partial' : source.status);
  return badge('CLI 기록', sources.cli) + badge('CLI 프로세스', sources.processes)
    + (sources.browsers.length ? sources.browsers.map((browser, index) => badge(`웹 감지 ${index + 1}`, browser)).join('') : badge('웹 감지', { status: 'not_connected' }));
}

function initialize() {
  const view = document.querySelector('#view-office');
  if (!view) return;
  const panel = document.createElement('section');
  panel.className = 'panel discovery-panel';
  panel.setAttribute('aria-labelledby', 'discovery-heading');
  panel.innerHTML = `<div class="panel-heading"><h2 id="discovery-heading">연결 관리</h2><span id="discovery-counts" class="subtle-tag">확인 중</span></div>
    <div class="connection-legend" aria-label="연결 상태 색상 안내">${connectionBadge('정상 감지', 'connected')}${connectionBadge('활동·정보', 'checking')}${connectionBadge('확인 필요', 'unknown')}${connectionBadge('끊김·오류', 'disconnected')}${connectionBadge('종료·미사용', 'disabled')}</div>
    <div class="discovery-tabs" role="tablist" aria-label="연결 관리 보기">
      <button type="button" id="discovery-tab-detected" role="tab" aria-controls="discovery-panel-detected" aria-selected="true" tabindex="0">감지</button>
      <button type="button" id="discovery-tab-checks" role="tab" aria-controls="discovery-panel-checks" aria-selected="false" tabindex="-1">연결 점검</button>
      <button type="button" id="discovery-tab-settings" role="tab" aria-controls="discovery-panel-settings" aria-selected="false" tabindex="-1">설정</button>
    </div>
    <div id="discovery-panel-detected" role="tabpanel" aria-labelledby="discovery-tab-detected" tabindex="0">
    <p class="discovery-intro">실행 중인 CLI, 프로젝트의 CLI 기록, 브라우저에서 열린 AI 탭을 확인하세요.</p>
    <div class="discovery-toolbar"><label>종류 <select id="discovery-source"><option value="all">전체</option><option value="cli">CLI</option><option value="web">웹 탭</option></select></label>
    <label>공급자 <select id="discovery-provider"><option value="all">전체</option><option value="openai">OpenAI</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="meta">Meta AI</option></select></label>
    <button type="button" id="discovery-toggle" class="button button-secondary">웹 탭 감지 켜기</button><button type="button" id="discovery-refresh" class="button button-secondary">감지 새로고침</button>
    <a class="inline-link" href="${GUIDE}" target="_blank" rel="noopener noreferrer">설치·연결 안내 ↗</a></div>
    <p id="discovery-connection" class="discovery-connection connection-notice" role="status"></p><div id="discovery-sources" class="discovery-sources" aria-label="감지 연결 상태"></div><p id="discovery-process-scope" class="session-scope"></p>
    <div id="discovery-list" class="discovery-list"></div>
    <p class="panel-footnote">웹 감지는 연결한 브라우저 프로필의 지원 사이트를 확인합니다. 탭 열림은 로그인이나 작업 실행 여부를 뜻하지 않습니다. 대화 제목과 본문은 가져오지 않습니다.</p>
    </div>
    <div id="discovery-panel-checks" role="tabpanel" aria-labelledby="discovery-tab-checks" tabindex="0" hidden>
    <div class="discovery-toolbar"><button type="button" id="discovery-check" class="button button-primary">연결 점검 실행</button><a class="inline-link" href="https://github.com/parkhw328/wook-home/wiki/Connections" target="_blank" rel="noopener noreferrer">점검 안내 ↗</a></div>
    <p id="discovery-check-status" class="connection-notice" data-tone="info" role="status">연결 점검 상태를 확인하고 있습니다.</p><div id="discovery-checks" class="discovery-list"></div>
    </div><div id="discovery-panel-settings" role="tabpanel" aria-labelledby="discovery-tab-settings" tabindex="0" hidden></div>`;
  const team = view.querySelector('.team-section');
  if (team) team.insertAdjacentElement('afterend', panel);
  else view.append(panel);
  const find = (selector) => panel.querySelector(selector);
  const settings = mountBridgeSettings(find('#discovery-panel-settings'));
  const tabs = [...panel.querySelectorAll('[role="tab"]')];
  function selectTab(selected) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      find(`#${tab.getAttribute('aria-controls')}`).hidden = !active;
    }
    if (selected.id === 'discovery-tab-settings') void settings.read();
  }
  function openSettings() {
    panel.closest('details')?.setAttribute('open', '');
    selectTab(find('#discovery-tab-settings'));
    requestAnimationFrame(() => { find('#connection-settings-title').focus({ preventScroll: true }); panel.scrollIntoView({ block: 'start' }); });
  }
  document.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-open-connection-settings]')) return;
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* The browser may have already exited. */ } }
    openSettings();
  });
  window.addEventListener('hashchange', () => { if (location.hash === '#connection-settings') openSettings(); });
  if (location.hash === '#connection-settings') openSettings();
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[next]);
      tabs[next].focus();
    });
  }
  let enabled = false;
  let clientId = null;
  try { enabled = localStorage.getItem(ENABLED_KEY) === 'true'; clientId = localStorage.getItem(CLIENT_KEY); } catch { /* Optional preferences. */ }
  let state = null;
  let serverConnected = false;
  let readCompleted = false;
  let reading = false;
  let collecting = false;
  let signature = '';
  let generation = 0;
  let checking = false;
  let checkState = null;
  let webStatus = enabled ? 'checking' : 'disabled';
  let message = enabled ? '확장프로그램 연결 확인 중…' : '이 브라우저의 웹 감지가 꺼져 있습니다. 확장프로그램을 설치한 뒤 켜 주세요.';

  function render() {
    find('#discovery-toggle').textContent = enabled ? '웹 탭 감지 끄기' : '웹 탭 감지 켜기';
    find('#discovery-toggle').setAttribute('aria-pressed', String(enabled));
    find('#discovery-connection').textContent = readCompleted && !serverConnected ? '서버 연결 끊김 · 감지 상태를 갱신하지 못했습니다. 아래는 마지막 수신 결과입니다.' : message;
    find('#discovery-connection').dataset.tone = connectionTone(readCompleted && !serverConnected ? 'disconnected' : webStatus);
    if (!state) { find('#discovery-counts').textContent = '연결 확인 필요'; return; }
    const counts = state.counts;
    find('#discovery-counts').textContent = serverConnected
      ? `CLI 실행 ${counts.cliProcesses} · 기록 ${counts.cli} · 웹 ${counts.webTabs}개 탭`
      : '서버 연결 끊김 · 마지막 수신 상태';
    find('#discovery-sources').innerHTML = sourcesMarkup(state.sources, serverConnected);
    find('#discovery-process-scope').textContent = `프로세스 감지 범위: ${state.sources.processes.scope || '이 PC'}`;
    const entries = filterEntries(state.entries, find('#discovery-source').value, find('#discovery-provider').value);
    const next = JSON.stringify([entries, serverConnected]);
    if (next === signature) return;
    signature = next;
    const focused = document.activeElement?.closest('#discovery-list button');
    const focusedEntry = focused?.dataset.connectEntry;
    const focusedAgent = focused?.dataset.agent;
    const unregistered = entries.filter((entry) => !entry.linkedAgentId);
    const registered = entries.filter((entry) => entry.linkedAgentId);
    find('#discovery-list').innerHTML = entries.length ? `<section class="discovery-group"><h3>미등록 감지 대상 · ${unregistered.length}</h3><p class="field-help">아래 대상은 직원 수에 포함되지 않습니다. 확인 후 등록하거나 기존 직원에 연결하세요.</p>${entriesMarkup(unregistered, serverConnected) || '<p>미등록 감지 대상이 없습니다.</p>'}</section><section class="discovery-group"><h3>직원으로 등록된 연결 · ${registered.length}</h3>${entriesMarkup(registered, serverConnected) || '<p>아직 등록한 연결이 없습니다.</p>'}</section>`
      : '<p class="discovery-empty">조건에 맞는 감지 항목이 없습니다. 연결 상태와 선택한 필터를 확인하세요.</p>';
    if (focusedEntry || focusedAgent) [...find('#discovery-list').querySelectorAll('button')]
      .find((button) => focusedEntry ? button.dataset.connectEntry === focusedEntry : button.dataset.agent === focusedAgent)?.focus({ preventScroll: true });
  }

  async function read() {
    if (reading) return;
    reading = true;
    try { state = await apiRequest('/discovery'); serverConnected = true; }
    catch { serverConnected = false; }
    finally { reading = false; readCompleted = true; render(); }
    void settings.read();
    if (!checking) {
      try { checkState = await apiRequest('/connections'); renderChecks(); }
      catch { renderCheckFailure('연결 점검 상태를 가져오지 못했습니다. 서버 연결을 확인하세요.'); }
    }
  }

  function renderChecks() {
    if (!checkState || !Array.isArray(checkState.checks)) return;
    find('#discovery-checks').hidden = false;
    find('#discovery-checks').innerHTML = checksMarkup(checkState.checks);
    find('#discovery-check-status').dataset.tone = connectionTone(checkState.checking ? 'checking' : 'disabled');
    find('#discovery-check-status').textContent = checkState.checking ? '연결 상태를 점검하고 있습니다.'
      : checkState.checkedAt ? `마지막 점검 ${displayTime(checkState.checkedAt)}${checkState.nextCheckAt ? ` · 다음 점검 가능 ${displayTime(checkState.nextCheckAt)}` : ''}`
        : '점검 실행으로 CLI·웹·설정된 API의 연결 상태를 확인하세요.';
  }

  function renderCheckFailure(message) {
    find('#discovery-check-status').textContent = `${message}${checkState ? ' 아래는 마지막 수신 결과입니다.' : ''}`;
    find('#discovery-check-status').dataset.tone = 'error';
    find('#discovery-checks').innerHTML = checkState ? checksMarkup(checkState.checks, false) : '';
  }

  find('#discovery-check').addEventListener('click', async () => {
    if (checking) return;
    checking = true;
    find('#discovery-check').disabled = true;
    find('#discovery-check-status').textContent = '연결 상태를 점검하고 있습니다.';
    find('#discovery-check-status').dataset.tone = 'info';
    try { checkState = await apiRequest('/connections/check', { method: 'POST', body: {} }); renderChecks(); }
    catch (error) { renderCheckFailure(error.message); }
    finally { checking = false; find('#discovery-check').disabled = false; }
  });

  function extensionSnapshot() {
    return new Promise((resolve, reject) => {
      const requestId = browserId();
      function receive(event) {
        if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'stackqueue:discovered' || event.data.requestId !== requestId) return;
        cleanup();
        if (event.data.ok && event.data.snapshot) resolve(event.data.snapshot);
        else reject(new Error('EXTENSION_FAILED'));
      }
      function cleanup() { window.removeEventListener('message', receive); clearTimeout(timeout); }
      const timeout = setTimeout(() => { cleanup(); reject(new Error('EXTENSION_MISSING')); }, 4000);
      window.addEventListener('message', receive);
      window.postMessage({ type: 'stackqueue:discover', requestId }, location.origin);
    });
  }

  async function collect() {
    if (!enabled || collecting) return;
    if (!localExtensionAvailable()) {
      webStatus = 'unsupported';
      message = '이 원격 주소에서는 브라우저 확장을 연결할 수 없습니다. 자동 웹 감지는 확장을 설치한 PC의 http://localhost:8080 사무실에서 사용하세요. 원격 자료 검색과 직접 보관은 계속 사용할 수 있습니다.';
      render(); return;
    }
    collecting = true;
    const current = generation;
    try {
      const snapshot = await extensionSnapshot();
      if (!enabled || current !== generation) return;
      await apiRequest('/discovery/browser', { method: 'POST', body: snapshot });
      // A stop action during the POST must also clear that just-published snapshot.
      if (!enabled || current !== generation) { await apiRequest(`/discovery/browser/${snapshot.clientId}`, { method: 'DELETE' }); return; }
      clientId = snapshot.clientId;
      try { localStorage.setItem(CLIENT_KEY, clientId); } catch { /* Optional alias only. */ }
      message = `웹 감지 연결됨 · ${snapshot.tabs.length}개 탭${snapshot.truncated ? ' · 한도에 도달해 일부만 표시' : ''} · ${displayTime(snapshot.observedAt)}`;
      webStatus = snapshot.truncated ? 'partial' : 'connected';
    } catch (error) {
      if (current !== generation) return;
      webStatus = error.message === 'EXTENSION_MISSING' ? 'unavailable' : 'disconnected';
      message = error.message === 'EXTENSION_MISSING' ? '확장프로그램 응답이 없습니다. 설치·활성화 후 사무실 페이지를 새로고침하세요.'
        : error.message === 'EXTENSION_FAILED' ? '웹 감지 연결이 중단되었습니다. 확장프로그램 권한과 상태를 확인하세요.'
        : '웹 감지 결과를 서버에 전달하지 못했습니다. 서버 연결을 확인하세요.';
    } finally { collecting = false; render(); await read(); }
  }

  function setEnabled(next) {
    enabled = next;
    generation += 1;
    webStatus = enabled ? 'checking' : 'disabled';
    try { localStorage.setItem(ENABLED_KEY, String(enabled)); } catch { /* Optional preference. */ }
    message = enabled ? '확장프로그램 연결 확인 중…' : '이 브라우저의 웹 감지가 꺼져 있습니다.';
    render();
    if (enabled) void collect();
    else if (clientId) void apiRequest(`/discovery/browser/${clientId}`, { method: 'DELETE' }).then(read).catch(() => {
      message = '웹 감지는 꺼졌습니다. 서버에 남은 표시는 마지막 수신 90초 후 연결 끊김으로 바뀝니다.'; webStatus = 'partial'; render();
    });
  }
  find('#discovery-toggle').addEventListener('click', () => setEnabled(!enabled));
  find('#discovery-refresh').addEventListener('click', () => { void read(); void collect(); });
  document.addEventListener('office:staff-changed', () => { void read(); });
  for (const id of ['#discovery-source', '#discovery-provider']) find(id).addEventListener('change', render);
  window.addEventListener('storage', (event) => { if (event.key === ENABLED_KEY) setEnabled(event.newValue === 'true'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { void read(); void collect(); } });
  setInterval(() => { void read(); }, 5000);
  setInterval(() => { void collect(); }, 15000);
  render();
  void read();
  void collect();
}

if (typeof document !== 'undefined') initialize();
