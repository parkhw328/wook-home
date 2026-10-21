import { ApiError } from './office.js';

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

// Only the user-selected source category is persisted on the employee. Live IDs,
// browser aliases, process identifiers and observations stay in this bounded map.
export function createStaffConnections({ office, discovery }) {
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

  function requireEntry(entryId, agentId = null) {
    const snapshot = discovery.snapshot();
    const entry = snapshot.entries.find((item) => item.id === entryId);
    if (!entry || observationStatus(entry, snapshot) !== 'connected') fail(409, 'ENTRY_UNAVAILABLE', '대상이 더 이상 감지되지 않습니다. 목록을 새로고침하고 다시 선택해 주세요.');
    if (ownerOf(entryId) && ownerOf(entryId) !== agentId) fail(409, 'ENTRY_ALREADY_LINKED', '이미 다른 직원에게 연결되어 있습니다. 목록에서 해당 직원을 확인해 주세요.');
    return entry;
  }

  function remember(agentId, entry) {
    links.set(agentId, { id: entry.id, source: entry.source, kind: entry.kind });
  }

  function project(agent, snapshot, paused) {
    const { connectionPreference: preference, ...output } = agent;
    const reference = links.get(agent.id);
    if (!reference && !preference) return output;
    const entry = reference ? snapshot.entries.find((item) => item.id === reference.id) : null;
    const status = reference ? observationStatus(entry, snapshot, reference) : 'not_connected';
    const connected = status === 'connected';
    const canControl = connected && !paused && entry?.source === 'cli' && entry.kind === 'session' && entry.canControl === true;
    output.connection = {
      source: reference?.source || preference.source, kind: reference?.kind || preference.kind,
      status, statusLabel: labels[status], canControl,
      ...(reference ? { entryId: reference.id } : {}),
      ...(entry ? { name: entry.name, scope: entry.scope, tabCount: entry.tabCount,
        updatedAt: entry.updatedAt || entry.lastActivityAt || null } : {}),
      ...(entry?.kind === 'session' ? { sessionId: entry.sessionId } : {}),
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
      const state = office.snapshot();
      const observed = discovery.snapshot();
      return { ...state, agents: state.agents.map((agent) => project(agent, observed, state.office.paused)) };
    },
    discoverySnapshot() {
      const snapshot = discovery.snapshot();
      const agents = office.snapshot().agents;
      return { ...snapshot, entries: snapshot.entries.map((entry) => {
        const agent = agents.find((item) => item.id === ownerOf(entry.id));
        return { ...entry, linkedAgentId: agent?.id || null, linkedAgentName: agent?.name || null,
          canRegister: !agent && observationStatus(entry, snapshot) === 'connected' };
      }) };
    },
    hire(body) {
      input(body, ['entryId', 'name', 'role']);
      const entry = requireEntry(body.entryId);
      const agent = office.hire({ name: body.name, role: body.role, provider: entry.provider }, { source: entry.source, kind: entry.kind });
      remember(agent.id, entry);
      return currentAgent(agent.id);
    },
    connect(id, body) {
      input(body, ['entryId']);
      const agent = requireAgent(id);
      const entry = requireEntry(body.entryId, id);
      if (agent.provider !== entry.provider) fail(409, 'PROVIDER_MISMATCH', '같은 공급자의 직원과 감지 대상만 연결할 수 있습니다.');
      office.setAgentConnection(id, { source: entry.source, kind: entry.kind });
      remember(id, entry);
      return currentAgent(id);
    },
    disconnect(id) {
      office.setAgentConnection(id, null);
      links.delete(id);
      return currentAgent(id);
    },
  };
}
