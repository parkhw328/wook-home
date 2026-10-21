const idPattern = /^cli-[a-f0-9]{24}$/;
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const providerNames = { openai: 'Codex CLI', claude: 'Claude Code', gemini: 'Gemini CLI' };

// Only accept the host's bounded process metadata. No command lines, paths,
// arbitrary names or guessed links to conversation UUIDs cross this boundary.
export function readCliProcesses(value, bridgeConnected, now = Date.now()) {
  const empty = { status: 'unsupported', scope: 'this_pc', updatedAt: null, items: [], events: [] };
  if (!value) return empty;
  if (!['connected', 'unavailable', 'unsupported'].includes(value.status) || !Array.isArray(value.items) || value.items.length > 88
    || !Array.isArray(value.events) || value.events.length > 50) return { ...empty, status: 'unavailable' };
  const age = validTime(value.updatedAt) ? now - Date.parse(value.updatedAt) : Infinity;
  const fresh = bridgeConnected && age >= -5000 && age <= 20000;
  const status = !bridgeConnected || (value.status === 'connected' && !fresh) ? 'disconnected' : value.status;
  const items = [];
  const seen = new Set();
  for (const item of value.items) {
    if (!item || !idPattern.test(item.id) || seen.has(item.id) || !Number.isSafeInteger(item.pid) || item.pid <= 0
      || !Object.hasOwn(providerNames, item.provider) || !['running', 'exited', 'unknown'].includes(item.status)
      || ![item.startedAt, item.firstSeenAt, item.lastSeenAt].every(validTime)
      || (item.status === 'exited' ? !validTime(item.endedAt) : item.endedAt !== null)) continue;
    seen.add(item.id);
    items.push({
      id: item.id, pid: item.pid, provider: item.provider, name: `${providerNames[item.provider]} · ${item.pid}`,
      status: item.status === 'exited' ? 'exited' : status === 'connected' ? item.status : 'unknown',
      startedAt: item.startedAt, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt, endedAt: item.endedAt,
    });
  }
  const events = value.events.filter((event) => event && /^cli-event-\d+$/.test(event.id) && ['detected', 'exited'].includes(event.type)
    && seen.has(event.processId) && validTime(event.at)).map(({ id, type, processId, at }) => ({ id, type, processId, at }));
  return { status, scope: 'this_pc', updatedAt: validTime(value.updatedAt) ? value.updatedAt : null, items, events };
}
