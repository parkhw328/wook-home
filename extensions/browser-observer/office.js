// This script runs only on local pages. Detection starts only after the office
// explicitly asks; it cannot send to a remote endpoint or inspect page content.
(() => {
  if (!['/', '/index.html'].includes(location.pathname) || window.top !== window) return;
  let busy = false;
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'stackqueue:discover'
      || !/^[a-f0-9-]{36}$/.test(event.data.requestId) || busy
      || document.querySelector('meta[name="application-name"]')?.content !== 'wook-home') return;
    busy = true;
    const requestId = event.data.requestId;
    let result;
    try { result = await chrome.runtime.sendMessage({ type: 'stackqueue:collect' }); }
    catch { result = { ok: false }; }
    window.postMessage({ type: 'stackqueue:discovered', requestId, ...result }, location.origin);
    busy = false;
  });
})();
