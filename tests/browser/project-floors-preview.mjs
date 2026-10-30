// Isolated synthetic browser fixture; never reads the host bridge or office DB.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';

const directory = mkdtempSync(join(tmpdir(), 'project-floors-preview-'));
const store = createStore(':memory:');
const server = createHttpServer(createOffice(store), { bridgeFile: join(directory, 'missing.json'), searchDirectory: directory });
server.listen(Number(process.env.FLOOR_TEST_PORT || 18089), '127.0.0.1', () => console.log('Synthetic project floor preview ready.'));
process.on('SIGTERM', () => server.close(() => { store.close(); rmSync(directory, { recursive: true, force: true }); }));
process.on('SIGINT', () => process.kill(process.pid, 'SIGTERM'));
