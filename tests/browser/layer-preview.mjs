// Isolated synthetic data only. No user database, host bridge or AI CLI is used.
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.LAYER_TEST_PORT || 18084);
const directory = mkdtempSync(join(tmpdir(), 'office-layer-preview-'));
for (const child of ['commands', 'conversations']) mkdirSync(join(directory, child));
const sessionIds = [randomUUID(), randomUUID()];
const snapshot = { schemaVersion: 1, workspace: 'UI 검증 프로젝트', conversations: { enabled: true },
  sessions: sessionIds.map((id) => ({ id, status: 'idle', model: 'fixture-model', reasoningEffort: 'medium' })),
  control: { enabled: true, bridgeId: randomUUID() },
  execution: { status: 'ready', models: [{ id: 'fixture-model', name: '검증 모델', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium', isDefault: true }] } };
function publish() {
  const now = new Date().toISOString();
  snapshot.generatedAt = now; snapshot.execution.updatedAt = now;
  for (const [index, session] of snapshot.sessions.entries()) {
    session.lastActivityAt = now;
    writeFileSync(join(directory, 'conversations', `${session.id}.json`), JSON.stringify({ schemaVersion: 1, sessionId: session.id, generatedAt: now,
      messages: Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', timestamp: now,
        content: `검증 대화 ${index + 1} / ${i + 1}. ` + '공개 메시지의 읽던 위치와 닫기를 확인합니다. '.repeat(8) })) }));
  }
  writeFileSync(join(directory, 'codex.json'), JSON.stringify(snapshot));
}
publish();
const store = createStore(':memory:');
const office = createOffice(store);
const staff = office.hire({ name: '검증 직원', role: '대화와 지시 검증', provider: 'openai' });
office.hire({ name: '연결 전 직원', role: '연결 화면 검증', provider: 'openai' });
office.hire({ name: '체험 직원', role: '양식 검증', provider: 'demo' });
const server = createHttpServer(office, { publicDir: fileURLToPath(new URL('../../public/', import.meta.url)), bridgeFile: join(directory, 'codex.json'),
  commandsDir: join(directory, 'commands'), allowedHosts: [`office.test:${port}`] });
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${port}/api`;
const discovery = await (await fetch(`${base}/discovery`)).json();
await fetch(`${base}/agents/${staff.id}/connection`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ entryId: discovery.entries.find((entry) => entry.kind === 'session' && entry.sessionId === sessionIds[0])?.id
    || discovery.entries.find((entry) => entry.kind === 'session').id }) });
const clientId = randomUUID();
for (let i = 0; i < 35; i += 1) await fetch(`${base}/search/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
  clientId, url: 'https://claude.ai/chat/10000000-0000-4000-8000-000000000002', role: i % 2 ? 'assistant' : 'user',
  content: `보관 검증 ${i + 1}. ` + '원격 HTTP에서도 자료를 읽고 닫을 수 있습니다. '.repeat(8) }) });
const timer = setInterval(publish, 4000);
process.on('SIGTERM', () => { clearInterval(timer); server.close(() => { store.close(); rmSync(directory, { recursive: true, force: true }); }); });
process.on('SIGINT', () => process.kill(process.pid, 'SIGTERM'));
console.log(`Layer preview ready: http://127.0.0.1:${port} (synthetic data)`);
