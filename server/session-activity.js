const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

// Activity is an ephemeral, allowlisted observation, never a work result or a
// permission to control a session. Disconnected/stale snapshots have no activity.
export function readSessionActivity(session, sessions, connected, now) {
  const value = session.activity;
  if (!connected || !value || ['interrupted', 'disconnected'].includes(session.status)) return null;
  if (!['collaborating', 'question', 'approval'].includes(value.kind)) return null;
  const collaboration = value.kind === 'collaborating';
  if (value.phase !== (collaboration ? 'recent' : 'active')) return null;
  const since = typeof value.since === 'string' ? Date.parse(value.since) : NaN;
  const expires = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
  if (!Number.isFinite(since) || !Number.isFinite(expires) || since > now + 5000 || expires <= now
    || expires <= since || expires - since > (collaboration ? 60000 : 30 * 60000)) return null;
  const known = new Set(sessions.filter((item) => item && uuid.test(item.id)
    && ['working', 'idle', 'unknown'].includes(item.status) && Number.isFinite(Date.parse(item.lastActivityAt))).map((item) => item.id));
  const peers = collaboration && Array.isArray(value.peerSessionIds)
    ? [...new Set(value.peerSessionIds.filter((id) => typeof id === 'string' && uuid.test(id) && known.has(id) && id !== session.id))].slice(0, 8) : [];
  if (collaboration && !peers.length) return null;
  return { kind: value.kind, phase: value.phase, since: new Date(since).toISOString(), expiresAt: new Date(expires).toISOString(), peerSessionIds: peers };
}
