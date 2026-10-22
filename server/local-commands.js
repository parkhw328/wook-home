import { createHash } from 'node:crypto';
import { closeSync, fstatSync, mkdirSync, openSync, readSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from './office.js';
import { readBridgeSettings } from './bridge-settings.js';

export const commandId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const commandStates = new Set(['pending', 'sending', 'accepted', 'failed', 'unknown', 'expired']);
const codes = new Set(['QUEUED', 'CLI_REJECTED', 'DELIVERY_UNCERTAIN', 'REQUEST_EXPIRED', 'SESSION_UNAVAILABLE', 'BRIDGE_RESTARTED']);

export function readCommand(file) {
  let descriptor;
  try {
    descriptor = openSync(file, 'r');
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > 24576) return null;
    const buffer = Buffer.alloc(info.size);
    readSync(descriptor, buffer, 0, buffer.length, 0);
    const value = JSON.parse(buffer.toString('utf8'));
    if (value?.schemaVersion !== 1 || !commandId.test(value.id) || !commandId.test(value.sessionId)
      || !commandStates.has(value.status) || !Number.isFinite(Date.parse(value.createdAt))
      || !Number.isFinite(Date.parse(value.updatedAt))) return null;
    return value;
  } catch { return null; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

export function commandReceipt(value) {
  return {
    id: value.id, sessionId: value.sessionId, status: value.status,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    ...(codes.has(value.code) ? { code: value.code } : {}),
  };
}

export function createLocalCommands({ directory, observer, office, clock = Date.now }) {
  const missing = () => new ApiError(404, 'COMMAND_NOT_FOUND', '지시 접수 기록이 없습니다.');
  const receipt = (value) => {
    // Report deadlines even when the host is stopped, without rewriting a
    // file the host may currently own or guessing that a send did not occur.
    if (value.status === 'pending' && clock() > Date.parse(value.expiresAt)) return commandReceipt({ ...value, status: 'expired', code: 'REQUEST_EXPIRED' });
    if (value.status === 'sending' && clock() - Date.parse(value.updatedAt) > 20000) return commandReceipt({ ...value, status: 'unknown', code: 'DELIVERY_UNCERTAIN' });
    return commandReceipt(value);
  };
  return {
    get(id) {
      if (!directory || !commandId.test(id)) throw missing();
      const value = readCommand(join(directory, `${id}.json`));
      if (!value) throw missing();
      return receipt(value);
    },
    submit(sessionId, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((key) => !['id', 'content'].includes(key))
        || !commandId.test(input.id) || typeof input.content !== 'string'
        || !input.content.trim() || input.content.length > 4000 || input.content.includes('\0')) {
        throw new ApiError(400, 'VALIDATION_ERROR', '지시 ID와 1~4000자의 내용을 입력해 주세요.');
      }
      if (!directory) throw new ApiError(409, 'CONTROL_UNAVAILABLE', '호스트 연결 프로그램의 명령 전송을 켜 주세요.');
      const content = input.content.trim();
      const fingerprint = createHash('sha256').update(`${sessionId}\n${content}`).digest('hex');
      const file = join(directory, `${input.id}.json`);
      const existing = readCommand(file);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new ApiError(409, 'COMMAND_ID_CONFLICT', '이미 다른 지시에 사용된 ID입니다.');
        return receipt(existing);
      }
      if (office.snapshot().office.paused) throw new ApiError(409, 'OFFICE_PAUSED', '사무실을 재개한 뒤 지시해 주세요.');
      const state = observer.snapshot();
      const settings = readBridgeSettings(directory);
      if (settings.status === 'unavailable' || (settings.status === 'ready' && !settings.options.commands)) throw new ApiError(409, 'CONTROL_UNAVAILABLE', '연결 설정에서 Codex 지시 전송을 켜고 적용 상태를 확인해 주세요.');
      if (!state.control.enabled) throw new ApiError(409, 'CONTROL_UNAVAILABLE', '호스트 연결 프로그램의 명령 전송을 확인해 주세요.');
      if (!state.sessions.some((session) => session.id === sessionId)) throw new ApiError(404, 'SESSION_NOT_FOUND', '현재 프로젝트에서 관찰 중인 세션을 선택해 주세요.');
      mkdirSync(directory, { recursive: true });
      if (readdirSync(directory).filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name)).length >= 1000) throw new ApiError(429, 'COMMAND_LIMIT', '로컬 지시 기록이 가득 찼습니다. Wiki의 기록 정리를 확인해 주세요.');
      const now = clock();
      const value = {
        schemaVersion: 1, id: input.id, sessionId, bridgeId: state.control.bridgeId,
        content, fingerprint, status: 'pending',
        createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60000).toISOString(),
      };
      // Exclusive creation preserves idempotency across HTTP retries and restarts.
      // The host ignores partial JSON and retries reading on its next scan.
      try { writeFileSync(file, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if (error.code === 'EEXIST') throw new ApiError(409, 'COMMAND_ID_CONFLICT', '동일 지시의 접수 상태를 먼저 확인해 주세요.');
        throw new ApiError(503, 'COMMAND_STORAGE_UNAVAILABLE', '명령 폴더의 연결과 쓰기 권한을 확인해 주세요.');
      }
      return receipt(value);
    },
  };
}
