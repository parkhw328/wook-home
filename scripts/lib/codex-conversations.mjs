import { redactConversation } from '../../server/search-text.js';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Only the visible user/assistant dialogue is exported. Never include reasoning,
// system/developer instructions, tool calls, tool output, or session metadata.
const maxMessages = 60;
const maxCharacters = 24000;
const maxMessageCharacters = 4000;

export { redactConversation } from '../../server/search-text.js';

export function collectConversation(records, partial = false) {
  const messages = [];
  // Codex emits event_msg as well as response_item for the same public message.
  // Prefer response_item when present, falling back only for an event-only log.
  const responseMessages = records.filter((record) => record?.type === 'response_item'
    && record.payload?.type === 'message' && ['user', 'assistant'].includes(record.payload.role)
    && (!record.payload.channel || ['final', 'commentary'].includes(record.payload.channel)));
  const source = responseMessages.length ? responseMessages : records.filter((record) => record?.type === 'event_msg'
    && ['user_message', 'agent_message'].includes(record.payload?.type));
  for (const record of source) {
    if (!Number.isFinite(Date.parse(record.timestamp))) continue;
    const payload = record.payload;
    const role = payload.role || (payload.type === 'user_message' ? 'user' : 'assistant');
    const content = record.type === 'response_item'
      ? (Array.isArray(payload.content) ? payload.content.filter((part) => ['input_text', 'output_text', 'text'].includes(part?.type) && typeof part.text === 'string').map((part) => part.text).join('\n') : '')
      : (typeof payload.message === 'string' ? payload.message : '');
    if (!content.trim() || /^\s*(?:# AGENTS\.md instructions|<environment_context>|<INSTRUCTIONS>|<permissions instructions>)/i.test(content)) continue;
    const safe = redactConversation(content);
    const previous = messages.at(-1);
    if (previous?.role === role && previous.content === safe && previous.timestamp === record.timestamp) continue;
    messages.push({ role, timestamp: new Date(record.timestamp).toISOString(), content: safe.slice(0, maxMessageCharacters), truncated: safe.length > maxMessageCharacters });
  }
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let truncated = partial || messages.length > maxMessages || messages.some((message) => message.truncated);
  const recent = messages.slice(-maxMessages);
  let size = recent.reduce((sum, message) => sum + message.content.length, 0);
  while (size > maxCharacters && recent.length > 1) { size -= recent.shift().content.length; truncated = true; }
  return { messages: recent, truncated, limit: maxMessages };
}

export async function publishConversations(snapshot, directory, enabled) {
  const retained = new Set();
  if (enabled) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const session of snapshot.sessions) {
      if (!session.conversation) continue;
      const name = `${session.id}.json`;
      const destination = join(directory, name);
      const temporary = destination + '.tmp';
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, sessionId: session.id, generatedAt: snapshot.generatedAt, ...session.conversation }), { mode: 0o600 });
      await rename(temporary, destination);
      retained.add(name);
      delete session.conversation;
    }
  }
  // Remove only bridge-owned snapshots. Never modify the original Codex logs.
  let names;
  try { names = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const name of names) {
    if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json(?:\.tmp)?$/i.test(name) && !retained.has(name)) await rm(join(directory, name), { force: true });
  }
}
