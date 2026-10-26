// Shared by the host collector and the local archive. Never log the input.
export function redactConversation(value) {
  return String(value)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[비밀키 숨김]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|AKIA[A-Z0-9]{16})\b/g, '[인증 정보 숨김]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[토큰 숨김]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/gi, '$1 [숨김]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|cookie|비밀번호)\s*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[숨김]')
    .replace(/[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}/gi, '[이메일 숨김]')
    .replace(/\b\d{6}-[1-4]\d{6}\b/g, '[개인정보 숨김]')
    .replace(/\b01[016789][- .]?\d{3,4}[- .]?\d{4}\b/g, '[연락처 숨김]')
    .replace(/\b[A-Z]:[\\/](?:Users|Documents and Settings)[\\/][^\s"'<>]+/gi, '[개인 경로 숨김]')
    .replace(/\/(?:Users|home)\/[^\s"'<>]+/g, '[개인 경로 숨김]')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

export const normalizedText = (value) => String(value).normalize('NFKC').toLocaleLowerCase('en-US');
export const publicDialogue = (value) => !/^\s*(?:# AGENTS\.md instructions|<environment_context>|<INSTRUCTIONS>|<permissions instructions>|<system-reminder>)/i.test(value);
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

export function excerpt(content, query, length = 240) {
  const normalized = normalizedText(content);
  const match = normalized.indexOf(normalizedText(query));
  let index = Math.max(0, match);
  let normalizedOffset = 0;
  // NFKC can expand ligatures and compose Korean Jamo. Map the match back to
  // the original text instead of slicing it with an offset from normalized text.
  if (match > 0 && normalized !== content) {
    for (const part of graphemes.segment(content)) {
      normalizedOffset += normalizedText(part.segment).length;
      index = part.index;
      if (normalizedOffset > match) break;
    }
  }
  const start = Math.max(0, index - 65);
  return `${start ? '…' : ''}${content.slice(start, start + length)}${start + length < content.length ? '…' : ''}`;
}
