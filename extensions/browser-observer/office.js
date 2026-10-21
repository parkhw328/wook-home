// This script runs only on local pages. Detection starts only after the office
// explicitly asks; it cannot send to a remote endpoint or inspect page content.
(() => {
  if (!['/', '/index.html'].includes(location.pathname) || window.top !== window) return;
  const busy = new Set();
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin || !['stackqueue:discover', 'stackqueue:search-request'].includes(event.data?.type)
      || !/^[a-f0-9-]{36}$/.test(event.data.requestId) || busy.has(event.data.type)
      || document.querySelector('meta[name="application-name"]')?.content !== 'wook-home') return;
    busy.add(event.data.type);
    const requestId = event.data.requestId;
    let result;
    const search = event.data.type === 'stackqueue:search-request';
    try { result = await chrome.runtime.sendMessage({ type: search ? 'stackqueue:search-collect' : 'stackqueue:collect' }); }
    catch { result = { ok: false }; }
    window.postMessage({ type: search ? 'stackqueue:search-received' : 'stackqueue:discovered', requestId, ...result }, location.origin);
    busy.delete(event.data.type);
  });
})();
