import { apiRequest } from './api.mjs';
import { escapeHtml as esc, sessionStatusLabel, displayTime } from './model.mjs';

const GUIDE = 'https://github.com/parkhw328/wook-home/wiki/Detection';
const ENABLED_KEY = 'stackqueue.web-detection.enabled';
const CLIENT_KEY = 'stackqueue.web-detection.client';

export function entryDescription(entry) {
  if (entry.source === 'web') return `${entry.kind === 'conversation' ? '대화 탭' : '서비스·새 대화 화면'} · ${entry.tabCount}개 탭 · ${entry.scope}`;
  if (entry.kind === 'process') return 'CLI 프로세스 · 이 PC · 대화 연결 확인 전';
  return `CLI 기록 · ${entry.scope || '선택한 프로젝트'} · 실행 중인 프로세스와 별도`;
}

export function entryStatus(entry) {
  if (entry.source === 'web') return entry.status === 'open' ? '탭 열림' : '감지 연결 끊김';
  if (entry.kind === 'process') return ({ running: '실행 중', exited: '종료 감지', unknown: '확인 필요' })[entry.status] || '연결 끊김';
  return sessionStatusLabel(entry.status);
}

export function filterEntries(entries, source, provider) {
  return entries.filter((entry) => (source === 'all' || entry.source === source) && (provider === 'all' || entry.provider === provider));
}

export function checksMarkup(checks) {
  return checks.map((check) => `<article class="discovery-card"><div><strong>${esc(check.name)}</strong><p>${esc(check.message)}</p><small>${esc(check.action)}<br>확인 시각: ${check.checkedAt && Number.isFinite(Date.parse(check.checkedAt)) ? esc(displayTime(check.checkedAt)) : '미점검'}</small></div><span class="subtle-tag">${esc(check.statusLabel)}</span></article>`).join('');
}

function initialize() {
  const view = document.querySelector('#view-office');
  if (!view) return;
  const panel = document.createElement('section');
  panel.className = 'panel discovery-panel';
  panel.setAttribute('aria-labelledby', 'discovery-heading');
  panel.innerHTML = `<div class="panel-heading"><h2 id="discovery-heading">연결 관리</h2><span id="discovery-counts" class="subtle-tag">확인 중</span></div>
    <div class="discovery-tabs" role="tablist" aria-label="연결 관리 보기">
      <button type="button" id="discovery-tab-detected" role="tab" aria-controls="discovery-panel-detected" aria-selected="true" tabindex="0">감지</button>
      <button type="button" id="discovery-tab-checks" role="tab" aria-controls="discovery-panel-checks" aria-selected="false" tabindex="-1">연결 점검</button>
    </div>
    <div id="discovery-panel-detected" role="tabpanel" aria-labelledby="discovery-tab-detected" tabindex="0">
    <p class="discovery-intro">실행 중인 CLI, 프로젝트의 CLI 기록, 브라우저에서 열린 AI 탭을 확인하세요.</p>
    <div class="discovery-toolbar"><label>종류 <select id="discovery-source"><option value="all">전체</option><option value="cli">CLI</option><option value="web">웹 탭</option></select></label>
    <label>공급자 <select id="discovery-provider"><option value="all">전체</option><option value="openai">OpenAI</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="meta">Meta AI</option></select></label>
    <button type="button" id="discovery-toggle" class="button button-secondary">웹 탭 감지 켜기</button><button type="button" id="discovery-refresh" class="button button-secondary">감지 새로고침</button>
    <a class="inline-link" href="${GUIDE}" target="_blank" rel="noopener noreferrer">설치·연결 안내 ↗</a></div>
    <p id="discovery-connection" class="discovery-connection" role="status"></p><p id="discovery-sources" class="session-scope"></p>
    <div id="discovery-list" class="discovery-list"></div>
    <p class="panel-footnote">웹 감지는 연결한 브라우저 프로필의 지원 사이트를 확인합니다. 탭 열림은 로그인이나 작업 실행 여부를 뜻하지 않습니다. 대화 제목과 본문은 가져오지 않습니다.</p>
    </div>
    <div id="discovery-panel-checks" role="tabpanel" aria-labelledby="discovery-tab-checks" tabindex="0" hidden>
    <div class="discovery-toolbar"><button type="button" id="discovery-check" class="button button-secondary">연결 점검 실행</button><a class="inline-link" href="https://github.com/parkhw328/wook-home/wiki/Connections" target="_blank" rel="noopener noreferrer">점검 안내 ↗</a></div>
    <p id="discovery-check-status" role="status">연결 점검 상태를 확인하고 있습니다.</p><div id="discovery-checks" class="discovery-list"></div>
    </div>`;
  const programs = view.querySelector('[aria-labelledby="program-heading"]');
  if (programs?.parentElement === view) view.insertBefore(panel, programs);
  else view.append(panel);
  const find = (selector) => panel.querySelector(selector);
  const tabs = [...panel.querySelectorAll('[role="tab"]')];
  function selectTab(selected) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      find(`#${tab.getAttribute('aria-controls')}`).hidden = !active;
    }
  }
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
  let reading = false;
  let collecting = false;
  let signature = '';
  let generation = 0;
  let checking = false;
  let checkState = null;
  let message = enabled ? '확장프로그램 연결 확인 중…' : '웹 감지가 꺼져 있습니다. 확장프로그램을 설치한 뒤 켜 주세요.';

  function render() {
    find('#discovery-toggle').textContent = enabled ? '웹 탭 감지 끄기' : '웹 탭 감지 켜기';
    find('#discovery-toggle').setAttribute('aria-pressed', String(enabled));
    find('#discovery-connection').textContent = message;
    if (!state) { find('#discovery-counts').textContent = '연결 확인 필요'; return; }
    const counts = state.counts;
    find('#discovery-counts').textContent = serverConnected
      ? `CLI 실행 ${counts.cliProcesses} · 기록 ${counts.cli} · 웹 ${counts.webTabs}개 탭`
      : '서버 연결 끊김 · 마지막 수신 상태';
    const status = { connected: '연결됨', disconnected: '연결 끊김', not_connected: '연결 대기', unavailable: '확인 불가', unsupported: '미지원' };
    find('#discovery-sources').textContent = `CLI 기록 ${status[state.sources.cli.status] || '확인 필요'} · 프로세스 ${status[state.sources.processes.status] || '확인 필요'} · 웹 감지 ${state.sources.browsers.length ? state.sources.browsers.map((browser) => `${status[browser.status]}${browser.truncated ? ' (128개 한도)' : ''}`).join(', ') : '연결 대기'}`;
    const entries = filterEntries(state.entries, find('#discovery-source').value, find('#discovery-provider').value);
    const next = JSON.stringify([entries, serverConnected]);
    if (next === signature) return;
    signature = next;
    find('#discovery-list').innerHTML = entries.length ? entries.map((entry) => `<article class="discovery-card">
      <div><strong>${esc(entry.name)}</strong><p>${esc(entryDescription(entry))}</p><small>${entry.kind === 'process' && entry.status === 'exited' ? '종료 시각' : entry.source === 'web' || entry.kind === 'process' ? '마지막 확인' : '마지막 활동'} ${esc(displayTime(entry.endedAt || entry.updatedAt || entry.lastActivityAt))}<br>${entry.canControl ? '기존 CLI 목록에서 지시 가능' : '관찰 전용'}</small></div>
      <span class="subtle-tag">${esc(serverConnected ? entryStatus(entry) : '연결 끊김')}</span></article>`).join('')
      : '<p class="discovery-empty">조건에 맞는 감지 항목이 없습니다. 연결 상태와 선택한 필터를 확인하세요.</p>';
  }

  async function read() {
    if (reading) return;
    reading = true;
    try { state = await apiRequest('/discovery'); serverConnected = true; }
    catch { serverConnected = false; }
    finally { reading = false; render(); }
    if (!checking) {
      try { checkState = await apiRequest('/connections'); renderChecks(); }
      catch { find('#discovery-checks').hidden = true; find('#discovery-check-status').textContent = '연결 점검 상태를 가져오지 못했습니다. 서버 연결을 확인하세요.'; }
    }
  }

  function renderChecks() {
    if (!checkState || !Array.isArray(checkState.checks)) return;
    find('#discovery-checks').hidden = false;
    find('#discovery-checks').innerHTML = checksMarkup(checkState.checks);
    find('#discovery-check-status').textContent = checkState.checking ? '연결 상태를 점검하고 있습니다.'
      : checkState.checkedAt ? `마지막 점검 ${displayTime(checkState.checkedAt)}${checkState.nextCheckAt ? ` · 다음 점검 가능 ${displayTime(checkState.nextCheckAt)}` : ''}`
        : '점검 실행으로 CLI·웹·설정된 API의 연결 상태를 확인하세요.';
  }

  find('#discovery-check').addEventListener('click', async () => {
    if (checking) return;
    checking = true;
    find('#discovery-check').disabled = true;
    find('#discovery-check-status').textContent = '연결 상태를 점검하고 있습니다.';
    try { checkState = await apiRequest('/connections/check', { method: 'POST', body: {} }); renderChecks(); }
    catch (error) { find('#discovery-check-status').textContent = `${error.message} 아래는 마지막 수신 결과입니다.`; }
    finally { checking = false; find('#discovery-check').disabled = false; }
  });

  function extensionSnapshot() {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
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
    } catch (error) {
      if (current !== generation) return;
      message = error.message === 'EXTENSION_MISSING' ? '확장프로그램 응답이 없습니다. 설치·활성화 후 사무실 페이지를 새로고침하세요.'
        : error.message === 'EXTENSION_FAILED' ? '웹 감지 연결이 중단되었습니다. 확장프로그램 권한과 상태를 확인하세요.'
        : '웹 감지 결과를 서버에 전달하지 못했습니다. 서버 연결을 확인하세요.';
    } finally { collecting = false; render(); await read(); }
  }

  function setEnabled(next) {
    enabled = next;
    generation += 1;
    try { localStorage.setItem(ENABLED_KEY, String(enabled)); } catch { /* Optional preference. */ }
    message = enabled ? '확장프로그램 연결 확인 중…' : '웹 감지가 꺼져 있습니다.';
    render();
    if (enabled) void collect();
    else if (clientId) void apiRequest(`/discovery/browser/${clientId}`, { method: 'DELETE' }).then(read).catch(() => {
      message = '웹 감지는 꺼졌습니다. 서버에 남은 표시는 마지막 수신 90초 후 연결 끊김으로 바뀝니다.'; render();
    });
  }
  find('#discovery-toggle').addEventListener('click', () => setEnabled(!enabled));
  find('#discovery-refresh').addEventListener('click', () => { void read(); void collect(); });
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
