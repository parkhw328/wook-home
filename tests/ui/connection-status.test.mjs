import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionTone, connectionBadge } from '../../public/connection-status.mjs';

test('healthy observation, activity, attention, errors and unused connections have distinct tones', () => {
  for (const status of ['connected', 'ready', 'running', 'process_detected', 'detected', 'open', 'reachable', 'observing', 'applied', 'enabled']) assert.equal(connectionTone(status), 'healthy', status);
  for (const status of ['working', 'checking', 'installed']) assert.equal(connectionTone(status), 'info', status);
  for (const status of ['partial', 'stale', 'unknown', 'unavailable', 'not_checked', 'no_models', 'rate_limited', 'config_invalid', 'pending', 'upgrade_required', 'interrupted']) assert.equal(connectionTone(status), 'warning', status);
  for (const status of ['disconnected', 'auth_failed', 'forbidden', 'request_rejected', 'timeout', 'network_error', 'invalid_response', 'service_error', 'redirect_blocked', 'storage_error', 'bridge_error']) assert.equal(connectionTone(status), 'error', status);
  for (const status of ['idle', 'exited', 'ended', 'missing', 'disabled', 'not_connected', 'not_configured', 'unsupported', 'not_installed', 'not_running', 'no_tabs']) assert.equal(connectionTone(status), 'neutral', status);
});

test('new or malicious status codes default to attention and badge labels stay escaped text', () => {
  for (const status of [undefined, 'new_status', '__proto__', '"><img src=x>']) assert.equal(connectionTone(status), 'warning');
  const markup = connectionBadge('<script>unsafe()</script>', 'open');
  assert.match(markup, /data-tone="healthy"/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script>|실행 중|로그인/);
  assert.match(markup, /aria-hidden="true"/);
  // The icon shapes supplement, rather than replace, readable labels and color.
  assert.notEqual(connectionBadge('상태', 'connected'), connectionBadge('상태', 'disabled'));
});
