import { ApiError } from './office.js';
import { redactConversation } from './search-text.js';

export async function officeHistory(office, search, input = {}) {
  if (!input || typeof input !== 'object' || typeof (input.query ?? '') !== 'string' || (input.query || '').length > 200
    || !['', 'task', 'cli', 'event'].includes(input.kind || '') || typeof (input.projectId ?? '') !== 'string'
    || input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 100000)) {
    throw new ApiError(400, 'INVALID_HISTORY_QUERY', '히스토리 검색 조건을 확인해 주세요.');
  }
  const state = office.snapshot();
  const saved = await search.history();
  const projects = new Map((state.projects || []).map((item) => [item.id, { id: item.id, name: item.name }]));
  for (const row of saved.records) if (row.projectId) projects.set(row.projectId, { id: row.projectId, name: row.projectName });
  const staff = [...state.agents, ...(state.releasedAgents || [])];
  const tasks = state.tasks.map((task) => {
    const agent = staff.find((item) => item.id === task.agentId);
    const projectId = Object.hasOwn(task, 'projectId') ? task.projectId || '' : agent?.observedProjectId || agent?.assignedProjectId || '';
    return { id: task.id, kind: 'task', title: task.title, status: task.status, agentName: agent?.name || '해제 직원',
      projectId, projectName: projects.get(projectId)?.name || '', updatedAt: task.updatedAt };
  });
  const events = state.events.map((event) => ({ id: event.id, kind: 'event', title: event.message, updatedAt: event.createdAt, projectId: '' }));
  const query = (input.query || '').normalize('NFC').trim().toLocaleLowerCase();
  const records = [...tasks, ...saved.records, ...events].filter((row) => (!input.kind || row.kind === input.kind)
    && (!input.projectId || row.projectId === input.projectId)
    && (!query || `${row.title} ${row.projectName || ''} ${row.agentName || ''}`.normalize('NFC').toLocaleLowerCase().includes(query)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const offset = input.offset || 0;
  return { total: records.length, offset, limit: 20, projects: [...projects.values()], collection: saved.collection,
    limited: saved.limited, skipped: saved.skipped,
    records: records.slice(offset, offset + 20).map((row) => ({ ...row, title: redactConversation(row.title) })) };
}
