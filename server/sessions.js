import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readCliProcesses } from './cli-processes.js';
import { readCliTools } from './cli-tools.js';
import { readSessionActivity } from './session-activity.js';
import { readSettingsAck } from './bridge-settings.js';
import { modelId, effortId, readExecutionOptions } from './execution-options.js';

const empty = (status = 'not_connected') => ({ status, updatedAt: null, workspace: '', sessions: [], control: { enabled: false, reason: 'disconnected' }, processes: readCliProcesses(null, false), cliTools: readCliTools(null, false) });
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
        const connected = data.stopped !== true && age >= -5000 && age <= 20000;
        const sessions = [];
        const seen = new Set();
        for (const session of data.sessions) {
          if (!session || !uuid.test(session.id) || seen.has(session.id) || !states.has(session.status) || !validTime(session.lastActivityAt)) continue;
          seen.add(session.id);
          const activityAge = clock() - Date.parse(session.lastActivityAt);
          const status = !connected ? 'disconnected' : activityAge < -5000 || (session.status === 'working' && activityAge > 120000) ? 'unknown' : session.status;
          const activity = readSessionActivity(session, data.sessions, connected, clock());
          sessions.push({
            id: session.id, name: `Codex · ${session.id}`, provider: 'openai',
            lifecycle: connected && ['live', 'not_loaded'].includes(session.lifecycle) ? session.lifecycle : 'unknown',
            status, lastActivityAt: new Date(session.lastActivityAt).toISOString(),
            ...(modelId(session.model) ? { model: session.model } : {}),
            ...(effortId(session.reasoningEffort) ? { reasoningEffort: session.reasoningEffort } : {}),
            ...(activity ? { activity } : {}),
          });
        }
        const workspace = typeof data.workspace === 'string' && data.workspace.length <= 80 && !/[\x00-\x1f/\\]/.test(data.workspace) ? data.workspace : '';
        const enabled = connected && data.control?.enabled === true && uuid.test(data.control.bridgeId);
        const control = {
          enabled: Boolean(enabled),
          reason: !connected ? 'disconnected' : enabled ? 'ready' : data.control?.reason === 'cli_unavailable' ? 'cli_unavailable' : 'not_enabled',
          ...(enabled ? { bridgeId: data.control.bridgeId } : {}),
        };
        const execution = readExecutionOptions(data.execution, Boolean(enabled), clock());
        return { status: connected ? 'connected' : 'disconnected', updatedAt: new Date(data.generatedAt).toISOString(), workspace, ...(typeof data.workspaceKey === 'string' && /^[a-f0-9]{64}$/.test(data.workspaceKey) ? { workspaceKey: data.workspaceKey } : {}), sessions, control, execution, settings: readSettingsAck(data.settings), searchHistory: { enabled: data.searchHistory?.enabled === true }, activities: { enabled: data.activities?.enabled === true }, conversations: { enabled: data.conversations?.enabled === true }, processes: readCliProcesses(data.processes, connected, clock()), cliTools: readCliTools(data.cliTools, connected) };
      } catch (error) {
        return empty(error.code === 'ENOENT' ? 'not_connected' : 'disconnected');
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
    },
    conversation(id) {
      const state = this.snapshot();
      const result = { sessionId: id, status: 'disabled', messages: [], updatedAt: null, truncated: false, limit: 60 };
      if (!uuid.test(id) || !state.sessions.some((session) => session.id === id)) return { ...result, status: 'unavailable' };
      if (!state.conversations?.enabled) return result;
      let descriptor;
      try {
        descriptor = openSync(join(dirname(file), 'conversations', `${id}.json`), 'r');
        const size = fstatSync(descriptor).size;
        if (size > 200000) return { ...result, status: 'unavailable' };
        const buffer = Buffer.alloc(size);
        readSync(descriptor, buffer, 0, size, 0);
        const data = JSON.parse(buffer.toString('utf8'));
        if (data.schemaVersion !== 1 || data.sessionId !== id || !validTime(data.generatedAt) || !Array.isArray(data.messages) || data.messages.length > 60) return { ...result, status: 'unavailable' };
        let characters = 0;
        const messages = data.messages.filter((message) => {
          if (!message || !['user', 'assistant'].includes(message.role) || !validTime(message.timestamp) || typeof message.content !== 'string' || message.content.length > 4000) return false;
          characters += message.content.length;
          return characters <= 24000;
        }).map((message) => ({ role: message.role, timestamp: new Date(message.timestamp).toISOString(), content: message.content, truncated: message.truncated === true }));
        const age = clock() - Date.parse(data.generatedAt);
        const fresh = state.status === 'connected' && age >= -5000 && age <= 20000;
        return { ...result, status: !fresh ? 'disconnected' : messages.length ? 'ready' : 'empty', updatedAt: new Date(data.generatedAt).toISOString(), messages, truncated: data.truncated === true || characters > 24000 };
      } catch (error) {
        return { ...result, status: state.status === 'connected' ? 'unavailable' : 'disconnected',
          reason: ['EACCES', 'EPERM'].includes(error.code) ? 'permission_denied' : error.code === 'ENOENT' ? 'missing_record' : 'unreadable_record' };
      } finally { if (descriptor !== undefined) closeSync(descriptor); }
    },
  };
}
