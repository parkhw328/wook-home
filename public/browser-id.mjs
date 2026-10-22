// getRandomValues is also available on the explicitly configured LAN HTTP URL.
export function browserId(cryptoSource = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === 'function') return cryptoSource.randomUUID();
  if (typeof cryptoSource?.getRandomValues !== 'function') throw new Error('이 브라우저에서 요청 식별자를 만들 수 없습니다. 최신 브라우저에서 다시 시도해 주세요.');
  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let importClient;
export function searchImportClient() {
  if (importClient) return importClient;
  try { importClient = localStorage.getItem('stackqueue-search-import'); } catch { /* Memory works when browser storage is blocked. */ }
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(importClient || '')) importClient = browserId();
  try { localStorage.setItem('stackqueue-search-import', importClient); } catch { /* Do not block an explicit import. */ }
  return importClient;
}

export function localExtensionAvailable(location = globalThis.location) {
  return location?.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname);
}
