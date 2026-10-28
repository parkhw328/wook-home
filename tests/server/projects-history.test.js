import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createSessionSearch } from '../../server/session-search.js';
import { officeHistory } from '../../server/history.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');

test('project floor identity persists across assignments, equal folder names and restarts', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'office-projects-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = createStore(dir); let office = createOffice(store);
  const a = office.hire({ name: 'A', role: 'Dev', provider: 'openai', projectName: '수동 프로젝트' });
  const b = office.hire({ name: 'B', role: 'Dev', provider: 'openai' });
  office.observeProject(a.id, { workspaceKey: hash('/first/app'), workspace: 'app' });
  office.observeProject(b.id, { workspaceKey: hash('/second/app'), workspace: 'app' });
  const before = office.snapshot();
  assert.equal(before.projects.length, 3);
  assert.equal(new Set(before.projects.map((p) => p.floor)).size, 3);
  assert.notEqual(before.agents[0].observedProjectId, before.agents[1].observedProjectId);
  office.archiveAgent(a.id, { stored: true, note: '다음 작업', projectName: '새 배정', settingsRevision: 0 });
  assert.equal(office.snapshot().agents[0].projectName, '새 배정');
  assert.throws(() => office.archiveAgent(a.id, { stored: true, note: '오래된 수정', settingsRevision: 0 }), { code: 'SETTINGS_CONFLICT' });
  store.close(); store = createStore(dir); office = createOffice(store);
  assert.deepEqual(office.snapshot().projects.slice(0, 3), before.projects);
  assert.equal(office.snapshot().agents[0].workArchive.note, '다음 작업');
  assert.ok(!JSON.stringify(office.handoff()).includes('다음 작업'));
  store.close();
});

test('history reads previous projects offline after restart, paginates and separates task outcomes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'office-history-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bridgeFile = join(dir, 'codex.json'); const historyDir = join(dir, 'search-history'); mkdirSync(historyDir);
  const now = new Date().toISOString(); const keys = [hash('/one'), hash('/two')]; const ids = [];
  let search = createSessionSearch({ directory: dir, bridgeFile });
  for (const [index, workspaceKey] of keys.entries()) {
    const originId = `test-session-${index}`; const id = hash(`${workspaceKey}:openai:${originId}`); ids.push(id);
    writeFileSync(bridgeFile, JSON.stringify({ schemaVersion: 1, generatedAt: now, sessions: [], searchHistory: { enabled: true } }));
    writeFileSync(join(historyDir, 'index.json'), JSON.stringify({ schemaVersion: 1, workspaceKey, workspace: `Project ${index}`, items: [{ key: id, provider: 'openai', updatedAt: now }] }));
    writeFileSync(join(historyDir, `${id}.json`), JSON.stringify({ schemaVersion: 1, workspaceKey, source: 'cli', provider: 'openai', originId, messages: [{ key: hash('message'), role: 'user', content: 'Saved offline work', timestamp: now }] }));
    await search.sync(true);
  }
  search.close(); rmSync(bridgeFile); search = createSessionSearch({ directory: dir, bridgeFile }); t.after(() => search.close());
  const store = createStore(':memory:'); t.after(() => store.close()); const office = createOffice(store);
  const agent = office.hire({ name: 'History', role: 'Demo', provider: 'demo', projectName: 'Demo project' });
  for (let i = 0; i < 22; i++) { const task = office.assign({ agentId: agent.id, title: `Task ${i}` }); office.cancel(task.id, {}); }
  const first = await officeHistory(office, search, { kind: 'task' });
  assert.equal(first.total, 22); assert.equal(first.records.length, 20); assert.ok(first.records.every((row) => row.status === 'cancelled'));
  assert.equal((await officeHistory(office, search, { kind: 'task', offset: 20 })).records.length, 2);
  const saved = await officeHistory(office, search, { kind: 'cli' }); assert.equal(saved.records.length, 2);
  assert.equal((await officeHistory(office, search, { kind: 'cli', projectId: keys[0] })).records.length, 1);
  assert.equal((await search.detail(ids[0], { history: true })).messages[0].content, 'Saved offline work');
  await assert.rejects(search.detail(ids[0]), { code: 'SEARCH_SESSION_NOT_FOUND' });
  assert.ok(!JSON.stringify(office.handoff()).includes('Saved offline work'));
  await assert.rejects(officeHistory(office, search, { offset: -1 }), { code: 'INVALID_HISTORY_QUERY' });
});

test('changing a project never reassigns an existing unassigned task', async () => {
  const store = createStore(':memory:'); const office = createOffice(store); const search = createSessionSearch();
  try {
    const agent = office.hire({ name: 'Staff', role: 'Demo', provider: 'demo' });
    const task = office.assign({ agentId: agent.id, title: 'Unassigned history' }); office.cancel(task.id, {});
    office.editAgent(agent.id, { projectName: 'New project', settingsRevision: 0 });
    const history = await officeHistory(office, search, { kind: 'task' });
    assert.equal(history.records[0].projectId, '');
    assert.equal(office.snapshot().tasks[0].projectId, null);
  } finally { search.close(); store.close(); }
});
