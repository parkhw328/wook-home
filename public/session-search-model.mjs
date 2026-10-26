export const escapeSearchText = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

export function highlightedText(content, query) {
  if (!query) return escapeSearchText(content);
  // A grapheme may compose several code points (decomposed Hangul or accents).
  // Map normalized matches back to complete source graphemes, including expansions.
  let normalized = '';
  const starts = [];
  const ends = [];
  for (const { segment, index } of graphemes.segment(String(content))) {
    const value = segment.normalize('NFKC');
    for (let i = 0; i < value.toLocaleLowerCase('en-US').length; i += 1) { starts.push(index); ends.push(index + segment.length); }
    normalized += value;
  }
  // Lowercase the complete text so contextual forms such as final sigma match
  // the server's normalization; the offset map already accounts for expansions.
  normalized = normalized.toLocaleLowerCase('en-US');
  const needle = query.normalize('NFKC').toLocaleLowerCase('en-US');
  if (!needle) return escapeSearchText(content);
  let cursor = 0;
  let end = 0;
  let output = '';
  let index;
  while ((index = normalized.indexOf(needle, cursor)) !== -1) {
    const start = Math.max(end, starts[index]);
    const next = ends[index + needle.length - 1];
    output += escapeSearchText(content.slice(end, start));
    if (next > start) output += `<mark>${escapeSearchText(content.slice(start, next))}</mark>`;
    end = next;
    cursor = index + needle.length;
  }
  return output + escapeSearchText(content.slice(end));
}

export function resultMarkup(item, query) {
  const { session } = item;
  const provider = { openai: 'OpenAI', claude: 'Claude', gemini: 'Gemini', meta: 'Meta AI' }[session.provider] || session.provider;
  return `<article class="search-result"><div class="search-result-meta"><span>${escapeSearchText(provider)} · ${session.source === 'cli' ? 'CLI' : 'WEB'}</span><span>${session.state === 'current' ? '현재 확인' : '보관 기록'}</span><span>${item.role === 'user' ? '사용자' : '에이전트'}</span></div><button type="button" class="search-result-open" data-search-session="${escapeSearchText(session.id)}" data-search-message="${escapeSearchText(item.key)}">${escapeSearchText(session.name)} <span aria-hidden="true">↗</span></button><p class="search-snippet">${highlightedText(item.snippet, query)}</p><p class="search-result-date">${escapeSearchText(item.timestamp ? new Date(item.timestamp).toLocaleString('ko-KR') : '메시지 시각 정보 없음')}${session.workspace ? ` · ${escapeSearchText(session.workspace)}` : ''}${session.truncated ? ' · 일부 기록' : ''}</p></article>`;
}

// Late responses must never overwrite a newer query or a selected conversation.
export class SearchRequest {
  generation = 0;
  controller;
  cancel() { this.generation += 1; this.controller?.abort(); }
  async run(read) {
    const generation = ++this.generation;
    this.controller?.abort();
    this.controller = new AbortController();
    try {
      const value = await read(this.controller.signal);
      return generation === this.generation ? { value } : null;
    } catch (error) {
      if (generation !== this.generation) return null;
      throw error;
    }
  }
}
