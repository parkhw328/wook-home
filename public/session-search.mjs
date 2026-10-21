import { apiRequest } from './api.mjs';
import { escapeSearchText as esc, highlightedText, resultMarkup, SearchRequest } from './session-search-model.mjs';

const root = document.querySelector('#view-search');
root.innerHTML = `<section class="panel search-panel" aria-labelledby="search-heading">
  <header class="search-heading"><div><p class="eyebrow">SESSION LIBRARY</p><h2 id="search-heading">이전 대화에서, 다음 작업의 단서를.</h2><p>진행 중인 CLI와 웹 채팅, 보관한 지난 세션의 자료를 함께 찾아보세요.</p></div><a class="text-link" href="https://github.com/parkhw328/wook-home/wiki/Search" target="_blank" rel="noopener noreferrer">검색 연결 안내 ↗</a></header>
  <div class="search-coverage"><p id="search-coverage" role="status">검색 보관함을 확인하고 있습니다.</p><button id="search-refresh" type="button" class="button button-small">보관함 새로고침</button></div>
  <form id="session-search-form"><div class="session-search-input"><label for="session-search-query">자료 검색</label><div><input id="session-search-query" name="query" type="search" maxlength="200" autocomplete="off" placeholder="찾을 문장, 파일 이름, 작업 키워드"><button type="submit" class="button button-primary">검색</button></div></div>
    <div class="search-filters"><label>기록 종류<select name="source"><option value="">CLI + 웹</option><option value="cli">CLI</option><option value="web">웹 채팅</option></select></label><label>공급자<select name="provider"><option value="">전체 공급자</option><option value="openai">OpenAI</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="meta">Meta AI</option></select></label><label>기록 상태<select name="state"><option value="">현재 + 보관 기록</option><option value="current">현재 확인</option><option value="stored">보관 기록</option></select></label><label>작성자<select name="role"><option value="">모든 역할</option><option value="user">사용자</option><option value="assistant">에이전트</option></select></label></div>
  </form>
  <p class="search-scope-note">CLI는 연결한 프로젝트 기록만 검색합니다. 웹은 보관을 켠 대화에서 읽어 온 내용만 검색하며, 불러오지 않은 과거 내용·첨부파일 내부는 포함하지 않습니다. ‘보관 기록’은 실행 종료를 뜻하지 않습니다.</p>
  <div class="search-results-heading"><h3>검색 결과</h3><p id="search-result-count" role="status" aria-live="polite"></p></div><p id="search-error" role="alert" hidden></p><div id="search-results"></div><nav id="search-pagination" class="search-pagination" aria-label="검색 결과 페이지"></nav>
</section>
<section class="panel search-settings" aria-labelledby="search-settings-title"><div><h2 id="search-settings-title">웹 대화 검색 보관</h2><p>AI 대화 탭에서 StackQueue 확장 버튼 → <strong>현재 대화 보관 켜기</strong>를 선택하세요. 이곳에서도 웹 보관을 켜면 사무실이 열려 있는 동안 수집합니다. 탭을 닫거나 서버를 재시작해도 저장한 자료는 유지됩니다.</p></div><button type="button" id="search-web-toggle" class="button" aria-pressed="false" disabled>웹 보관 확인 중</button><p id="search-web-status" role="status"></p><details><summary>화면에서 읽지 못한 자료 직접 보관</summary><p>대화 화면 구조가 지원되지 않거나 과거 자료를 가져오려면, 원하는 공개 대화 텍스트를 복사해 저장하세요. 원본 대화 주소와 작성자를 함께 남깁니다.</p><form id="search-import-form"><label>원본 대화 주소<input type="url" name="url" required placeholder="https://claude.ai/chat/…"></label><label>작성자<select name="role"><option value="user">사용자</option><option value="assistant">에이전트</option></select></label><label>보관할 텍스트<textarea name="content" rows="6" required maxlength="20000" placeholder="검색할 공개 메시지 내용을 붙여 넣으세요."></textarea></label><button type="submit" class="button">이 자료 보관</button><p id="search-import-status" role="status"></p></form></details></section>
<dialog id="search-dialog" class="search-dialog" aria-labelledby="search-dialog-title"><header><div><p class="eyebrow">SAVED CONVERSATION</p><h2 id="search-dialog-title">보관 대화</h2></div><button type="button" class="button" id="search-dialog-close">닫기</button></header><p id="search-dialog-info"></p><div class="search-dialog-actions"><button type="button" class="button button-small" id="search-match-next">다음 일치 문장 ↓</button><a id="search-original-link" class="button button-small" target="_blank" rel="noopener noreferrer" hidden>원본 대화 열기 ↗</a></div><div id="search-dialog-messages" class="search-dialog-messages"></div></dialog>`;

const $ = (selector) => root.querySelector(selector);
const form = $('#session-search-form');
const queryRequest = new SearchRequest();
const detailRequest = new SearchRequest();
let offset = 0;
let activeQuery = '';
let started = false;
let enabled = false;
let webBusy = false;
let lastExtension;
let selectedButton;
let matchIndex = 0;

async function status() {
  try {
    const data = await apiRequest('/search/status');
    enabled = data.webEnabled;
    const counts = data.counts.reduce((sum, entry) => ({ sessions: sum.sessions + entry.sessions, messages: sum.messages + entry.messages }), { sessions: 0, messages: 0 });
    const states = { enabled: 'CLI 수집 켜짐', not_enabled: 'CLI 검색 연결 필요', disconnected: 'CLI 연결 끊김 · 저장 기록 검색 가능', unavailable: 'CLI 기록 확인 필요' };
    $('#search-coverage').textContent = `${counts.sessions}개 대화 · ${counts.messages.toLocaleString('ko-KR')}개 메시지 보관 / ${states[data.collection]}${data.cli?.workspace ? ` · ${data.cli.workspace}` : ''}${data.cli?.limited || data.cli?.skipped ? ' · 수집 한도 또는 읽지 못한 기록 있음' : ''}`;
    const toggle = $('#search-web-toggle');
    toggle.disabled = false;
    toggle.textContent = enabled ? '웹 보관 끄기' : '웹 보관 켜기';
    toggle.setAttribute('aria-pressed', String(enabled));
    if (!enabled) $('#search-web-status').textContent = '새 웹 자료 수집이 꺼져 있습니다. 기존 보관 자료는 계속 검색할 수 있습니다.';
  } catch (error) { $('#search-coverage').textContent = error.message; }
}

async function search() {
  const input = Object.fromEntries(new FormData(form));
  activeQuery = input.query.trim();
  $('#search-result-count').textContent = '검색 중…';
  $('#search-error').hidden = true;
  $('#search-results').setAttribute('aria-busy', 'true');
  try {
    const result = await queryRequest.run((signal) => apiRequest('/search/query', { method: 'POST', body: { ...input, offset }, signal }));
    if (!result) return;
    const data = result.value;
    $('#search-result-count').textContent = `${data.total.toLocaleString('ko-KR')}개 일치 메시지${data.total ? ` · ${offset + 1}–${Math.min(offset + data.limit, data.total)}` : ''}`;
    $('#search-results').innerHTML = data.results.length ? data.results.map((item) => resultMarkup(item, data.query)).join('') : '<div class="search-empty"><strong>일치하는 자료가 없습니다.</strong><p>검색어·필터를 바꾸거나 보관 연결 상태를 확인해 주세요. 웹 대화는 개별 보관을 켠 뒤에 검색할 수 있습니다.</p></div>';
    $('#search-pagination').innerHTML = `${offset ? '<button type="button" class="button" data-page="previous">← 이전</button>' : ''}${offset + data.limit < data.total ? '<button type="button" class="button" data-page="next">다음 →</button>' : ''}`;
  } catch (error) { $('#search-error').textContent = error.message; $('#search-error').hidden = false; $('#search-result-count').textContent = '검색하지 못했습니다.'; }
  finally { $('#search-results').setAttribute('aria-busy', 'false'); }
}

function extensionSnapshot() {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('확장 연결을 확인해 주세요. 확장을 업데이트했다면 AI 대화 탭과 사무실을 새로고침하세요.')); }, 8000);
    function receive(event) {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'stackqueue:search-received' || event.data.requestId !== requestId) return;
      clearTimeout(timer); window.removeEventListener('message', receive);
      if (event.data.ok) resolve(event.data.snapshot); else reject(new Error('확장 연결을 확인해 주세요. 허용한 사무실 주소에서 다시 시도하세요.'));
    }
    window.addEventListener('message', receive);
    window.postMessage({ type: 'stackqueue:search-request', requestId }, location.origin);
  });
}

async function collectWeb() {
  if (!enabled || webBusy) return;
  webBusy = true;
  try {
    const snapshot = await extensionSnapshot();
    if (!enabled) return;
    await apiRequest('/search/web', { method: 'POST', body: snapshot });
    lastExtension = Date.now();
    const open = snapshot.sessions.filter((entry) => entry.observation === 'open').length;
    const unavailable = snapshot.sessions.filter((entry) => entry.observation === 'unavailable').length;
    $('#search-web-status').textContent = snapshot.sessions.length
      ? `보관 선택 ${snapshot.sessions.length}개 · 열린 대화 ${open}개 수집${unavailable ? ` · ${unavailable}개는 읽지 못했습니다. 해당 탭을 새로고침하거나 아래에서 직접 보관하세요.` : ''} · ${new Date().toLocaleTimeString('ko-KR')}`
      : '확장에서 보관할 대화를 아직 선택하지 않았습니다. AI 대화 탭에서 StackQueue 확장 버튼을 열어 선택하세요.';
    if (!root.hidden) await status();
  } catch (error) { $('#search-web-status').textContent = `${error.message}${lastExtension ? ' 기존에 보관한 자료는 검색할 수 있습니다.' : ''}`; }
  finally { webBusy = false; }
}

form.addEventListener('submit', (event) => { event.preventDefault(); offset = 0; search(); });
form.addEventListener('change', (event) => { if (event.target.tagName === 'SELECT') { offset = 0; search(); } });
$('#search-pagination').addEventListener('click', (event) => {
  const button = event.target.closest('[data-page]');
  if (!button) return;
  offset = Math.max(0, offset + (button.dataset.page === 'next' ? 30 : -30));
  search();
});
$('#search-refresh').addEventListener('click', async () => { await collectWeb(); await status(); await search(); });
$('#search-web-toggle').addEventListener('click', async () => {
  const button = $('#search-web-toggle'); button.disabled = true;
  try { const data = await apiRequest('/search/settings', { method: 'PUT', body: { webEnabled: !enabled } }); enabled = data.webEnabled; await status(); if (enabled) await collectWeb(); }
  catch (error) { $('#search-web-status').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#search-results').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-search-session]');
  if (!button) return;
  selectedButton = button;
  $('#search-dialog-title').textContent = '보관 대화 불러오는 중';
  $('#search-dialog-info').textContent = '';
  $('#search-dialog-messages').replaceChildren();
  $('#search-original-link').hidden = true;
  if (!$('#search-dialog').open) $('#search-dialog').showModal();
  try {
    const result = await detailRequest.run((signal) => apiRequest(`/search/sessions/${button.dataset.searchSession}`, { signal }));
    if (!result || !$('#search-dialog').open) return;
    const { session, messages } = result.value;
    $('#search-dialog-title').textContent = session.name;
    $('#search-dialog-info').textContent = `${session.source === 'cli' ? 'CLI' : '웹'} · ${messages.length}개 메시지${session.truncated ? ' · 일부 기록만 보관됨' : ''} · 읽기 전용 검색 사본`;
    const link = $('#search-original-link');
    if (session.url) { link.href = session.url; link.hidden = false; }
    $('#search-dialog-messages').innerHTML = messages.map((message) => `<article class="search-message${message.key === button.dataset.searchMessage ? ' selected' : ''}" data-message-key="${esc(message.key)}"><header><strong>${message.role === 'user' ? '사용자' : '에이전트'}</strong><span>${esc(message.timestamp ? new Date(message.timestamp).toLocaleString('ko-KR') : '시각 정보 없음')}</span></header><p>${highlightedText(message.content, activeQuery)}</p>${message.truncated ? '<small>긴 메시지 일부 생략</small>' : ''}</article>`).join('');
    matchIndex = 0;
    $('#search-dialog-messages .selected')?.scrollIntoView({ block: 'center' });
  } catch (error) { $('#search-dialog-title').textContent = '대화를 불러오지 못했습니다.'; $('#search-dialog-info').textContent = error.message; }
});
$('#search-dialog-close').addEventListener('click', () => $('#search-dialog').close());
$('#search-dialog').addEventListener('close', () => { detailRequest.generation += 1; detailRequest.controller?.abort(); selectedButton?.focus(); });
$('#search-match-next').addEventListener('click', () => {
  const matches = [...root.querySelectorAll('#search-dialog-messages mark')];
  if (matches.length) matches[matchIndex++ % matches.length].scrollIntoView({ block: 'center' });
});

$('#search-import-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const feedback = $('#search-import-status');
  if (!enabled) { feedback.textContent = '위의 웹 보관을 먼저 켜 주세요.'; return; }
  const values = Object.fromEntries(new FormData(event.target));
  try {
    const url = new URL(values.url);
    const provider = { 'chatgpt.com': 'openai', 'claude.ai': 'claude', 'gemini.google.com': 'gemini', 'meta.ai': 'meta', 'www.meta.ai': 'meta' }[url.hostname];
    if (!provider) throw new Error('지원하는 AI 대화의 원본 주소를 입력해 주세요.');
    let clientId = localStorage.getItem('stackqueue-search-import');
    if (!/^[a-f0-9-]{36}$/.test(clientId || '')) { clientId = crypto.randomUUID(); localStorage.setItem('stackqueue-search-import', clientId); }
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${values.role}:${values.content}`));
    const key = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    await apiRequest('/search/web', { method: 'POST', body: { clientId, sessions: [{ provider, url: values.url, observation: 'closed', messages: [{ key, role: values.role, content: values.content, timestamp: null }] }] } });
    feedback.textContent = '이 PC의 검색 보관함에 저장했습니다.';
    event.target.elements.content.value = '';
    await status(); await search();
  } catch (error) { feedback.textContent = error.message; }
});

async function enter() {
  if (location.hash !== '#search') return;
  await status();
  if (!started) { started = true; await search(); }
  collectWeb();
}
window.addEventListener('hashchange', enter);
await status(); // Restore an explicit previous setting, even while another office view is active.
enter();
setInterval(async () => { await status(); collectWeb(); }, 10000);
