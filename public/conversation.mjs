import { escapeHtml as esc, displayTime } from './model.mjs';

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
