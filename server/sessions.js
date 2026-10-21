import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const empty = (status = 'not_connected') => ({ status, updatedAt: null, workspace: '', sessions: [] });
const states = new Set(['working', 'idle', 'interrupted', 'unknown']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

// Read only the bridge's small, sanitized snapshot, never a provider's session log.
export function createSessionObserver({ file, clock = Date.now } = {}) {
  return {
    snapshot() {
      if (!file) return empty();
      let descriptor;
      try {
        descriptor = openSync(file, 'r');
        const size = fstatSync(descriptor).size;
        if (size > 65536) return empty('disconnected');
        const buffer = Buffer.alloc(size);
        readSync(descriptor, buffer, 0, size, 0);
        const data = JSON.parse(buffer.toString('utf8'));
        if (data?.schemaVersion !== 1 || !validTime(data.generatedAt) || !Array.isArray(data.sessions) || data.sessions.length > 24) return empty('disconnected');
        const age = clock() - Date.parse(data.generatedAt);
        const connected = age >= -5000 && age <= 20000;
        const sessions = [];
        const seen = new Set();
        for (const session of data.sessions) {
          if (!session || !uuid.test(session.id) || seen.has(session.id) || !states.has(session.status) || !validTime(session.lastActivityAt)) continue;
          seen.add(session.id);
          const activityAge = clock() - Date.parse(session.lastActivityAt);
          const status = !connected ? 'disconnected' : activityAge < -5000 || (session.status === 'working' && activityAge > 120000) ? 'unknown' : session.status;
          sessions.push({
            id: session.id, name: `Codex · ${session.id.slice(-4)}`, provider: 'openai',
            status, lastActivityAt: new Date(session.lastActivityAt).toISOString(),
          });
        }
        const workspace = typeof data.workspace === 'string' && data.workspace.length <= 80 && !/[\x00-\x1f/\\]/.test(data.workspace) ? data.workspace : '';
        return { status: connected ? 'connected' : 'disconnected', updatedAt: new Date(data.generatedAt).toISOString(), workspace, sessions };
      } catch (error) {
        return empty(error.code === 'ENOENT' ? 'not_connected' : 'disconnected');
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
    },
  };
}
