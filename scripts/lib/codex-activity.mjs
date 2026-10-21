const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const terminal = new Set(['task_complete', 'turn_aborted', 'task_interrupted']);
const questionTools = new Set(['request_user_input', 'request_user_input_async']);
const recentMs = 60000;
const pendingMs = 30 * 60000;
const object = (value) => {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : {};
  try { return JSON.parse(value); } catch { return {}; }
};
const iso = (time) => new Date(time).toISOString();

// Read only an exact, structured reply envelope. Ordinary chat text, questions,
// source code and prose mentioning a tool never become activity signals.
function replyIds(payload) {
  const parts = typeof payload.message === 'string' ? [payload.message]
    : Array.isArray(payload.content) ? payload.content.map((part) => part?.text).filter((value) => typeof value === 'string') : [];
  const ids = [];
  for (const text of parts) {
    const match = text.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*)\s*<\/send_user_message_question_reply>$/);
    if (!match) continue;
    const answers = object(match[1]);
    if (!Array.isArray(answers)) continue;
    for (const answer of answers) {
      const identity = object(answer?.questionItemId);
      if (Array.isArray(identity) && questionTools.has(identity[0]) && typeof identity[1] === 'string') ids.push(identity[1]);
    }
  }
  return ids;
}

export function collectActivity(records, clock = Date.now) {
  const now = clock();
  const pending = new Map();
  const peers = new Map();
  for (const record of records) {
    const at = Date.parse(record?.timestamp);
    if (!Number.isFinite(at) || at > now + 5000) continue;
    const payload = record.payload || {};
    if (record.type === 'event_msg' && (terminal.has(payload.type) || payload.type === 'task_started')) {
      pending.clear(); peers.clear();
      continue;
    }
    if (record.type === 'response_item' && payload.type === 'function_call' && questionTools.has(payload.name)) {
      const args = object(payload.arguments);
      if (typeof payload.call_id === 'string' && Array.isArray(args.questions) && args.questions.length) {
        pending.set(payload.call_id, { kind: 'question', since: at, async: payload.name.endsWith('_async') });
      }
    }
    if (record.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(payload.type)) {
      const id = payload.call_id || payload.id;
      const request = pending.get(id);
      const output = object(payload.output);
      if (request && (!request.async || output.isError === true || output.answers)) pending.delete(id);
    }
    const item = record.type === 'event_msg' && payload.type === 'item_completed' ? payload.item : null;
    if ((record.type === 'event_msg' && payload.type === 'user_message') || item?.type === 'UserMessage'
      || (record.type === 'response_item' && payload.type === 'message' && payload.role === 'user')) {
      for (const id of replyIds(item || payload)) pending.delete(id);
    }
    // Nested tools in an exec cell are recorded as their own completed MCP items.
    // Never inspect the exec code, prompt or tool result text.
    if (item?.type === 'McpToolCall' && item.server === 'codex_tui'
      && item.tool === 'send_message_to_thread' && item.status === 'completed' && item.result?.isError === false) {
      const id = object(item.arguments).threadId;
      if (typeof id === 'string' && uuid.test(id)) peers.set(id, at);
    }
    // Explicit approval events are supported when the local client records them.
    if (record.type === 'event_msg' && ['exec_approval_request', 'apply_patch_approval_request'].includes(payload.type)
      && typeof payload.call_id === 'string') pending.set(payload.call_id, { kind: 'approval', since: at });
    if (record.type === 'event_msg' && payload.type === 'server_request_resolved') pending.delete(payload.request_id);
  }
  const requests = [...pending.values()].filter((request) => now - request.since <= pendingMs)
    .sort((a, b) => b.since - a.since);
  if (requests.length) {
    const request = requests[0];
    return { kind: request.kind, phase: 'active', since: iso(request.since), expiresAt: iso(request.since + pendingMs), peerSessionIds: [] };
  }
  const recent = [...peers].filter(([, time]) => now - time <= recentMs).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!recent.length) return null;
  return { kind: 'collaborating', phase: 'recent', since: iso(recent[0][1]), expiresAt: iso(recent[0][1] + recentMs), peerSessionIds: recent.map(([id]) => id) };
}

export function connectActivities(sessions) {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const links = sessions.filter((session) => session.activity?.kind === 'collaborating')
    .map((session) => ({ source: session, activity: { ...session.activity, peerSessionIds: [...session.activity.peerSessionIds] } }));
  for (const { source } of links) delete source.activity;
  const connect = (session, peerId, activity) => {
    if (session.activity && session.activity.kind !== 'collaborating') return;
    const newest = !session.activity || activity.since > session.activity.since ? activity : session.activity;
    session.activity = { ...newest, peerSessionIds: [...new Set([...(session.activity?.peerSessionIds || []), peerId])].slice(0, 8) };
  };
  for (const { source, activity } of links) {
    const peers = activity.peerSessionIds.filter((id) => {
      const target = byId.get(id);
      return id !== source.id && target && !['interrupted', 'disconnected'].includes(target.status)
        && !(target.status === 'idle' && Date.parse(target.lastActivityAt) >= Date.parse(activity.since));
    });
    for (const id of peers) {
      const target = byId.get(id);
      connect(source, id, activity);
      connect(target, source.id, activity);
    }
  }
  return sessions;
}
