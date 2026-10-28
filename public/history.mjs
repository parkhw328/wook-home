import { apiRequest } from './api.mjs';
import { escapeHtml as esc, displayTime, statusLabel } from './model.mjs';
import { DialogLayer } from './dialog-layer.mjs';

export class WorkHistory {
  constructor(root, onTask) {
    this.root = root; this.onTask = onTask; this.offset = 0; this.revision = 0;
    root.innerHTML = `<div class="history-heading"><div><p class="eyebrow">WORK HISTORY</p><h3>지난 작업 이어보기</h3></div><button class="button button-small" data-history-refresh type="button">새로고침</button></div>
      <form class="history-filters"><label>기록 검색<input name="query" type="search" maxlength="200" placeholder="업무·대화 제목, 프로젝트"></label><label>기록 종류<select name="kind"><option value="">전체 기록</option><option value="task">업무</option><option value="cli">보관 CLI 대화</option><option value="event">사무실 활동</option></select></label><label>프로젝트<select name="projectId"><option value="">모든 프로젝트</option></select></label><button class="button button-primary" type="submit">조회</button></form>
      <p class="field-help" data-history-coverage></p><p data-history-status role="status"></p><div class="history-list"></div><div class="history-pages"></div>
      <p class="field-help">공개 대화를 보관한 시점까지 조회합니다. 기록이 있다는 사실은 실행 종료나 업무 완료를 의미하지 않습니다. 사무실 활동은 최근 200건을 보존합니다.</p><a class="inline-link" href="#connection-settings" data-open-connection-settings>CLI 대화 보관 설정 →</a>`;
    const dialog = document.createElement('dialog'); dialog.className = 'modal history-dialog';
    dialog.innerHTML = '<header class="modal-header dialog-layer-header"><h2>보관된 CLI 대화</h2><button type="button" class="button" data-layer-close>닫기 ×</button></header><div class="dialog-layer-body history-dialog-body"></div>';
    document.body.append(dialog); this.dialog = dialog; this.layer = new DialogLayer(dialog, { onClose: () => { this.detailRevision = (this.detailRevision || 0) + 1; } });
    root.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); this.offset = 0; void this.load(); });
    root.querySelector('form').addEventListener('change', (event) => { if (event.target.tagName === 'SELECT') { this.offset = 0; void this.load(); } });
    root.addEventListener('click', (event) => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.hasAttribute('data-history-refresh')) void this.load();
      if (button.dataset.historyPage) { this.offset += Number(button.dataset.historyPage); void this.load(); }
      if (button.dataset.historyTask) this.onTask(button.dataset.historyTask);
      if (button.dataset.historySession) void this.detail(button.dataset.historySession);
    });
  }
  async load() {
    const revision = ++this.revision;
    this.root.querySelector('[data-history-status]').textContent = '기록을 불러오는 중…';
    try {
      const result = await apiRequest('/history/query', { method: 'POST', body: { ...Object.fromEntries(new FormData(this.root.querySelector('form'))), offset: this.offset } });
      if (revision !== this.revision) return;
      const select = this.root.querySelector('[name="projectId"]'); const selected = select.value;
      select.innerHTML = '<option value="">모든 프로젝트</option>' + result.projects.map((project) => `<option value="${esc(project.id)}">${esc(project.name)}${result.projects.filter((other) => other.name === project.name).length > 1 ? ` · ${esc(project.id.slice(0, 8))}` : ''}</option>`).join(''); select.value = selected;
      this.root.querySelector('[data-history-coverage]').textContent = ({ enabled: 'CLI 보관 수집 중', disconnected: 'CLI 연결 끊김 · 로컬 보관 기록 표시', unavailable: 'CLI 수집 확인 필요 · 기존 보관 기록 표시', not_enabled: 'CLI 보관 꺼짐 · 수집하지 않은 과거 대화는 표시되지 않습니다.' }[result.collection] || '') + (result.limited || result.skipped ? ' · 수집 한도 또는 읽지 못한 기록이 있습니다.' : '');
      this.root.querySelector('[data-history-status]').textContent = `${result.total}건${result.total ? ` · ${result.offset + 1}–${Math.min(result.total, result.offset + result.limit)}` : ''}`;
      this.root.querySelector('.history-list').innerHTML = result.records.map((record) => `<article class="history-entry"><div class="history-entry-meta"><span>${({ task: '업무', cli: 'CLI 대화', event: '활동' })[record.kind]}</span><time>${displayTime(record.updatedAt)}</time></div><strong>${esc(record.title)}</strong><p>${esc([record.projectName, record.agentName, record.status ? statusLabel(record.status) : '', record.kind === 'cli' ? `${record.messageCount}개 메시지 · 보관 사본${record.truncated ? ' · 일부 기록' : ''}` : ''].filter(Boolean).join(' · '))}</p>${record.kind === 'event' ? '' : `<button type="button" class="button button-small" data-history-${record.kind === 'task' ? 'task' : 'session'}="${esc(record.id)}">${record.kind === 'task' ? '업무보고 보기' : '지난 대화 읽기'}</button>`}</article>`).join('') || '<p class="room-empty">조건에 맞는 저장 기록이 없습니다. 검색 조건이나 CLI 보관 설정을 확인하세요.</p>';
      this.root.querySelector('.history-pages').innerHTML = `${this.offset ? '<button class="button" type="button" data-history-page="-20">← 이전</button>' : ''}${this.offset + result.limit < result.total ? '<button class="button" type="button" data-history-page="20">다음 →</button>' : ''}`;
    } catch (error) { if (revision === this.revision) this.root.querySelector('[data-history-status]').textContent = error.message; }
  }
  async detail(id) {
    const revision = this.detailRevision = (this.detailRevision || 0) + 1;
    const body = this.dialog.querySelector('.history-dialog-body'); body.textContent = '대화를 불러오는 중…'; this.layer.open();
    try {
      const { session, messages } = await apiRequest(`/history/sessions/${id}`);
      if (revision !== this.detailRevision || !this.dialog.open) return;
      body.innerHTML = `<p class="field-help">${esc(session.workspace)} · ${messages.length}개 메시지 · 읽기 전용 보관 사본${session.truncated ? ' · 일부 기록만 보관됨' : ''}</p>` + messages.map((message) => `<article class="history-message"><header><strong>${message.role === 'user' ? '사용자' : '에이전트'}</strong><time>${displayTime(message.timestamp)}</time></header><p>${esc(message.content)}</p></article>`).join('');
    } catch (error) { if (revision === this.detailRevision) body.textContent = error.message; }
  }
}
