import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.js';
import { createStore } from './store.js';
import { createOffice } from './office.js';
import { createHttpServer } from './http.js';

const auth = await createAuth(process.env.DATA_DIR || resolve('data'));
const store = createStore(process.env.DATA_DIR || resolve('data'));
const office = createOffice(store, { name: process.env.OFFICE_NAME || 'StackQueue Office' });
const server = createHttpServer(office, {
  auth,
  allowedHosts: (process.env.OFFICE_ALLOWED_HOSTS || '').split(',').map((host) => host.trim()).filter(Boolean),
  publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
  bridgeFile: process.env.CODEX_BRIDGE_FILE || resolve('data/bridge/codex.json'),
  commandsDir: process.env.CODEX_COMMANDS_DIR || resolve('data/bridge/commands'),
  searchDirectory: process.env.DATA_DIR || resolve('data'),
});
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';
let closing = false;

function shutdown() {
  if (closing) return;
  closing = true;
  office.pause({}, '서버 종료 전에 미완료 업무를 일시 중지하고 저장했습니다.');
  server.close(() => {
    store.close();
    process.exitCode = 0;
  });
  setTimeout(() => server.closeAllConnections(), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('error', () => {
  process.stderr.write('Server could not start. Check the port and data directory.\n');
  store.close();
  process.exitCode = 1;
});
server.listen(port, host, () => process.stdout.write('wook-home office ready.\n'));
