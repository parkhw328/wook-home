// Isolated synthetic data only. No user database, host bridge or AI CLI is used.
import { createAuth } from '../../server/auth.js';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.DENSITY_TEST_PORT || 18089);
const directory = mkdtempSync(join(tmpdir(), 'office-density-preview-'));
const auth = await createAuth(directory);
const initial = readFileSync(join(directory, 'admin-initial-password.txt'), 'utf8').trim().split('\n')[1];
const request = { headers: {}, socket: {} };
request.headers.cookie = (await auth.login(request, { username: 'admin', password: initial })).cookie.split(';')[0];
const changed = await auth.changePassword(request, { currentPassword: initial, newPassword: 'Preview-only-password-2026' });
const headers = { Cookie: changed.cookie.split(';')[0], 'Content-Type': 'application/json' };
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
const staff = office.hire({ name: '검증 직원', role: '대화와 지시 검증', provider: 'openai', projectName: '고객 포털과 주문 관리 통합 프로젝트' });
const waiting = office.hire({ name: '연결 전 직원', role: '연결 화면 검증', provider: 'openai', projectName: '분석 도구' });
office.archiveAgent(waiting.id, { stored: true, note: '다음 행동을 기록합니다.', settingsRevision: 0 });
const demo = office.hire({ name: '체험 직원', role: '양식 검증', provider: 'demo', projectName: '고객 포털과 주문 관리 통합 프로젝트' });
for (let i = 0; i < 4; i++) { const task = office.assign({ agentId: demo.id, title: `저장 업무 ${i + 1}`, description: '합성 검증 자료입니다.' }); office.cancel(task.id, {}); }
office.hire({ name: '대기 체험 직원', role: '새 업무 양식 검증', provider: 'demo', projectName: '분석 도구' });
office.assign({ agentId: demo.id, title: '화면 구성 검토', description: '간격과 입력 상태를 확인합니다.' });
const server = createHttpServer(office, { auth, searchDirectory: directory, publicDir: fileURLToPath(new URL('../../public/', import.meta.url)), bridgeFile: join(directory, 'codex.json'),
  commandsDir: join(directory, 'commands'), allowedHosts: [`office.test:${port}`] });
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${port}/api`;
const discovery = await (await fetch(`${base}/discovery`, { headers })).json();
await fetch(`${base}/agents/${staff.id}/connection`, { method: 'PUT', headers,
  body: JSON.stringify({ entryId: discovery.entries.find((entry) => entry.kind === 'session' && entry.sessionId === sessionIds[0])?.id
    || discovery.entries.find((entry) => entry.kind === 'session').id }) });
const clientId = randomUUID();
for (let i = 0; i < 35; i += 1) await fetch(`${base}/search/import`, { method: 'POST', headers, body: JSON.stringify({
  clientId, url: 'https://claude.ai/chat/10000000-0000-4000-8000-000000000002', role: i % 2 ? 'assistant' : 'user',
  content: `보관 검증 ${i + 1}. ` + '원격 HTTP에서도 자료를 읽고 닫을 수 있습니다. '.repeat(8) }) });
const timer = setInterval(publish, 4000);
process.on('SIGTERM', () => { clearInterval(timer); server.close(() => { store.close(); rmSync(directory, { recursive: true, force: true }); }); });
process.on('SIGINT', () => process.kill(process.pid, 'SIGTERM'));
console.log(`Density preview ready: http://127.0.0.1:${port} (synthetic data)`);
