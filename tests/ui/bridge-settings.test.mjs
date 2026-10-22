import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsMessage } from '../../public/bridge-settings.mjs';

test('settings feedback distinguishes saved preferences from host application and control capability', () => {
  assert.match(settingsMessage({ status: 'not_connected' }), /실행 대기/);
  assert.match(settingsMessage({ status: 'upgrade_required' }), /연결 프로그램만 다시/);
  assert.match(settingsMessage({ status: 'pending' }), /적용 확인을 기다/);
  assert.match(settingsMessage({ status: 'applied', saved: true, options: { commands: true }, applied: { commands: false } }), /지시 전송은 준비되지/);
  assert.match(settingsMessage({ status: 'applied', saved: true, options: { commands: false }, applied: { commands: false } }), /적용했습니다/);
  assert.match(settingsMessage({ status: 'storage_error' }), /읽을 수 없습니다/);
});
