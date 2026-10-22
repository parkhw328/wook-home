import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsMessage, settingPresentation } from '../../public/bridge-settings.mjs';

test('settings feedback distinguishes saved preferences from host application and control capability', () => {
  assert.match(settingsMessage({ status: 'not_connected' }), /실행 대기/);
  assert.match(settingsMessage({ status: 'upgrade_required' }), /연결 프로그램만 다시/);
  assert.match(settingsMessage({ status: 'pending' }), /적용 확인을 기다/);
  assert.match(settingsMessage({ status: 'applied', saved: true, options: { commands: true }, applied: { commands: false } }), /지시 전송은 준비되지/);
  assert.match(settingsMessage({ status: 'applied', saved: true, options: { commands: false }, applied: { commands: false } }), /적용했습니다/);
  assert.match(settingsMessage({ status: 'storage_error' }), /읽을 수 없습니다/);
});

test('feature indicators show actual application and never stale success after read or bridge errors', () => {
  const state = { status: 'applied', options: { commands: true }, applied: { conversations: true, searchHistory: false, commands: false } };
  assert.equal(settingPresentation(state, 'conversations').status, 'enabled');
  assert.equal(settingPresentation(state, 'searchHistory').status, 'disabled');
  assert.equal(settingPresentation(state, 'commands').status, 'unavailable');
  assert.equal(settingPresentation({ ...state, status: 'pending' }, 'conversations').status, 'pending');
  assert.equal(settingPresentation({ ...state, status: 'bridge_error' }, 'conversations').status, 'bridge_error');
  assert.equal(settingPresentation(state, 'conversations', false).status, 'disconnected');
  assert.equal(settingPresentation({ status: 'not_connected', applied: null }, 'conversations').status, 'not_connected');
  assert.equal(settingPresentation(undefined, 'conversations').status, 'loading');
});
