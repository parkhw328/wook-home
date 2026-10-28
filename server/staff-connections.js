import { ApiError } from './office.js';
import { createHash } from 'node:crypto';

const labels = { connected: '연결 관찰', disconnected: '감지 연결 끊김', missing: '감지 대상 없음', ended: '종료 감지', unknown: '확인 필요', not_connected: '다시 연결 필요' };
const fail = (status, code, message) => { throw new ApiError(status, code, message); };

function input(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !keys.includes(key))
    || typeof body.entryId !== 'string' || !body.entryId || body.entryId.length > 240) {
    fail(400, 'INVALID_STAFF_CONNECTION', '감지 목록에서 연결할 대상을 선택해 주세요.');
  }
}

function observationStatus(entry, snapshot, reference = entry) {
  const sourceConnected = reference.source === 'web'
    ? snapshot.sources.browsers.some((browser) => reference.id.startsWith(`web:${browser.id}:`) && browser.status === 'connected')
    : snapshot.sources[reference.kind === 'process' ? 'processes' : 'cli'].status === 'connected';
  if (!sourceConnected) return 'disconnected';
  if (!entry) return 'missing';
  if (entry.kind === 'process') return entry.status === 'running' ? 'connected' : entry.status === 'exited' ? 'ended' : 'unknown';
  if (entry.status === 'disconnected') return 'disconnected';
  return 'connected';
}

const registrationKey = (entry) => entry?.source === 'cli' && entry.kind === 'session'
  ? createHash('sha256').update(`${entry.provider}:${entry.sessionId.toLowerCase()}`).digest('hex') : null;

// Raw live identifiers stay in memory. The office keeps opaque registration
// keys locally so aliases and explicit opt-outs survive a server restart.
export function createStaffConnections({ office, discovery, observer }) {
  const links = new Map();

  function requireAgent(id) {
    const agent = office.snapshot().agents.find((item) => item.id === id);
    if (!agent) fail(404, 'NOT_FOUND', '직원을 찾을 수 없습니다.');
    return agent;
  }

  function ownerOf(entryId) {
    for (const [agentId, reference] of links) if (reference.id === entryId) return agentId;
    return null;
  }

  function registeredOwner(entry) {
    return ownerOf(entry.id) || (registrationKey(entry) ? office.sessionRegistration(registrationKey(entry)) : null);
  }

  function requireEntry(entryId, agentId = null) {
    const snapshot = discovery.snapshot();
    const entry = snapshot.entries.find((item) => item.id === entryId);
    if (!entry || observationStatus(entry, snapshot) !== 'connected') fail(409, 'ENTRY_UNAVAILABLE', '대상이 더 이상 감지되지 않습니다. 목록을 새로고침하고 다시 선택해 주세요.');
    if (registeredOwner(entry) && registeredOwner(entry) !== agentId) fail(409, 'ENTRY_ALREADY_LINKED', '이미 다른 직원에게 연결되어 있습니다. 목록에서 해당 직원을 확인해 주세요.');
    return entry;
  }

  function remember(agentId, entry) {
    office.observeProject(agentId, entry.source === 'cli' && entry.kind === 'session' ? observer?.snapshot() : null);
    links.set(agentId, { id: entry.id, source: entry.source, kind: entry.kind, ...(entry.sessionId ? { sessionId: entry.sessionId } : {}) });
  }

  function reconcile(snapshot) {
    for (const entry of snapshot.entries) {
      if (entry.source !== 'cli' || entry.kind !== 'session' || entry.lifecycle !== 'live'
        || observationStatus(entry, snapshot) !== 'connected' || ownerOf(entry.id)) continue;
      const key = registrationKey(entry);
      const owner = office.sessionRegistration(key);
      if (owner === null) continue; // Explicitly detached/released by the user.
      if (owner) {
        const agent = office.snapshot().agents.find((item) => item.id === owner);
        if (agent && !links.has(owner)) remember(owner, entry);
        continue;
      }
      // Legacy employees have no session key. Do not guess their identity or
      // silently duplicate them while they await an explicit reconnection.
      if (office.snapshot().agents.some((agent) => agent.provider === entry.provider && agent.connectionPreference?.kind === 'session'
        && !links.has(agent.id) && !office.hasSessionRegistration(agent.id))) continue;
      try {
        const agent = office.hire({ name: 'Codex 직원', role: '현재 프로젝트 세션', provider: entry.provider },
          { source: 'cli', kind: 'session' }, null, key);
        remember(agent.id, entry);
      } catch (error) {
        if (error.code !== 'LIMIT_REACHED') throw error;
        // Keep the target available in the unregistered list at the staff cap.
      }
    }
  }

  function project(agent, snapshot, paused) {
    const { connectionPreference: preference, ...output } = agent;
    const reference = links.get(agent.id);
    if (!reference && !preference) return output;
    const entry = reference ? snapshot.entries.find((item) => item.id === reference.id)
      : snapshot.entries.find((item) => registeredOwner(item) === agent.id);
    const status = reference ? observationStatus(entry, snapshot, reference) : 'not_connected';
    const connected = status === 'connected';
    const canControl = connected && !agent.workArchive?.stored && !paused && entry?.source === 'cli' && entry.kind === 'session' && entry.canControl === true;
    output.connection = {
      source: reference?.source || preference.source, kind: reference?.kind || preference.kind,
      status, statusLabel: connected && entry?.kind === 'session'
        ? entry.lifecycle === 'live' ? '살아 있는 세션' : entry.lifecycle === 'not_loaded' ? '저장 기록 · 현재 적재되지 않음' : '세션 생존 확인 필요'
        : labels[status], canControl,
      ...(reference ? { entryId: reference.id } : {}),
      ...(entry ? { name: entry.name, scope: entry.scope, tabCount: entry.tabCount,
        updatedAt: entry.updatedAt || entry.lastActivityAt || null } : {}),
      ...(reference?.sessionId || entry?.sessionId ? { sessionId: reference?.sessionId || entry.sessionId, lifecycle: connected ? entry?.lifecycle || 'unknown' : 'unknown' } : {}),
    };
    output.status = connected ? 'observing' : status === 'unknown' ? 'unknown' : 'disconnected';
    return output;
  }

  function currentAgent(id) {
    const state = office.snapshot();
    return project(requireAgent(id), discovery.snapshot(), state.office.paused);
  }

  return {
    snapshot() {
      const observed = discovery.snapshot();
      reconcile(observed);
      const state = office.snapshot();
      return { ...state, agents: state.agents.map((agent) => project(agent, observed, state.office.paused)) };
    },
    discoverySnapshot() {
      const snapshot = discovery.snapshot();
      reconcile(snapshot);
      const agents = office.snapshot().agents;
      return { ...snapshot, entries: snapshot.entries.map((entry) => {
        const agent = agents.find((item) => item.id === registeredOwner(entry));
        return { ...entry, linkedAgentId: agent?.id || null, linkedAgentName: agent?.name || null,
          canRegister: !agent && observationStatus(entry, snapshot) === 'connected' };
      }) };
    },
    hire(body) {
      input(body, ['entryId', 'name', 'role', 'projectName']);
      const entry = requireEntry(body.entryId);
      const agent = office.hire({ name: body.name, role: body.role, provider: entry.provider, projectName: body.projectName }, { source: entry.source, kind: entry.kind }, null, registrationKey(entry));
      remember(agent.id, entry);
      return currentAgent(agent.id);
    },
    release(id, body) {
      const result = office.releaseAgent(id, body);
      links.delete(id);
      return result;
    },
    restore(id, body) {
      office.restoreAgent(id, body);
      return currentAgent(id);
    },
    archive(id, body) {
      office.archiveAgent(id, body);
      return currentAgent(id);
    },
    archiveSession(id, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'note')
        || typeof body.note !== 'string' || body.note.trim().length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.note)) fail(400, 'VALIDATION_ERROR', '보관 메모는 4000자 이내로 입력해 주세요.');
      const entryId = `cli:${id}`;
      const existing = ownerOf(entryId);
      if (existing) fail(409, 'ENTRY_ALREADY_LINKED', '이미 등록된 직원입니다. 직원 상세에서 보관해 주세요.');
      // Last observed records may be stored even while their bridge is offline.
      // No live identifier is written to the office database.
      const entry = discovery.snapshot().entries.find((item) => item.id === entryId && item.kind === 'session');
      if (!entry) fail(409, 'ENTRY_UNAVAILABLE', '현재 목록에 기록이 없습니다. 자료 검색에서 보관된 대화를 확인해 주세요.');
      const agent = office.hire({ name: 'Codex 직원', role: '보관 업무', provider: entry.provider }, { source: 'cli', kind: 'session' }, body.note, registrationKey(entry));
      remember(agent.id, entry);
      return currentAgent(agent.id);
    },
    isArchivedSession(id) {
      const owner = ownerOf(`cli:${id}`);
      return Boolean(owner && requireAgent(owner).workArchive?.stored);
    },
    edit(id, body) {
      const agent = currentAgent(id);
      const local = observer?.snapshot();
      office.editAgent(id, body, { execution: local?.execution,
        canConfigureExecution: agent.connection?.status === 'connected' && agent.connection.source === 'cli'
          && agent.connection.kind === 'session' && local?.control?.enabled === true
          && local.sessions.some((session) => session.id === agent.connection.sessionId) });
      return currentAgent(id);
    },
    connect(id, body) {
      input(body, ['entryId', 'settingsRevision']);
      const agent = requireAgent(id);
      const entry = requireEntry(body.entryId, id);
      if (agent.provider !== entry.provider) fail(409, 'PROVIDER_MISMATCH', '같은 공급자의 직원과 감지 대상만 연결할 수 있습니다.');
      office.setAgentConnection(id, { source: entry.source, kind: entry.kind }, body.settingsRevision, registrationKey(entry));
      remember(id, entry);
      return currentAgent(id);
    },
    disconnect(id, body = {}) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'settingsRevision')) fail(400, 'INVALID_STAFF_CONNECTION', '직원 연결 설정을 확인해 주세요.');
      office.setAgentConnection(id, null, body.settingsRevision);
      links.delete(id);
      return currentAgent(id);
    },
  };
}
