import { ApiError } from './office.js';
import { cliProcessScope } from './cli-processes.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const labels = { openai: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', meta: 'Meta AI' };
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
const TTL = 90000;

// Ephemeral observations only: no DB, file, handoff, or raw provider URL.
export function createDiscovery({ observer, clock = Date.now }) {
  const clients = new Map();
  return {
    receive(input) {
      const invalid = () => new ApiError(400, 'INVALID_DISCOVERY', '웹 감지 데이터 형식을 확인해 주세요.');
      if (!exactKeys(input, ['schemaVersion', 'clientId', 'observedAt', 'truncated', 'tabs'])
        || input.schemaVersion !== 1 || typeof input.clientId !== 'string' || !UUID.test(input.clientId) || !validTime(input.observedAt)
        || typeof input.truncated !== 'boolean' || !Array.isArray(input.tabs) || input.tabs.length > 128) throw invalid();
      const now = clock();
      const observed = Date.parse(input.observedAt);
      if (now - observed > TTL || observed - now > 5000) throw invalid();
      const seen = new Set();
      const tabs = input.tabs.map((tab) => {
        if (!exactKeys(tab, ['id', 'provider', 'kind', 'key']) || typeof tab.id !== 'string' || !/^(0|[1-9]\d{0,10})$/.test(tab.id)
          || !Object.hasOwn(labels, tab.provider) || !['conversation', 'page'].includes(tab.kind) || typeof tab.key !== 'string' || !HASH.test(tab.key)
          || seen.has(tab.id)) throw invalid();
        seen.add(tab.id);
        return { id: tab.id, provider: tab.provider, kind: tab.kind, key: tab.key };
      });
      const previous = clients.get(input.clientId);
      if (previous && observed <= previous.observed) return { accepted: false, reason: 'outdated' };
      // Evict old profiles rather than accumulating their history indefinitely.
      for (const [id, value] of clients) if (now - value.received > 3600000) clients.delete(id);
      if (!clients.has(input.clientId) && clients.size >= 8) throw new ApiError(429, 'DISCOVERY_LIMIT', '브라우저 연결 수 한도에 도달했습니다.');
      clients.set(input.clientId, { tabs, observed, received: now, truncated: input.truncated });
      return { accepted: true };
    },
    forget(id) {
      if (!UUID.test(id)) throw new ApiError(400, 'INVALID_DISCOVERY', '브라우저 연결을 확인해 주세요.');
      clients.delete(id);
      return { removed: true };
    },
    snapshot() {
      const now = clock();
      const cli = observer.snapshot();
      const entries = cli.sessions.map((session) => ({
        id: `cli:${session.id}`, name: session.name, provider: session.provider, source: 'cli', kind: 'session',
        status: session.status, lifecycle: session.lifecycle || 'unknown',
        lastActivityAt: session.lastActivityAt, scope: session.workspace || (session.outsideWorkspace ? '' : cli.workspace), sessionId: session.id,
        ...(session.workspaceKey ? { workspace: session.workspace, workspaceKey: session.workspaceKey } : {}),
        tabCount: 0, canControl: cli.control?.enabled === true && session.canControl !== false,
      }));
      for (const item of cli.processes?.items || []) {
        entries.push({
          id: `process:${item.id}`, name: item.name, provider: item.provider, source: 'cli', kind: 'process',
          status: item.status, scope: cliProcessScope(cli.processes), startedAt: item.startedAt, endedAt: item.endedAt,
          lastActivityAt: null, updatedAt: cli.processes.updatedAt, tabCount: 0, canControl: false,
        });
      }
      const browsers = [];
      for (const [clientId, client] of clients) {
        if (now - client.received > 3600000) { clients.delete(clientId); continue; }
        const connected = now - client.observed <= TTL;
        browsers.push({ id: clientId, status: connected ? 'connected' : 'disconnected', updatedAt: new Date(client.observed).toISOString(), truncated: client.truncated });
        const groups = new Map();
        for (const tab of client.tabs) {
          const key = `${tab.provider}:${tab.kind}:${tab.key}`;
          if (groups.has(key)) { groups.get(key).tabCount += 1; continue; }
          groups.set(key, {
            id: `web:${clientId}:${key}`, provider: tab.provider, source: 'web', kind: tab.kind,
            name: `${labels[tab.provider]} · ${tab.key.slice(0, 6)}`, status: connected ? 'open' : 'disconnected',
            scope: `브라우저 ${clientId.slice(0, 4)}`, lastActivityAt: null, updatedAt: new Date(client.observed).toISOString(),
            tabCount: 1, canControl: false,
          });
        }
        entries.push(...groups.values());
      }
      entries.sort((a, b) => a.id.localeCompare(b.id));
      const liveWeb = entries.filter((entry) => entry.source === 'web' && entry.status === 'open');
      return {
        sources: { cli: { status: cli.status, workspace: cli.workspace, updatedAt: cli.updatedAt },
          processes: { status: cli.processes?.status || 'not_connected', updatedAt: cli.processes?.updatedAt || null,
            platform: cli.processes?.platform || 'unknown', scope: cliProcessScope(cli.processes) }, browsers }, entries,
        counts: { cli: cli.sessions.length, cliProcesses: entries.filter((entry) => entry.kind === 'process' && entry.status === 'running').length,
          webTabs: liveWeb.reduce((sum, item) => sum + item.tabCount, 0),
          webConversations: liveWeb.filter((item) => item.kind === 'conversation').length,
          webPages: liveWeb.filter((item) => item.kind === 'page').length },
      };
    },
  };
}
