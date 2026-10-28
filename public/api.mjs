export class ApiError extends Error {
  constructor(message, code = 'REQUEST_ERROR', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 10000);
  try {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? { Accept: 'application/json' } : {
        Accept: 'application/json', 'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
    });
    let value;
    try {
      value = await response.json();
    } catch {
      throw new ApiError('서버 응답을 읽지 못했습니다. 연결 상태를 확인해 주세요.');
    }
    if (!response.ok) {
      if (typeof window !== 'undefined' && ['LOGIN_REQUIRED', 'PASSWORD_CHANGE_REQUIRED'].includes(value.error?.code)) window.location.replace('/login.html');
      throw new ApiError(value.error?.message || '요청을 처리하지 못했습니다.', value.error?.code, response.status);
    }
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal?.aborted) throw error;
    throw new ApiError('서버에 연결할 수 없습니다. 서버 실행 상태를 확인해 주세요.', 'CONNECTION_ERROR');
  } finally {
    clearTimeout(timer);
  }
}
