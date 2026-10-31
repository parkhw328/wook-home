import { escapeHtml as esc, displayTime } from './model.mjs';

export function conversationReadError(data) {
  if (data?.status !== 'unavailable') return '';
  if (data.reason === 'outside_workspace') return '이 프로젝트의 세션은 상태만 관찰합니다. 공개 대화 읽기는 연결 설정에 표시된 작업 폴더로 한정됩니다.';
  return data.reason === 'permission_denied'
    ? '대화는 수집 중이지만 사무실 서버에 기록을 읽을 권한이 없습니다. 연결 설정의 실행 안내에서 명령을 복사해 연결 프로그램만 다시 실행하세요. 작업이 끝날 때까지 기다릴 필요는 없습니다.'
    : data.reason === 'missing_record' ? '대화 기록 파일이 아직 전달되지 않았습니다. 연결 프로그램의 수집 상태를 확인하고 다시 불러와 주세요.' : '';
}

export function filterMessages(messages, query = '', role = 'all') {
  const needle = query.trim().toLocaleLowerCase();
  return messages.filter((message) => (role === 'all' || message.role === role)
    && (!needle || message.content.toLocaleLowerCase().includes(needle)));
}

export function conversationMarkup(messages, { query = '', role = 'all', demo = false } = {}) {
  const filtered = filterMessages(messages, query, role);
  if (!filtered.length) return '<p class="terminal-empty">조건에 맞는 대화가 없습니다.</p>';
  return filtered.map((message) => `<article class="terminal-message ${message.role === 'user' ? 'user' : 'assistant'}"><header><span class="terminal-role">${message.role === 'user' ? 'YOU / Commander' : demo ? 'AGENT / 체험 응답' : 'AGENT / Codex'}</span><time>${message.createdAt || message.timestamp ? esc(displayTime(message.createdAt || message.timestamp)) : '시각 미제공'}</time></header><pre>${esc(message.content)}</pre>${message.truncated ? '<small class="terminal-limit">긴 메시지의 일부만 표시합니다.</small>' : ''}</article>`).join('');
}

// A late response from a previously selected session must not replace the current view.
export class ConversationReader {
  constructor(request, onChange) { this.request = request; this.onChange = onChange; this.id = null; this.generation = 0; this.busy = false; this.data = null; }
  select(id) {
    if (id === this.id) return;
    this.id = id;
    this.generation += 1;
    this.busy = false;
    this.data = null;
    this.onChange();
    if (id) void this.refresh();
  }
  async refresh() {
    if (!this.id || this.busy) return;
    const generation = this.generation;
    this.busy = true;
    try {
      const data = await this.request(`/local-sessions/${encodeURIComponent(this.id)}/conversation`);
      if (generation !== this.generation) return;
      this.data = data;
    } catch {
      if (generation !== this.generation) return;
      this.data = { ...(this.data || { messages: [] }), status: 'disconnected' };
    } finally {
      if (generation === this.generation) { this.busy = false; this.onChange(); }
    }
  }
}
