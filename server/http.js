import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { ApiError } from './office.js';
import { VERSION, providers } from './catalog.js';
import { createSessionObserver } from './sessions.js';
import { createLocalCommands } from './local-commands.js';
import { createDiscovery } from './discovery.js';
import { createConnections } from './connections.js';
import { createStaffConnections } from './staff-connections.js';
import { createSessionSearch } from './session-search.js';

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Cache-Control': 'no-store',
};

function json(response, status, body, extra = {}) {
  response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
  response.end(JSON.stringify(body));
}

async function bodyOf(request, limit = 32768) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'application/json 형식으로 요청해 주세요.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, 'BODY_TOO_LARGE', '요청 내용이 너무 큽니다.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', '올바른 JSON을 입력해 주세요.'); }
}

export function createHttpServer(office, { publicDir = resolve('public'), bridgeFile, commandsDir, searchDirectory, clock } = {}) {
  const root = resolve(publicDir);
  const observer = createSessionObserver({ file: bridgeFile, clock });
  const commands = createLocalCommands({ directory: commandsDir, observer, office, clock });
  const discovery = createDiscovery({ observer, clock });
  const connections = createConnections({ observer, discovery, clock });
  const staff = createStaffConnections({ office, discovery });
  const search = createSessionSearch({ directory: searchDirectory, bridgeFile, observer, clock });
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
    try {
      const host = request.headers.host;
      if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) throw new ApiError(403, 'LOCAL_ONLY', '이 버전은 로컬 주소로만 접속할 수 있습니다.');
      const url = new URL(request.url, `http://${host}`);
      const path = url.pathname;
      const method = request.method;
      const protectedRequest = path.startsWith('/api/') || !['GET', 'HEAD'].includes(method);
      if (protectedRequest && (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== `http://${host}`))) throw new ApiError(403, 'ORIGIN_REJECTED', '사무실 화면에서 다시 요청해 주세요.');
      if (method === 'GET' && path === '/api/health') return json(response, 200, { status: 'ok', version: VERSION });
      if (method === 'GET' && path === '/api/search/status') return json(response, 200, await search.status());
      if (method === 'POST' && path === '/api/search/query') return json(response, 200, await search.query(await bodyOf(request)));
      if (method === 'PUT' && path === '/api/search/settings') return json(response, 200, search.configure(await bodyOf(request)));
      if (method === 'POST' && path === '/api/search/web') return json(response, 200, search.receiveWeb(await bodyOf(request, 3 * 1024 * 1024)));
      const searchSession = /^\/api\/search\/sessions\/([a-f0-9]{64})$/.exec(path);
      if (method === 'GET' && searchSession) return json(response, 200, await search.detail(searchSession[1]));
      if (method === 'GET' && path === '/api/connections') return json(response, 200, connections.snapshot());
      if (method === 'POST' && path === '/api/connections/check') return json(response, 200, await connections.check(await bodyOf(request)));
      if (method === 'GET' && path === '/api/discovery') return json(response, 200, staff.discoverySnapshot());
      if (method === 'POST' && path === '/api/discovery/browser') return json(response, 200, discovery.receive(await bodyOf(request)));
      const browserDiscovery = /^\/api\/discovery\/browser\/([a-f0-9-]{36})$/.exec(path);
      if (method === 'DELETE' && browserDiscovery) return json(response, 200, discovery.forget(browserDiscovery[1]));
      if (method === 'GET' && path === '/api/state') return json(response, 200, { ...staff.snapshot(), localSessions: observer.snapshot() });
      if (method === 'GET' && path === '/api/providers') return json(response, 200, providers);
      if (method === 'GET' && path === '/api/handoff') return json(response, 200, office.handoff(), { 'Content-Disposition': 'attachment; filename="wook-home-handoff.json"' });
      if (method === 'POST' && path === '/api/agents') return json(response, 201, office.hire(await bodyOf(request)));
      if (method === 'POST' && path === '/api/agents/from-discovery') return json(response, 201, staff.hire(await bodyOf(request)));
      const agentConnection = /^\/api\/agents\/([a-f0-9-]{36})\/connection$/.exec(path);
      if (method === 'PUT' && agentConnection) return json(response, 200, staff.connect(agentConnection[1], await bodyOf(request)));
      if (method === 'DELETE' && agentConnection) return json(response, 200, staff.disconnect(agentConnection[1]));
      if (method === 'POST' && path === '/api/tasks') return json(response, 201, office.assign(await bodyOf(request)));
      const sessionConversation = /^\/api\/local-sessions\/([a-f0-9-]{36})\/conversation$/.exec(path);
      if (method === 'GET' && sessionConversation) return json(response, 200, observer.conversation(sessionConversation[1]));
      const sessionCommand = /^\/api\/local-sessions\/([a-f0-9-]{36})\/commands$/.exec(path);
      if (method === 'POST' && sessionCommand) return json(response, 202, commands.submit(sessionCommand[1], await bodyOf(request)));
      const commandMatch = /^\/api\/local-commands\/([a-f0-9-]{36})$/.exec(path);
      if (method === 'GET' && commandMatch) return json(response, 200, commands.get(commandMatch[1]));
      const agentMatch = /^\/api\/agents\/([a-f0-9-]{36})$/.exec(path);
      if (method === 'PATCH' && agentMatch) return json(response, 200, office.editAgent(agentMatch[1], await bodyOf(request)));
      const taskMatch = /^\/api\/tasks\/([a-f0-9-]{36})\/(messages|approve|cancel)$/.exec(path);
      if (method === 'POST' && taskMatch) {
        const action = { messages: 'answer', approve: 'approve', cancel: 'cancel' }[taskMatch[2]];
        return json(response, 200, office[action](taskMatch[1], await bodyOf(request)));
      }
      if (method === 'POST' && path === '/api/office/pause') return json(response, 200, office.pause(await bodyOf(request)));
      if (method === 'POST' && path === '/api/office/resume') return json(response, 200, office.resume(await bodyOf(request)));
      if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) throw new ApiError(404, 'NOT_FOUND', '요청한 경로가 없습니다.');

      let decoded;
      try { decoded = decodeURIComponent(path); }
      catch { throw new ApiError(400, 'INVALID_PATH', '올바른 경로로 요청해 주세요.'); }
      const file = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
      if (!file.startsWith(`${root}${sep}`) || decoded.includes('\\') || decoded.includes('\0') || !contentTypes[extname(file)]) throw new ApiError(404, 'NOT_FOUND', '요청한 파일이 없습니다.');
      let data;
      try { data = await readFile(file); }
      catch { throw new ApiError(404, 'NOT_FOUND', '요청한 파일이 없습니다.'); }
      const cache = ['.woff2', '.ttf'].includes(extname(file)) ? 'public, max-age=86400' : 'no-store';
      response.writeHead(200, { ...headers, 'Cache-Control': cache, 'Content-Type': contentTypes[extname(file)], 'Content-Length': data.length });
      response.end(method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (response.destroyed || response.headersSent) return;
      const known = error instanceof ApiError;
      json(response, known ? error.status : 500, { error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '요청을 처리하지 못했습니다. 다시 시도해 주세요.' } });
      if (!known) process.stderr.write('Request failed (details withheld).\n');
    }
  });
  server.once('close', () => search.close());
  return server;
}
