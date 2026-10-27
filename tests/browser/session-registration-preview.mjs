// Synthetic session identities only; no host bridge, production DB or AI calls.
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'office-registration-preview-'));
const port = Number(process.env.SESSION_TEST_PORT || 18087);
const ids = ['1111', '2222', '3333', '4444', '5555'].map((part) => `00000000-${part}-4000-8000-000000000001`);
const publish = () => {
  const now = new Date().toISOString();
  writeFileSync(join(directory, 'codex.json'), JSON.stringify({ schemaVersion: 1, workspace: '세션 등록 검증', generatedAt: now,
    sessions: ids.map((id, i) => ({ id, status: i === 0 ? 'working' : 'idle', lifecycle: i < 3 ? 'live' : i === 3 ? 'not_loaded' : 'unknown', lastActivityAt: now })) }));
};
publish();
const store = createStore(':memory:');
const office = createOffice(store);
const server = createHttpServer(office, { publicDir: fileURLToPath(new URL('../../public/', import.meta.url)), bridgeFile: join(directory, 'codex.json') });
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const timer = setInterval(publish, 4000);
process.on('SIGTERM', () => { clearInterval(timer); server.close(() => { store.close(); rmSync(directory, { recursive: true, force: true }); }); });
process.on('SIGINT', () => process.kill(process.pid, 'SIGTERM'));
console.log(`Session preview ready: http://127.0.0.1:${port} (synthetic data)`);
