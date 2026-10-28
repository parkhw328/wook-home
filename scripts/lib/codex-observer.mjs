import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { collectConversation } from './codex-conversations.mjs';
import { collectActivity, connectActivities } from './codex-activity.mjs';
import { modelId, effortId } from '../../server/execution-options.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const windowBytes = 1024 * 1024;
const pathKey = (value) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };

// Metadata and event kinds are allowlisted. Prompts, outputs, tools and account data
// must never be returned, written to a snapshot, or included in an exception.
export function summarizeRecords(records, workspace) {
  const metadata = records.find((record) => record?.type === 'session_meta')?.payload;
  if (!metadata || typeof metadata.cwd !== 'string' || pathKey(metadata.cwd) !== pathKey(workspace) || !uuid.test(metadata.id)) return null;
  let status = 'unknown';
  let lastActivityAt = null;
  let execution = {};
  for (const record of records) {
    if (!record || typeof record.timestamp !== 'string' || !Number.isFinite(Date.parse(record.timestamp))) continue;
    if (record.type === 'turn_context') {
      const model = record.payload?.model;
      const reasoningEffort = record.payload?.effort;
      execution = { ...(modelId(model) ? { model } : {}), ...(effortId(reasoningEffort) ? { reasoningEffort } : {}) };
    }
    let next;
    if (record.type === 'event_msg') {
      next = { task_started: 'working', task_complete: 'idle', turn_aborted: 'interrupted', task_interrupted: 'interrupted', item_completed: 'working' }[record.payload?.type];
    } else if (record.type === 'response_item' && ['reasoning', 'function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output', 'message'].includes(record.payload?.type)) {
      next = 'working';
    }
    if (next && (!lastActivityAt || Date.parse(record.timestamp) >= Date.parse(lastActivityAt))) {
      status = next;
      lastActivityAt = new Date(record.timestamp).toISOString();
    }
  }
  return lastActivityAt ? { id: metadata.id, status, lastActivityAt, ...execution } : null;
}

async function readSummary(file, workspace, includeConversations = false, clock = Date.now) {
  let handle;
  try {
    handle = await open(file, 'r');
    const info = await handle.stat();
    const head = Buffer.alloc(Math.min(windowBytes, info.size));
    const first = await handle.read(head, 0, head.length, 0);
    const headText = head.subarray(0, first.bytesRead).toString('utf8');
    const firstNewline = headText.indexOf('\n');
    if (firstNewline < 0) return null;
    const metadata = parse(headText.slice(0, firstNewline));
    // Exclude other projects before inspecting their event records.
    if (typeof metadata?.payload?.cwd !== 'string' || pathKey(metadata.payload.cwd) !== pathKey(workspace)) return null;
    let lines;
    if (info.size <= windowBytes) {
      lines = headText.split('\n').slice(1, -1);
    } else {
      const tail = Buffer.alloc(windowBytes);
      const last = await handle.read(tail, 0, tail.length, info.size - tail.length);
      lines = tail.subarray(0, last.bytesRead).toString('utf8').split('\n').slice(1, -1);
    }
    const records = [metadata, ...lines.map(parse)];
    const summary = summarizeRecords(records, workspace);
    const activity = summary && collectActivity(records, clock);
    if (activity) summary.activity = activity;
    if (summary && includeConversations) summary.conversation = collectConversation(records, info.size > windowBytes);
    return summary;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

export async function collectSessions({ sessionsDir, workspace, clock = Date.now, includeConversations = false }) {
  const current = clock();
  const candidates = [];
  // Active logs stay in their creation-date directory. Look back seven days;
  // this deliberately does not scan or export an account's whole history.
  for (let days = 0; days < 7; days += 1) {
    const date = new Date(current - days * 86400000).toISOString().slice(0, 10).split('-');
    const directory = join(sessionsDir, ...date);
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw new Error('Session directory is not readable.'); }
    for (const entry of entries) {
      if (!entry.isFile() || !/^rollout-.*\.jsonl$/.test(entry.name)) continue;
      const file = join(directory, entry.name);
      try {
        const info = await stat(file);
        if (current - info.mtimeMs <= 86400000) candidates.push({ file, modified: info.mtimeMs });
      } catch { /* A log can disappear while Codex archives it. */ }
    }
  }
  candidates.sort((a, b) => b.modified - a.modified);
  const sessions = [];
  for (const candidate of candidates.slice(0, 200)) {
    const session = await readSummary(candidate.file, workspace, includeConversations, clock);
    if (session && !sessions.some((item) => item.id === session.id)) sessions.push(session);
    if (sessions.length === 24) break;
  }
  return { schemaVersion: 1, generatedAt: new Date(current).toISOString(), workspace: basename(resolve(workspace)), workspaceKey: createHash('sha256').update(pathKey(workspace)).digest('hex'), activities: { enabled: true }, sessions: connectActivities(sessions) };
}
