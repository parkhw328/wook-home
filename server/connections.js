import { ApiError } from './office.js';

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', webName: 'ChatGPT', keys: ['OPENAI_API_KEY'], url: 'https://api.openai.com/v1/models' },
  { id: 'claude', name: 'Claude', webName: 'Claude', keys: ['ANTHROPIC_API_KEY'], url: 'https://api.anthropic.com/v1/models?limit=1' },
  { id: 'gemini', name: 'Google Gemini', webName: 'Gemini', keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1' },
  { id: 'meta', name: 'Meta Model API', webName: 'Meta AI', keys: ['MODEL_API_KEY', 'META_API_KEY'], url: 'https://api.meta.ai/v1/models' },
];
const GUIDE = 'https://github.com/parkhw328/wook-home/wiki/Connections';
const COOLDOWN = 30000;
const FRESHNESS = 300000;
const MAX_BODY = 262144;
const apiMessages = {
  not_configured: ['미설정', '서버에 API 인증이 설정되지 않았습니다.', 'Wiki의 API 환경 변수 설정을 확인하세요.'],
  not_checked: ['미점검', '인증 설정이 있습니다. 실제 응답은 아직 확인하지 않았습니다.', '연결 점검을 눌러 인증과 응답을 확인하세요.'],
  checking: ['점검 중', '공식 모델 목록을 읽고 있습니다.', '최대 6초 뒤 결과를 확인하세요.'],
  reachable: ['응답 정상', '인증된 모델 목록 응답을 확인했습니다. 직원 실행 지원과는 별개입니다.', '실제 업무 실행은 지원되는 연결 기능을 이용하세요.'],
  no_models: ['모델 없음', '모델 목록 응답은 정상이지만 사용할 수 있는 모델이 없습니다.', '공급자 콘솔의 모델 접근 권한을 확인하세요.'],
  auth_failed: ['인증 거절', 'API 키 인증이 거절되었습니다.', '키의 유효 기간과 서버 인증 설정을 확인하세요.'],
  forbidden: ['접근 거절', '이 요청에 대한 접근이 거절되었습니다.', '공급자의 프로젝트 권한·지역·네트워크 제한을 확인하세요.'],
  request_rejected: ['요청 거절', 'API가 점검 요청을 거절했습니다. 인증이나 요청 설정을 확인해야 합니다.', '서버의 API 키·프로젝트 설정과 공급자 콘솔을 확인하세요.'],
  rate_limited: ['요청 제한', '공급자가 요청을 제한했습니다.', '사용량과 한도를 확인한 뒤 잠시 후 다시 점검하세요.'],
  timeout: ['시간 초과', '제한 시간 안에 응답을 받지 못했습니다.', '네트워크·프록시·공급자 상태를 확인하고 다시 점검하세요.'],
  network_error: ['연결 실패', 'API에 연결하지 못했습니다.', '서버의 인터넷·DNS·TLS·프록시 설정을 확인하세요.'],
  invalid_response: ['응답 확인 실패', '공식 모델 목록 형식으로 응답을 확인하지 못했습니다.', '공급자 상태와 API 설정을 확인하고 다시 점검하세요.'],
  service_error: ['서비스 오류', '공급자 API가 정상 응답을 반환하지 않았습니다.', '공급자 서비스 상태를 확인하고 다시 점검하세요.'],
  redirect_blocked: ['주소 변경 거절', '인증 정보를 보호하기 위해 다른 주소로의 이동을 중단했습니다.', '공식 API 주소와 네트워크 설정을 확인하세요.'],
  config_invalid: ['설정 확인 필요', 'API 인증 설정의 형식이 올바르지 않습니다.', '서버 환경 변수의 공백·줄바꿈과 값을 확인하세요.'],
};

function checkRow(id, source, name, status, statusLabel, message, action, extra = {}) {
  return { id, source, name, status, statusLabel, message, action, checkedAt: null, canControl: false, guideUrl: GUIDE, ...extra };
}

class InvalidResponse extends Error {}

async function readModels(response, provider) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new InvalidResponse();
  if (Number(response.headers.get('content-length')) > MAX_BODY || !response.body) throw new InvalidResponse();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) throw new InvalidResponse();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InvalidResponse(); }
  const models = provider === 'gemini' ? data?.models : data?.data;
  const nameKey = provider === 'gemini' ? 'name' : 'id';
  if (!Array.isArray(models) || models.length > 5000 || models.some((model) => !model || typeof model[nameKey] !== 'string' || !model[nameKey].length)) throw new InvalidResponse();
  return models.length ? 'reachable' : 'no_models';
}

async function probe(provider, credentials, { fetchImpl, clock, timeoutMs }) {
  const started = clock();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    const headers = { Accept: 'application/json' };
    if (provider.id === 'gemini') headers['x-goog-api-key'] = credentials.key;
    else if (provider.id === 'claude') {
      headers['x-api-key'] = credentials.key;
      headers['anthropic-version'] = '2023-06-01';
      if (credentials.workspace) headers['anthropic-workspace-id'] = credentials.workspace;
    } else headers.Authorization = `Bearer ${credentials.key}`;
    response = await fetchImpl(provider.url, { method: 'GET', headers, signal: controller.signal, redirect: 'manual' });
    let status;
    if (response.status >= 300 && response.status < 400) status = 'redirect_blocked';
    else if (response.status === 401) status = 'auth_failed';
    else if (response.status === 403) status = 'forbidden';
    else if (response.status === 400) status = 'request_rejected';
    else if (response.status === 429) status = 'rate_limited';
    else if (response.status >= 500) status = 'service_error';
    else if (response.status !== 200) status = 'invalid_response';
    else status = await readModels(response, provider.id);
    return { status, httpStatus: response.status, latencyMs: Math.max(0, clock() - started), checkedAt: new Date(clock()).toISOString() };
  } catch (error) {
    return { status: controller.signal.aborted ? 'timeout' : error instanceof InvalidResponse ? 'invalid_response' : 'network_error',
      httpStatus: response?.status ?? null, latencyMs: Math.max(0, clock() - started), checkedAt: new Date(clock()).toISOString() };
  } finally {
    clearTimeout(timer);
    // Never read error bodies: providers may echo credentials or account details.
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}

function localChecks(observer, discovery, now) {
  const cli = observer.snapshot();
  const browser = discovery.snapshot();
  const stamp = new Date(now).toISOString();
  const connected = cli.status === 'connected';
  const processStatus = cli.processes?.status || 'unsupported';
  const checks = [checkRow('office:http', 'office', '사무실 HTTP 서버', 'connected', '응답 정상', '사무실 서버가 연결 점검 요청에 응답했습니다.', 'CLI·웹·API 항목에서 각 연결 상태를 확인하세요.', { checkedAt: stamp }),
    checkRow('cli:bridge', 'cli', '호스트 연결 프로그램', cli.status, connected ? '연결됨' : cli.status === 'not_connected' ? '미연결' : '연결 끊김',
      connected ? `선택한 프로젝트의 CLI 기록 ${cli.sessions.length}개를 관찰합니다.` : '호스트의 최신 CLI 감지 정보가 없습니다.',
      connected ? 'CLI 창·프로세스·기록의 상태를 개별 세션에서 확인하세요.' : '호스트에서 같은 프로젝트의 연결 프로그램을 실행하세요.', { checkedAt: cli.updatedAt }),
    checkRow('cli:processes', 'cli', 'CLI 실행·종료 감지', connected ? processStatus : cli.status,
      !connected ? '미연결' : processStatus === 'connected' ? '감지 정상' : processStatus === 'unsupported' ? '감지 미지원' : '감지 확인 필요',
      connected && processStatus === 'connected' ? '이 PC의 지원 CLI 프로세스 시작·종료를 확인합니다. 프로젝트 소속은 추정하지 않습니다.' : 'CLI 프로세스의 최신 실행·종료 정보를 확인할 수 없습니다.',
      'Windows 호스트에서 최신 연결 프로그램을 실행하고 통합 감지 목록을 확인하세요.', { checkedAt: cli.processes?.updatedAt || null }),
    checkRow('cli:codex', 'cli', 'Codex CLI 지시 연결', !connected ? 'not_connected' : cli.control?.enabled ? 'ready' : 'disabled',
      !connected ? '미연결' : cli.control?.enabled ? '지시 연결 준비됨' : '관찰만 가능',
      cli.control?.enabled ? '공식 큐 전송이 활성화되어 있습니다. 접수와 실행 완료는 별개입니다.' : '공식 큐로 지시를 보내는 연결이 활성화되지 않았습니다.',
      cli.control?.enabled ? '명령 가능한 세션을 선택해 지시하세요.' : 'Wiki에서 Codex 설치와 --allow-commands 설정을 확인하세요.',
      { provider: 'openai', checkedAt: cli.updatedAt, canControl: connected && cli.control?.enabled === true }),
  ];
  const toolNames = [['claude', 'claude', 'Claude Code'], ['gemini', 'gemini', 'Gemini CLI'], ['muse', 'meta', 'Muse Code']];
  for (const [id, provider, name] of toolNames) {
    const installed = connected ? cli.cliTools?.find((tool) => tool.id === id)?.installed : null;
    const sensor = connected && cli.processes?.status === 'connected' && id !== 'muse';
    const running = sensor ? cli.processes.items.filter((item) => item.provider === provider && item.status === 'running').length : 0;
    const status = running ? 'process_detected' : installed === false ? 'not_installed' : sensor ? 'not_running' : installed ? 'installed' : 'unsupported';
    const labels = { process_detected: '실행 감지', not_installed: '설치 미감지', not_running: '실행 미감지', installed: '설치 감지', unsupported: '감지 정보 없음' };
    checks.push(checkRow(`cli:${id}`, 'cli', name, status, labels[status],
      running ? `실행 프로세스 ${running}개를 감지했습니다. 대화 연결·지시 제어는 지원하지 않습니다.`
        : installed === false ? '호스트 PATH에서 실행 파일 후보를 찾지 못했습니다. 다른 경로의 설치 여부는 확인하지 않습니다.'
          : sensor ? '지원되는 실행 프로세스를 찾지 못했습니다. PATH 설치 감지는 별도로 확인합니다.'
          : installed === true ? 'PATH에서 실행 파일 후보를 찾았습니다. 인증·실행 여부는 확인하지 않았습니다.'
            : id === 'muse' ? 'Muse Code 설치·실행 감지는 현재 지원하지 않습니다.' : '설치 또는 실행 감지 정보가 없습니다. 연결 프로그램과 PATH를 확인하세요.',
      '해당 CLI에서 직접 사용하세요. 웹 탭과 API 연결은 별도로 점검됩니다.', { provider, installed: installed ?? null, checkedAt: cli.updatedAt }));
  }
  for (const provider of PROVIDERS) {
    const browsers = browser.sources?.browsers || [];
    const entries = browser.entries.filter((entry) => entry.source === 'web' && entry.provider === provider.id);
    const live = entries.filter((entry) => entry.status === 'open');
    const count = live.reduce((sum, entry) => sum + entry.tabCount, 0);
    const hasConnected = browsers.some((client) => client.status === 'connected');
    const partial = hasConnected && browsers.some((client) => client.status !== 'connected');
    const status = partial ? 'partial' : count ? 'detected' : hasConnected ? 'no_tabs' : browsers.length ? 'disconnected' : 'not_connected';
    const latest = browsers.map((client) => client.updatedAt).filter(Boolean).sort().at(-1) || null;
    const labels = { detected: '탭 감지', partial: '일부 연결 끊김', no_tabs: '열린 탭 없음', disconnected: '감지 연결 끊김', not_connected: '브라우저 미연결' };
    checks.push(checkRow(`web:${provider.id}`, 'web', `${provider.webName} 웹`, status, labels[status],
      partial ? `현재 탭 ${count}개를 감지했습니다. 일부 브라우저의 최신 상태는 확인할 수 없습니다.`
        : count ? `연결한 브라우저에서 탭 ${count}개를 감지했습니다. 로그인·실행 상태는 확인하지 않습니다.` : '연결한 브라우저 프로필에서 이 서비스의 열린 탭을 확인할 수 없습니다.',
      partial ? '연결이 끊긴 브라우저 프로필에서 사무실 페이지와 감지를 다시 확인하세요.'
        : hasConnected ? '연결한 프로필에서 서비스를 열고 감지 목록을 확인하세요.' : '브라우저 감지 확장프로그램을 설치하고 이 사무실에 연결하세요.',
      { provider: provider.id, checkedAt: latest }));
  }
  return checks;
}

// Environment is read once on server startup. No browser input can choose a URL or credentials.
export function createConnections({ observer, discovery, env = process.env, fetchImpl = fetch, clock = Date.now, timeoutMs = 6000 }) {
  const credentials = new Map(PROVIDERS.map((provider) => {
    const key = provider.keys.map((name) => env[name]).find((value) => typeof value === 'string' && value.trim()) || '';
    const workspace = provider.id === 'claude' ? env.ANTHROPIC_WORKSPACE_ID || '' : '';
    const valid = (value) => !value || (typeof value === 'string' && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value));
    return [provider.id, { key, workspace, valid: valid(key) && valid(workspace) }];
  }));
  const results = new Map();
  let inFlight = null;
  let checkedAt = null;
  let nextCheck = 0;

  function snapshot() {
    const now = clock();
    const checks = localChecks(observer, discovery, now);
    for (const provider of PROVIDERS) {
      const credential = credentials.get(provider.id);
      const result = results.get(provider.id);
      let status = !credential.key ? 'not_configured' : !credential.valid ? 'config_invalid' : inFlight ? 'checking' : result?.status || 'not_checked';
      const [label, message, action] = apiMessages[status];
      const row = checkRow(`api:${provider.id}`, 'api', `${provider.name}${provider.id === 'meta' ? '' : ' API'}`, status, label, message, action,
        { provider: provider.id, configured: Boolean(credential.key), checkedAt: result?.checkedAt || null,
          httpStatus: result?.httpStatus ?? null, latencyMs: result?.latencyMs ?? null });
      if (!inFlight && result && now - Date.parse(result.checkedAt) > FRESHNESS) {
        row.status = 'stale'; row.statusLabel = '재점검 필요';
        row.message = `마지막 결과: ${label}. 점검 후 5분이 지나 현재 연결 상태는 확인되지 않았습니다.`;
        row.action = '연결 점검을 다시 눌러 최신 상태를 확인하세요.';
      }
      checks.push(row);
    }
    return { checkedAt, nextCheckAt: nextCheck ? new Date(nextCheck).toISOString() : null, checking: Boolean(inFlight), checks };
  }

  return {
    snapshot,
    async check(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new ApiError(400, 'INVALID_CONNECTION_CHECK', '연결 점검에는 빈 JSON 객체를 보내세요.');
      if (inFlight) { await inFlight; return snapshot(); }
      if (clock() < nextCheck) return snapshot();
      inFlight = Promise.all(PROVIDERS.map(async (provider) => {
        const credential = credentials.get(provider.id);
        if (!credential.key || !credential.valid) return;
        results.set(provider.id, await probe(provider, credential, { fetchImpl, clock, timeoutMs }));
      }));
      try {
        await inFlight;
        checkedAt = new Date(clock()).toISOString();
        nextCheck = clock() + COOLDOWN;
      } finally { inFlight = null; }
      return snapshot();
    },
  };
}
