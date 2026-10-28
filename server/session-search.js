import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { ApiError } from './office.js';
import { normalizedText, publicDialogue, redactConversation, excerpt } from './search-text.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const keyPattern = /^[a-f0-9]{64}$/;
const providers = ['openai', 'claude', 'gemini', 'meta'];
const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const invalid = () => new ApiError(400, 'INVALID_SEARCH_DATA', '검색 자료의 형식을 확인해 주세요.');
const canonicalSites = {
  openai: ['chatgpt.com', /^\/(?:g\/[^/]+\/)?c\/([a-f0-9-]{36})\/?$/i],
  claude: ['claude.ai', /^\/chat\/([a-f0-9-]{36})\/?$/i],
  gemini: ['gemini.google.com', /^\/app\/([a-f0-9]{8,64})\/?$/i],
  meta: ['www.meta.ai', /^\/prompt\/([a-f0-9-]{36})\/?$/i],
};

export function canonicalConversation(provider, value) {
  try {
    const url = new URL(value);
    const [host, pattern] = canonicalSites[provider] || [];
    const match = pattern?.exec(url.pathname);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !match
      || (url.hostname !== host && !(provider === 'meta' && url.hostname === 'meta.ai'))) return null;
    const prefix = { openai: 'c', claude: 'chat', gemini: 'app', meta: 'prompt' }[provider];
    return { originId: match[1].toLowerCase(), url: `https://${host}/${prefix}/${match[1].toLowerCase()}` };
  } catch { return null; }
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || messages.length > 1000) throw invalid();
  let characters = 0;
  const keys = new Set();
  return messages.flatMap((message, position) => {
    if (!message || !keyPattern.test(message.key) || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw invalid();
    if (keys.has(message.key)) return [];
    keys.add(message.key);
    if (!message.content.trim() || !publicDialogue(message.content)) return [];
    const content = redactConversation(message.content).slice(0, 20000);
    characters += content.length;
    if (characters > 500000) throw invalid();
    return [{ key: message.key, role: message.role, content, normalized: normalizedText(content), position,
      timestamp: validDate(message.timestamp) ? new Date(message.timestamp).toISOString() : null,
      truncated: Boolean(message.truncated || message.content.length > 20000) }];
  });
}

// Separate from office state: dialogue never enters employee state or handoff exports.
export function createSessionSearch({ directory, bridgeFile, observer, clock = Date.now } = {}) {
  if (directory) mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(directory ? join(directory, 'session-search.sqlite') : ':memory:');
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS search_sessions (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, provider TEXT NOT NULL, origin_id TEXT NOT NULL,
      workspace_key TEXT NOT NULL, workspace TEXT NOT NULL, updated_at TEXT NOT NULL,
      url TEXT, client TEXT, observed_at INTEGER, observation TEXT, truncated INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS search_messages (
      session_id TEXT NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
      key TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, normalized TEXT NOT NULL,
      timestamp TEXT, position INTEGER NOT NULL, truncated INTEGER NOT NULL,
      PRIMARY KEY(session_id, key));
    CREATE INDEX IF NOT EXISTS search_session_order ON search_sessions(updated_at DESC);
    CREATE TABLE IF NOT EXISTS search_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const imported = new Map();
  let manifest = null;
  let syncTime = -Infinity;
  let syncing;
  let collection = 'not_enabled';
  const setting = (key) => db.prepare('SELECT value FROM search_settings WHERE key=?').get(key)?.value;
  const webEnabled = () => setting('web_enabled') === 'true';
  const upsertMessage = db.prepare(`INSERT INTO search_messages VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(session_id,key)
    DO UPDATE SET role=excluded.role,content=excluded.content,normalized=excluded.normalized,timestamp=excluded.timestamp,truncated=excluded.truncated`);

  function put(record, messages, merge = false) {
    if (merge && db.prepare('SELECT truncated FROM search_sessions WHERE id=?').get(record.id)?.truncated) record.truncated = true;
    db.prepare(`INSERT INTO search_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      updated_at=excluded.updated_at,observed_at=excluded.observed_at,observation=excluded.observation,
      truncated=excluded.truncated`).run(record.id, record.source, record.provider, record.originId, record.workspaceKey || '',
      record.workspace || '', record.updatedAt, record.url || null, record.client || null, record.observedAt || null,
      record.observation || null, Number(Boolean(record.truncated || messages.some((message) => message.truncated))));
    if (!merge) db.prepare('DELETE FROM search_messages WHERE session_id=?').run(record.id);
    const base = merge ? (db.prepare('SELECT MAX(position) AS n FROM search_messages WHERE session_id=?').get(record.id).n ?? -1) + 1 : 0;
    for (const message of messages) upsertMessage.run(record.id, message.key, message.role, message.content, message.normalized,
      message.timestamp, base + message.position, Number(message.truncated));
    // Keep the latest bounded window; a partial browser render never deletes earlier captured text.
    const rows = db.prepare('SELECT key,length(content) AS size FROM search_messages WHERE session_id=? ORDER BY position DESC').all(record.id);
    let size = 0;
    for (let index = 0; index < rows.length; index += 1) {
      size += rows[index].size;
      if (index >= 1000 || size > 500000) {
        db.prepare('DELETE FROM search_messages WHERE session_id=? AND key=?').run(record.id, rows[index].key);
        db.prepare('UPDATE search_sessions SET truncated=1 WHERE id=?').run(record.id);
      }
    }
  }

  async function sync(force = false) {
    if (syncing) return syncing;
    if (!bridgeFile || (!force && clock() - syncTime < 5000)) return;
    syncTime = clock();
    syncing = (async () => {
      try {
        if ((await stat(bridgeFile)).size > 65536) throw invalid();
        const bridge = JSON.parse(await readFile(bridgeFile, 'utf8'));
        if (bridge?.schemaVersion !== 1 || !validDate(bridge.generatedAt) || !Array.isArray(bridge.sessions) || bridge.sessions.length > 24) throw invalid();
        collection = bridge.searchHistory?.enabled === true ? 'enabled' : 'not_enabled';
        if (collection !== 'enabled') return;
        const age = clock() - Date.parse(bridge.generatedAt);
        if (bridge.stopped === true || age < -5000 || age > 20000) collection = 'disconnected';
        const root = join(dirname(bridgeFile), 'search-history');
        const file = join(root, 'index.json');
        if ((await stat(file)).size > 150000) throw invalid();
        const next = JSON.parse(await readFile(file, 'utf8'));
        if (next.schemaVersion !== 1 || !keyPattern.test(next.workspaceKey) || !Array.isArray(next.items) || next.items.length > 500) throw invalid();
        manifest = { workspaceKey: next.workspaceKey, workspace: redactConversation(String(next.workspace)).slice(0, 120),
          generatedAt: validDate(next.generatedAt) ? next.generatedAt : null, limited: Boolean(next.limited), skipped: Number(next.skipped) || 0,
          sources: Array.isArray(next.sources) ? next.sources.filter((source) => providers.includes(source.provider)).map(({provider, status}) => ({ provider, status: ['ready', 'empty'].includes(status) ? status : 'unavailable' })) : [] };
        db.prepare("INSERT INTO search_settings VALUES ('workspace_key',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(next.workspaceKey);
        for (const item of next.items) {
          if (!item || !keyPattern.test(item.key) || !providers.includes(item.provider) || !validDate(item.updatedAt)) { manifest.skipped += 1; continue; }
          if (imported.get(item.key) === item.updatedAt) continue;
          try {
            const path = join(root, `${item.key}.json`);
            if ((await stat(path)).size > 3 * 1024 * 1024) throw invalid();
            const data = JSON.parse(await readFile(path, 'utf8'));
            if (data.schemaVersion !== 1 || data.source !== 'cli' || data.provider !== item.provider || data.workspaceKey !== next.workspaceKey
              || typeof data.originId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.originId)
              || hash(`${data.workspaceKey}:${data.provider}:${data.originId}`) !== item.key) throw invalid();
            const messages = cleanMessages(data.messages);
            db.exec('BEGIN');
            try { put({ ...data, id: item.key, workspace: manifest.workspace, updatedAt: item.updatedAt }, messages); db.exec('COMMIT'); }
            catch (error) { db.exec('ROLLBACK'); throw error; }
            imported.set(item.key, item.updatedAt);
          } catch { manifest.skipped += 1; }
        }
      } catch (error) { collection = error.code === 'ENOENT' && collection === 'not_enabled' ? 'not_enabled' : 'unavailable'; }
    })().finally(() => { syncing = null; });
    return syncing;
  }

  function states() {
    const snapshot = observer?.snapshot();
    return new Set(snapshot?.status === 'connected' ? snapshot.sessions.map((session) => session.id) : []);
  }
  function state(row, current) {
    if (row.source === 'cli') return current.has(row.origin_id) ? 'current' : 'stored';
    return row.observation === 'open' && clock() - row.observed_at < 30000 ? 'current' : 'stored';
  }
  function session(row, current) {
    return { id: row.id, source: row.source, provider: row.provider, name: `${{openai: row.source === 'cli' ? 'Codex' : 'ChatGPT', claude: 'Claude', gemini: 'Gemini', meta: 'Meta AI'}[row.provider]} · ${row.origin_id}`,
      workspace: row.workspace, updatedAt: row.updated_at, url: row.url, state: state(row, current),
      observation: row.source === 'web' ? (clock() - row.observed_at < 30000 ? row.observation : 'disconnected') : null, truncated: Boolean(row.truncated) };
  }
  function scopeClause() {
    return { clause: "(s.source='web' OR s.workspace_key=?)", value: manifest?.workspaceKey || setting('workspace_key') || '' };
  }

  return {
    sync,
    async status() {
      await sync();
      const scope = scopeClause();
      const counts = db.prepare(`SELECT s.source,COUNT(DISTINCT s.id) AS sessions,COUNT(m.key) AS messages FROM search_sessions s LEFT JOIN search_messages m ON m.session_id=s.id WHERE ${scope.clause} GROUP BY s.source`).all(scope.value);
      return { webEnabled: webEnabled(), collection, cli: manifest && { ...manifest, workspaceKey: undefined }, counts };
    },
    configure(input) {
      if (typeof input?.webEnabled !== 'boolean') throw invalid();
      db.prepare("INSERT INTO search_settings VALUES ('web_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(input.webEnabled));
      return { webEnabled: input.webEnabled };
    },
    importWeb(input) {
      if (!input || !['user', 'assistant'].includes(input.role) || typeof input.content !== 'string'
        || !input.content.trim() || input.content.length > 20000 || !publicDialogue(input.content)) throw invalid();
      const provider = providers.find((candidate) => canonicalConversation(candidate, input.url));
      if (!provider) throw new ApiError(400, 'INVALID_CONVERSATION_URL', 'ChatGPT·Claude·Gemini·Meta AI의 개별 대화 주소를 입력해 주세요. 서비스 첫 화면 주소는 보관할 수 없습니다.');
      // Only this explicit, bounded paste action bypasses automatic capture's switch.
      // Compute the deduplication key here: Web Crypto digest is unavailable on LAN HTTP.
      return this.receiveWeb({ clientId: input.clientId, sessions: [{ provider, url: input.url, observation: 'closed',
        messages: [{ key: hash(`${input.role}:${input.content}`), role: input.role, content: input.content }] }] }, true);
    },
    receiveWeb(input, explicitImport = false) {
      if (!explicitImport && !webEnabled()) throw new ApiError(409, 'SEARCH_CAPTURE_DISABLED', '웹 검색 보관을 먼저 켜 주세요.');
      if (!input || !/^[a-f0-9-]{36}$/.test(input.clientId) || !Array.isArray(input.sessions) || input.sessions.length > 50) throw invalid();
      // Validate the complete batch before making any mutation.
      const records = input.sessions.map((entry) => {
        const canonical = canonicalConversation(entry?.provider, entry?.url);
        if (!canonical || !['open', 'closed', 'unavailable'].includes(entry.observation)) throw invalid();
        const messages = cleanMessages(entry.messages || []);
        return { data: { id: hash(`web:${input.clientId}:${entry.provider}:${canonical.originId}`), source: 'web', provider: entry.provider,
          originId: canonical.originId, url: canonical.url, client: input.clientId, updatedAt: new Date(clock()).toISOString(),
          observedAt: clock(), observation: entry.observation, truncated: Boolean(entry.truncated) }, messages };
      });
      db.exec('BEGIN');
      try {
        for (const { data, messages } of records) {
          const old = db.prepare('SELECT updated_at FROM search_sessions WHERE id=?').get(data.id);
          if (!messages.length && !old) continue;
          if (!messages.length) data.updatedAt = old.updated_at;
          put(data, messages, true);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { accepted: records.length };
    },
    async query(input = {}) {
      await sync();
      if (!input || typeof input !== 'object') throw invalid();
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (query.length > 200) throw new ApiError(400, 'SEARCH_QUERY_TOO_LONG', '검색어는 200자 이내로 입력해 주세요.');
      const filters = { source: ['', 'cli', 'web'], provider: ['', ...providers], role: ['', 'user', 'assistant'], state: ['', 'current', 'stored'] };
      for (const [key, allowed] of Object.entries(filters)) if (input[key] !== undefined && !allowed.includes(input[key])) throw invalid();
      if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 1000000)) throw invalid();
      const scope = scopeClause();
      const clauses = [scope.clause];
      const params = [scope.value];
      for (const key of ['source', 'provider']) if (input[key]) { clauses.push(`s.${key}=?`); params.push(input[key]); }
      if (input.role) { clauses.push('m.role=?'); params.push(input.role); }
      if (query) { clauses.push('instr(m.normalized,?)>0'); params.push(normalizedText(query)); }
      const current = states();
      if (input.state) {
        const ids = [...current];
        const expression = `((s.source='cli' AND s.origin_id IN (${ids.length ? ids.map(() => '?').join(',') : "''"})) OR (s.source='web' AND s.observation='open' AND s.observed_at>?))`;
        clauses.push(input.state === 'current' ? expression : `NOT ${expression}`);
        params.push(...ids, clock() - 30000);
      }
      const where = clauses.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM search_messages m JOIN search_sessions s ON s.id=m.session_id WHERE ${where}`).get(...params).n;
      const offset = input.offset || 0;
      const rows = db.prepare(`SELECT s.*,m.key,m.role,m.content,m.timestamp,m.position FROM search_messages m JOIN search_sessions s ON s.id=m.session_id WHERE ${where} ORDER BY s.updated_at DESC,s.id,m.position DESC LIMIT 30 OFFSET ?`).all(...params, offset);
      return { query, total, offset, limit: 30, results: rows.map((row) => ({ session: session(row, current), key: row.key, role: row.role,
        timestamp: row.timestamp, snippet: excerpt(row.content, query) })) };
    },
    async history() {
      await sync();
      const rows = db.prepare("SELECT s.*,COUNT(m.key) AS messages,MAX(CASE WHEN m.position=0 THEN m.content END) AS preview FROM search_sessions s LEFT JOIN search_messages m ON m.session_id=s.id WHERE s.source='cli' GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 1000").all();
      return { collection, limited: Boolean(manifest?.limited || rows.length >= 1000), skipped: manifest?.skipped || 0,
        records: rows.map((row) => ({ id: row.id, kind: 'cli', projectId: row.workspace_key, projectName: row.workspace,
          title: excerpt(row.preview || '공개 대화 기록', '').slice(0, 160), provider: row.provider,
          updatedAt: row.updated_at, messageCount: row.messages, truncated: Boolean(row.truncated) })) };
    },
    async detail(id, { history = false } = {}) {
      await sync();
      const scope = history ? { clause: "s.source='cli' AND ?=1", value: 1 } : scopeClause();
      const row = keyPattern.test(id) && db.prepare(`SELECT s.* FROM search_sessions s WHERE s.id=? AND ${scope.clause}`).get(id, scope.value);
      if (!row) throw new ApiError(404, 'SEARCH_SESSION_NOT_FOUND', '보관된 대화를 찾을 수 없습니다.');
      return { session: session(row, states()), messages: db.prepare('SELECT key,role,content,timestamp,truncated FROM search_messages WHERE session_id=? ORDER BY position').all(id) };
    },
    close() { db.close(); },
  };
}
