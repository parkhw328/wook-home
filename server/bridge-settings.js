import { accessSync, closeSync, constants, fstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError } from './office.js';

export const bridgeDefaults = Object.freeze({ conversations: false, searchHistory: false, commands: false });
const keys = Object.keys(bridgeDefaults);
const revisionPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const validBridgeOptions = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => typeof value[key] === 'boolean');
export const bridgeSettingsFile = (directory) => join(directory, 'bridge-settings.json');

// Shared by the HTTP server and the host. Never fall back to CLI permissions
// when a saved file is malformed or unreadable.
export function readBridgeSettings(directory) {
  if (!directory) return { status: 'unavailable' };
  let descriptor;
  try {
    descriptor = openSync(bridgeSettingsFile(directory), 'r');
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > 4096) throw new Error('Invalid settings');
    const buffer = Buffer.alloc(info.size);
    readSync(descriptor, buffer, 0, info.size, 0);
    const data = JSON.parse(buffer.toString('utf8'));
    if (data.schemaVersion !== 1 || !revisionPattern.test(data.revision) || !validBridgeOptions(data.options)) throw new Error('Invalid settings');
    return { status: 'ready', revision: data.revision, options: data.options };
  } catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'unavailable' }; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

export function resolveBridgeSettings(saved, initial = bridgeDefaults) {
  return { revision: saved.revision || null, options: saved.status === 'ready' ? saved.options
    : saved.status === 'missing' ? { ...initial } : { ...bridgeDefaults }, error: saved.status === 'unavailable' };
}

export function readSettingsAck(value) {
  if (value?.version !== 1 || !validBridgeOptions(value.options)
    || (value.revision !== null && !revisionPattern.test(value.revision))) return null;
  return { version: 1, revision: value.revision, options: value.options, error: value.error === true };
}

export function createBridgeSettings({ directory, observer }) {
  function snapshot() {
    const saved = readBridgeSettings(directory);
    const local = observer.snapshot();
    const ack = local.settings;
    const connected = local.status === 'connected';
    const options = saved.status === 'ready' ? saved.options : saved.status === 'missing'
      ? ack?.options || { conversations: local.conversations?.enabled === true, searchHistory: local.searchHistory?.enabled === true, commands: local.control?.enabled === true }
      : { ...bridgeDefaults };
    const status = !directory || saved.status === 'unavailable' ? 'storage_error' : !connected ? 'not_connected' : !ack ? 'upgrade_required'
      : ack.error ? 'bridge_error' : saved.status === 'ready' && (saved.revision !== ack.revision || keys.some((key) => saved.options[key] !== ack.options[key])) ? 'pending'
        : 'applied';
    let writable = Boolean(directory);
    if (directory) {
      try { accessSync(directory, constants.W_OK); }
      catch (error) { writable = error.code === 'ENOENT'; }
    }
    return { revision: saved.revision || null, saved: saved.status === 'ready', options, status, writable,
      workspace: local.workspace || '', updatedAt: local.updatedAt, controlReason: local.control?.reason || 'disconnected',
      applied: connected ? { conversations: local.conversations?.enabled === true, searchHistory: local.searchHistory?.enabled === true, commands: local.control?.enabled === true } : null };
  }
  return {
    snapshot,
    configure(input) {
      if (!input || Object.keys(input).some((key) => !['revision', 'options'].includes(key)) || !validBridgeOptions(input.options)
        || (input.revision !== null && !revisionPattern.test(input.revision))) throw new ApiError(400, 'INVALID_SETTINGS', '설정 값을 다시 확인해 주세요.');
      const saved = readBridgeSettings(directory);
      if (!directory || saved.status === 'unavailable') throw new ApiError(503, 'SETTINGS_STORAGE_UNAVAILABLE', '설정을 읽을 수 없습니다. 연결 프로그램과 사무실의 공유 폴더 권한을 확인해 주세요.');
      if ((saved.revision || null) !== input.revision) throw new ApiError(409, 'SETTINGS_CONFLICT', '다른 화면에서 설정을 변경했습니다. 저장된 설정 다시 불러기를 누른 뒤 선택해 주세요.');
      const revision = randomUUID();
      const temporary = join(directory, `.bridge-settings-${revision}.tmp`);
      try {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, revision, options: input.options }) + '\n', { flag: 'wx', mode: 0o600 });
        renameSync(temporary, bridgeSettingsFile(directory));
      } catch {
        try { rmSync(temporary, { force: true }); } catch { /* Report a sanitized storage error. */ }
        throw new ApiError(503, 'SETTINGS_STORAGE_UNAVAILABLE', '설정을 저장하지 못했습니다. 연결 프로그램과 사무실이 같은 계정 권한으로 공유 폴더를 읽고 쓸 수 있는지 확인해 주세요.');
      }
      return snapshot();
    },
  };
}
