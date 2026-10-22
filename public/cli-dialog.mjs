import { DialogLayer } from './dialog-layer.mjs';
import { ConversationReader, conversationMarkup } from './conversation.mjs';
import { escapeHtml as esc, orderedLocalSessions, observedSessionStatus, sessionStatusLabel } from './model.mjs';

export class CliConversationDialog {
  constructor({ request, getState, onCommand, onAgent }) {
    this.getState = getState;
    this.drafts = new Map();
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'cli-conversation-dialog';
    this.dialog.className = 'cli-conversation-dialog';
    this.dialog.setAttribute('aria-labelledby', 'cli-dialog-title');
    this.dialog.innerHTML = `<header class="cli-dialog-header dialog-layer-header"><div><p class="eyebrow">CLI CONVERSATION</p><h2 id="cli-dialog-title">CLI 대화기록</h2></div><button type="button" class="button" data-cli-close data-layer-close aria-label="CLI 대화기록 닫기">닫기 ×</button></header><div class="dialog-layer-body"><p id="cli-dialog-state"></p><details class="cli-dialog-options"><summary>세션 · 검색 · 작성자 필터</summary><div class="cli-dialog-controls"><label>세션<select id="cli-dialog-session"></select></label><label>대화에서 찾기<input type="search" id="cli-dialog-query" placeholder="검색어 입력" autocomplete="off"></label><label>작성자<select id="cli-dialog-role"><option value="all">모든 역할</option><option value="user">사용자</option><option value="assistant">에이전트</option></select></label></div></details><div class="cli-dialog-actions"><button type="button" class="button button-small" data-cli-latest>최신 기록 ↓</button><button type="button" class="button button-small" data-cli-refresh>새로고침</button><button type="button" class="button button-primary button-small" data-cli-command>이 세션에 지시</button><button type="button" class="button button-small" data-cli-agent hidden>직원 정보</button></div><p id="cli-dialog-notice" role="status"></p><div id="cli-dialog-log" class="cli-dialog-log" tabindex="0" aria-label="CLI 공개 대화기록"></div><footer><span id="cli-dialog-scope"></span><span>창을 닫아도 CLI 작업은 계속됩니다.</span><a class="inline-link" href="#search" data-cli-library>전체 자료 검색 ↗</a><a class="inline-link" href="#connection-settings" data-open-connection-settings data-cli-settings>대화 · 지시 설정</a><a href="https://github.com/parkhw328/wook-home/wiki/CLI" target="_blank" rel="noopener noreferrer">연결 안내 ↗</a></footer></div>`;
    document.body.append(this.dialog);
    this.find = (selector) => this.dialog.querySelector(selector);
    this.reader = new ConversationReader(request, () => this.render());
    this.find('.cli-dialog-options').open = !window.matchMedia('(max-width: 650px)').matches;
    this.layer = new DialogLayer(this.dialog, { onClose: () => {
      this.save(); clearInterval(this.timer); this.reader.select(null);
    } });
    this.find('#cli-dialog-query').addEventListener('input', () => this.render(true));
    this.find('#cli-dialog-role').addEventListener('change', () => this.render(true));
    this.find('#cli-dialog-session').addEventListener('change', (event) => this.open(event.target.value));
    this.find('[data-cli-refresh]').addEventListener('click', () => this.reader.refresh());
    this.find('[data-cli-latest]').addEventListener('click', () => { const log = this.find('#cli-dialog-log'); log.scrollTop = log.scrollHeight; });
    this.find('[data-cli-command]').addEventListener('click', () => { onCommand(this.id); });
    this.find('[data-cli-agent]').addEventListener('click', () => { onAgent(this.agentId); });

  }

  save() {
    if (this.id) this.drafts.set(this.id, { query: this.find('#cli-dialog-query').value, role: this.find('#cli-dialog-role').value,
      scroll: this.find('#cli-dialog-log').scrollTop, bodyScroll: this.find('.dialog-layer-body').scrollTop, data: this.reader.data });
  }

  open(id) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) return;
    if (this.dialog.open) this.save();
    this.id = id;
    const saved = this.drafts.get(id);
    this.find('#cli-dialog-query').value = saved?.query || '';
    this.find('#cli-dialog-role').value = saved?.role || 'all';
    this.restoreScroll = saved?.scroll ?? null;
    this.find('#cli-dialog-log').dataset.signature = '';
    this.layer.open();
    this.reader.select(id);
    if (saved?.data && !this.reader.data) this.reader.data = saved.data;
    this.render();
    clearInterval(this.timer);
    this.timer = setInterval(() => { this.update(); this.reader.refresh(); }, 5000);
    this.find('.dialog-layer-body').scrollTop = saved?.bodyScroll || 0;
  }

  close() { this.layer.close(); }
  update() { if (this.dialog.open) this.render(); }

  render(reset = false) {
    if (!this.dialog.open || !this.id) return;
    const { state, connected } = this.getState();
    const sessions = orderedLocalSessions(state.localSessions);
    const session = sessions.find((item) => item.id === this.id);
    const options = sessions.some((item) => item.id === this.id) ? sessions : [...sessions, { id: this.id, name: `Codex · ${this.id.slice(-4)} (보관 중)` }];
    const select = this.find('#cli-dialog-session');
    const markup = options.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    if (select.dataset.signature !== markup) { select.innerHTML = markup; select.dataset.signature = markup; }
    select.value = this.id;
    this.find('#cli-dialog-state').textContent = `${session?.name || `Codex · ${this.id.slice(-4)}`} · ${state.localSessions?.workspace || '선택한 프로젝트'} · ${session ? sessionStatusLabel(observedSessionStatus(state.localSessions, session, connected)) : '현재 관찰 목록에서 벗어남'}`;
    this.agentId = state.agents.find((agent) => agent.connection?.sessionId === this.id)?.id;
    this.find('[data-cli-agent]').hidden = !this.agentId;
    this.find('[data-cli-command]').disabled = !session || !connected;
    const data = this.reader.data;
    const notes = {
      disabled: '공개 대화 읽기가 꺼져 있습니다. 아래 대화 · 지시 설정에서 켜고 저장해 주세요.',
      empty: '아직 수집된 공개 메시지가 없습니다.',
      unavailable: '현재 기록을 읽을 수 없습니다. 종료된 과거 기록은 전체 자료 검색에서 확인하세요.',
      disconnected: '연결이 끊겼거나 갱신이 멈췄습니다. 마지막으로 받은 내용을 표시합니다.',
    };
    const status = connected ? data?.status : 'disconnected';
    this.find('#cli-dialog-notice').textContent = !data ? '대화기록을 불러오는 중입니다.' : notes[status] || `최근 ${data.messages.length}개 메시지 · 5초마다 갱신`;
    this.find('#cli-dialog-scope').textContent = `선택한 프로젝트 · 최근 최대 60개 공개 메시지${data?.truncated ? ' · 이전 내용 또는 긴 메시지 일부 생략' : ''}`;
    const log = this.find('#cli-dialog-log');
    const content = data?.messages?.length ? conversationMarkup(data.messages, { query: this.find('#cli-dialog-query').value, role: this.find('#cli-dialog-role').value })
      : `<p class="terminal-empty">${esc(!data ? '기록을 기다리는 중입니다.' : notes[status] || '아직 대화가 없습니다.')}</p>`;
    if (log.dataset.signature !== content || reset) {
      const scroll = log.scrollTop;
      const atBottom = log.scrollHeight - scroll - log.clientHeight < 40;
      log.innerHTML = content; log.dataset.signature = content;
      if (this.restoreScroll !== null && data) { log.scrollTop = this.restoreScroll; this.restoreScroll = null; }
      else log.scrollTop = reset ? 0 : atBottom ? log.scrollHeight : scroll;
    }
  }
}
