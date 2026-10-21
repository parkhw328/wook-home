import { createReadStream } from 'node:fs';
import { open, readdir, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { publicDialogue, redactConversation } from '../../server/search-text.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const samePath = (a, b) => typeof a === 'string' && (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
const textParts = (content) => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter((part) => part && !part.thought && (!part.type || ['text', 'input_text', 'output_text'].includes(part.type)) && typeof part.text === 'string').map((part) => part.text).join('\n') : '';

function dialogueBuffer() {
  const messages = new Map();
  let truncated = false;
  let characters = 0;
  return {
    push(id, role, content, timestamp) {
      if (!['user', 'assistant'].includes(role) || !content.trim() || !publicDialogue(content)) return;
      const safe = redactConversation(content);
      const key = hash(String(id));
      const value = { key, role, content: safe.slice(0, 20000), timestamp: Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : null, truncated: safe.length > 20000 };
      characters -= messages.get(key)?.content.length || 0;
      messages.set(key, value);
      characters += value.content.length;
      while (messages.size > 1000 || characters > 500000) { const oldest = messages.keys().next().value; characters -= messages.get(oldest).content.length; messages.delete(oldest); truncated = true; }
      truncated ||= value.truncated;
    },
    patch(id, content) { const old = messages.get(hash(String(id))); if (old) this.push(id, old.role, content, old.timestamp); },
    remove(id) { const key = hash(String(id)); characters -= messages.get(key)?.content.length || 0; messages.delete(key); },
    clear() { messages.clear(); characters = 0; },
    rewind(id) { let remove = false; for (const key of [...messages.keys()]) { if (remove) { characters -= messages.get(key).content.length; messages.delete(key); } if (key === hash(String(id))) remove = true; } },
    partial() { truncated = true; },
    result() { return { messages: [...messages.values()], truncated }; },
  };
}

async function headerRecords(file) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').split('\n').map(parse).filter(Boolean);
  } finally { await handle.close(); }
}

// Only public text is extracted. Source files remain untouched, including closed sessions.
export async function readSearchHistory(file, provider, workspace) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 128 * 1024 * 1024) return { skipped: 'size_limit' };
  const headers = await headerRecords(file);
  let originId;
  let jsonDocument;
  if (provider === 'openai') {
    const metadata = headers.find((record) => record.type === 'session_meta')?.payload;
    if (!samePath(metadata?.cwd, workspace)) return null;
    originId = metadata.id;
  } else if (provider === 'claude') {
    const metadata = headers.find((record) => record.cwd && record.sessionId);
    if (!samePath(metadata?.cwd, workspace) || metadata.isSidechain) return null;
    originId = metadata.sessionId;
  } else if (provider === 'gemini') {
    const projectHashes = [hash(resolve(workspace)), hash(resolve(workspace).replace(/\\/g, '/'))];
    if (file.endsWith('.json')) {
      if (info.size > 8 * 1024 * 1024) return { skipped: 'size_limit' };
      const handle = await open(file, 'r');
      try { jsonDocument = parse(await handle.readFile('utf8')); } finally { await handle.close(); }
    }
    const metadata = jsonDocument || headers.find((record) => record.projectHash);
    if (!metadata || !projectHashes.includes(metadata.projectHash) || metadata.kind === 'subagent') return null;
    originId = metadata.sessionId;
  } else return null;
  if (!validId(originId)) return null;
  const dialogue = dialogueBuffer();
  const events = dialogueBuffer();
  let responseCount = 0;
  let lineNumber = 0;
  const geminiMessage = (message) => {
    if (!message || !['user', 'gemini'].includes(message.type)) return;
    dialogue.push(message.id || `line-${lineNumber}`, message.type === 'user' ? 'user' : 'assistant', textParts(message.displayContent ?? message.content), message.timestamp);
  };
  if (jsonDocument) for (const message of jsonDocument.messages || []) { lineNumber += 1; geminiMessage(message); }
  else {
    const stream = createReadStream(file, { encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        lineNumber += 1;
        if (line.length > 2 * 1024 * 1024) { dialogue.partial(); continue; }
        const record = parse(line);
        if (!record) { if (line.trim()) dialogue.partial(); continue; }
        if (provider === 'openai') {
          const payload = record.payload;
          if (record.type === 'response_item' && payload?.type === 'message' && ['user', 'assistant'].includes(payload.role)
            && (!payload.channel || ['final', 'commentary'].includes(payload.channel))) {
            responseCount += 1;
            dialogue.push(payload.id || `line-${lineNumber}`, payload.role, textParts(payload.content), record.timestamp);
          } else if (record.type === 'event_msg' && ['user_message', 'agent_message'].includes(payload?.type)) {
            events.push(`line-${lineNumber}`, payload.type === 'user_message' ? 'user' : 'assistant', typeof payload.message === 'string' ? payload.message : '', record.timestamp);
          }
        } else if (provider === 'claude') {
          if (record.isSidechain || record.isMeta || !samePath(record.cwd, workspace) || record.sessionId !== originId || !['user', 'assistant'].includes(record.type)) continue;
          dialogue.push(record.uuid || `line-${lineNumber}`, record.type, textParts(record.message?.content), record.timestamp);
        } else {
          geminiMessage(record);
          if (Array.isArray(record.$set?.messages)) { dialogue.clear(); for (const message of record.$set.messages) geminiMessage(message); }
          if (record.$patch) {
            const updates = record.$patch.updates || [record.$patch];
            for (const update of updates) if (update.id && update.content !== undefined) dialogue.patch(update.id, textParts(update.content));
            for (const id of record.$patch.removeIds || []) dialogue.remove(id);
          }
          if (record.$rewindTo) dialogue.rewind(record.$rewindTo);
        }
      }
    } finally { lines.close(); stream.destroy(); }
  }
  const result = provider === 'openai' && !responseCount ? events.result() : dialogue.result();
  return { source: 'cli', provider, originId, workspaceKey: hash(process.platform === 'win32' ? resolve(workspace).toLowerCase() : resolve(workspace)), workspace: basename(resolve(workspace)), updatedAt: info.mtime.toISOString(), ...result };
}

async function filesUnder(directory, pattern, depth, result, budget) {
  if (depth < 0 || budget.remaining <= 0) return;
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
    if (budget.remaining-- <= 0) return;
    if (entry.isSymbolicLink()) continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await filesUnder(file, pattern, depth - 1, result, budget);
    else if (entry.isFile() && pattern.test(entry.name)) result.push(file);
  }
}

export function createSearchHistoryCollector({ workspace, sessionsDir, archiveDir = join(resolve(sessionsDir, '..'), 'archived_sessions'), claudeDir = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects'), geminiDir = join(process.env.GEMINI_CLI_HOME || homedir(), '.gemini', 'tmp'), output, clock = Date.now }) {
  const cache = new Map();
  let busy;
  return {
    collect() {
      if (busy) return busy;
      busy = (async () => {
        await mkdir(output, { recursive: true, mode: 0o700 });
        const candidates = [];
        const sources = [];
        let skipped = 0;
        let limited = false;
        for (const [provider, directories, pattern, depth] of [
          ['openai', [sessionsDir, archiveDir], /^rollout-.*\.jsonl$/, 3],
          ['claude', [claudeDir], /^[a-f0-9-]{36}\.jsonl$/i, 1],
          ['gemini', [...new Set([hash(resolve(workspace)), hash(resolve(workspace).replace(/\\/g, '/'))])].map((key) => join(geminiDir, key, 'chats')), /^session-.*\.jsonl?$/, 0],
        ]) {
          try {
            const files = [];
            const budget = { remaining: 20000 };
            for (const directory of directories) await filesUnder(directory, pattern, depth, files, budget);
            limited ||= budget.remaining <= 0;
            for (const file of files) { try { const info = await stat(file); candidates.push({ provider, file, modified: info.mtimeMs, size: info.size }); } catch { skipped += 1; } }
            sources.push({ provider, status: files.length ? 'ready' : 'empty' });
          } catch { sources.push({ provider, status: 'unavailable' }); }
        }
        candidates.sort((a, b) => b.modified - a.modified);
        const items = [];
        for (const item of candidates) {
          if (items.length >= 500) { limited = true; break; }
          try {
            const fingerprint = `${item.modified}:${item.size}`;
            let record = cache.get(item.file);
            if (record?.fingerprint !== fingerprint) record = { fingerprint, data: await readSearchHistory(item.file, item.provider, workspace) };
            cache.set(item.file, record);
            const data = record.data;
            if (data?.skipped) { skipped += 1; continue; }
            if (!data?.messages.length) continue;
            const key = hash(`${data.workspaceKey}:${item.provider}:${data.originId}`);
            if (items.some((entry) => entry.key === key)) continue;
            if (record.published !== fingerprint) {
              await writeFile(join(output, `${key}.json.tmp`), JSON.stringify({ schemaVersion: 1, ...data }), { mode: 0o600 });
              await rename(join(output, `${key}.json.tmp`), join(output, `${key}.json`));
              record.published = fingerprint;
            }
            items.push({ key, provider: item.provider, updatedAt: data.updatedAt });
          } catch { skipped += 1; }
        }
        const paths = new Set(candidates.map((item) => item.file));
        for (const file of cache.keys()) if (!paths.has(file)) cache.delete(file);
        const manifest = { schemaVersion: 1, enabled: true, generatedAt: new Date(clock()).toISOString(), workspaceKey: hash(process.platform === 'win32' ? resolve(workspace).toLowerCase() : resolve(workspace)), workspace: basename(resolve(workspace)), sources, limited, skipped, items };
        await writeFile(join(output, 'index.json.tmp'), JSON.stringify(manifest), { mode: 0o600 });
        await rename(join(output, 'index.json.tmp'), join(output, 'index.json'));
        return manifest;
      })().finally(() => { busy = null; });
      return busy;
    },
  };
}
