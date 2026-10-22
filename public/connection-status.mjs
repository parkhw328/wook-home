import { escapeHtml as esc } from './model.mjs';

// Observation health is separate from execution and from deliberately unused features.
const tones = {
  healthy: ['connected', 'ready', 'running', 'process_detected', 'detected', 'open', 'reachable', 'observing', 'applied', 'enabled'],
  info: ['working', 'checking', 'loading', 'installed'],
  warning: ['unknown', 'unavailable', 'partial', 'stale', 'not_checked', 'no_models', 'rate_limited', 'config_invalid', 'pending', 'upgrade_required', 'interrupted'],
  error: ['disconnected', 'auth_failed', 'forbidden', 'request_rejected', 'timeout', 'network_error', 'invalid_response', 'service_error', 'redirect_blocked', 'storage_error', 'bridge_error', 'failed'],
  neutral: ['idle', 'exited', 'ended', 'missing', 'disabled', 'not_connected', 'not_configured', 'unsupported', 'not_installed', 'not_running', 'no_tabs'],
};
const paths = {
  healthy: '<circle cx="10" cy="10" r="8"/><path d="m6 10 3 3 5-6"/>',
  info: '<circle cx="10" cy="10" r="8"/><path d="M10 9v6m0-10v.5"/>',
  warning: '<path d="m10 2 9 16H1Z"/><path d="M10 7v4m0 3v.5"/>',
  error: '<circle cx="10" cy="10" r="8"/><path d="m7 7 6 6m0-6-6 6"/>',
  neutral: '<circle cx="10" cy="10" r="8"/><path d="M6 10h8"/>',
};

export function connectionTone(status) {
  return Object.keys(tones).find((tone) => tones[tone].includes(status)) || 'warning';
}

export function connectionBadge(label, status) {
  const tone = connectionTone(status);
  return `<span class="connection-state" data-tone="${tone}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[tone]}</svg><span>${esc(label)}</span></span>`;
}

export function updateConnectionBadge(element, label, status) {
  const markup = connectionBadge(label, status);
  if (element.innerHTML !== markup) element.innerHTML = markup;
}
