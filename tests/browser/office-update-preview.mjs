// Synthetic fixture only: never use this server with production data.
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';
import { createAuth } from '../../server/auth.js';
const dir = mkdtempSync(join(tmpdir(), 'office-update-preview-'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const auth = await createAuth(dir);
const initial = readFileSync(join(dir, 'admin-initial-password.txt'), 'utf8').trim().split('\n')[1];
const req = { headers: {}, socket: {} };
const logged = await auth.login(req, { username: 'admin', password: initial });
req.headers.cookie = logged.cookie.split(';')[0];
await auth.changePassword(req, { currentPassword: initial, newPassword: 'Preview-only-password-2026' });
const store = createStore(':memory:'); const office = createOffice(store);
const first = office.hire({ name: '기획 동료', role: '기획', provider: 'demo', projectName: '고객 포털' });
const second = office.hire({ name: '개발 동료', role: '개발', provider: 'openai', projectName: '분석 도구' });
office.archiveAgent(second.id, { stored: true, note: '다음 작업에서 API 연결을 확인합니다.', settingsRevision: 0 });
for (let index = 0; index < 24; index++) { const task = office.assign({ agentId: first.id, title: `지난 업무 ${index + 1}`, description: '합성 검증용 업무입니다.' }); office.cancel(task.id, {}); }
const workspaceKey = hash('/synthetic/customer-portal'); const originId = '00000000-1111-4000-8000-000000000001';
const id = hash(`${workspaceKey}:openai:${originId}`); const now = new Date().toISOString();
mkdirSync(join(dir, 'search-history'));
writeFileSync(join(dir, 'codex.json'), JSON.stringify({ schemaVersion: 1, workspace: '고객 포털', workspaceKey, generatedAt: now, stopped: true, sessions: [], searchHistory: { enabled: true } }));
writeFileSync(join(dir, 'search-history/index.json'), JSON.stringify({ schemaVersion: 1, workspaceKey, workspace: '고객 포털', items: [{ key: id, provider: 'openai', updatedAt: now }] }));
writeFileSync(join(dir, `search-history/${id}.json`), JSON.stringify({ schemaVersion: 1, workspaceKey, source: 'cli', provider: 'openai', originId,
  messages: [{ key: hash('first'), role: 'user', content: '오프라인으로 보관한 이전 작업입니다. <script>실행하지 않음</script>', timestamp: now }, { key: hash('second'), role: 'assistant', content: '프로젝트 설정을 정리했습니다. 다음 작업에서 화면을 검토하세요.', timestamp: now }] }));
const server = createHttpServer(office, { auth, searchDirectory: dir, bridgeFile: join(dir, 'codex.json') });
server.listen(Number(process.env.OFFICE_TEST_PORT || 18088), '127.0.0.1', () => console.log('Synthetic office update preview ready.'));
process.on('SIGTERM', () => server.close(() => { store.close(); rmSync(dir, { recursive: true, force: true }); }));
process.on('SIGINT', () => process.kill(process.pid, 'SIGTERM'));
