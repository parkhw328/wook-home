import { SITE_PATTERNS, isOfficeUrl, officeOrigins, summarizeTabs } from './tabs.mjs';
import { collectSearchTabs } from './search.mjs';

// Metadata discovery remains separate from opt-in per-conversation search capture.
let client;
async function clientId() {
  if (!client) client = (async () => {
    const value = await chrome.storage.local.get('clientId');
    if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.clientId)) return value.clientId;
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ clientId: id });
    return id;
  })().catch((error) => { client = null; throw error; });
  return client;
}

let collecting;
let searchCollecting;
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!['stackqueue:collect', 'stackqueue:search-collect'].includes(message?.type) || !sender.tab || sender.frameId !== 0 || !isOfficeUrl(sender.url) || sender.tab.incognito) return;
  (async () => {
    const settings = await chrome.storage.local.get('officeUrl');
    if (!officeOrigins(settings.officeUrl).includes(new URL(sender.url).origin)) throw new Error('OFFICE_NOT_ALLOWED');
    if (message.type === 'stackqueue:search-collect') {
      if (!searchCollecting) searchCollecting = (async () => {
        const chosen = await chrome.storage.local.get('searchSelections');
        const tabs = await chrome.tabs.query({ url: SITE_PATTERNS });
        const sessions = await collectSearchTabs(tabs, chosen.searchSelections, (tabId, url) => Promise.race([
          chrome.tabs.sendMessage(tabId, { type: 'stackqueue:capture-public', url }, { frameId: 0 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('CAPTURE_TIMEOUT')), 1500)),
        ]));
        return { clientId: await clientId(), sessions };
      })().finally(() => { searchCollecting = null; });
      return searchCollecting;
    }
    if (!collecting) collecting = (async () => {
      const id = await clientId();
      const tabs = await chrome.tabs.query({ url: SITE_PATTERNS });
      return summarizeTabs(tabs, id);
    })().finally(() => { collecting = null; });
    return collecting;
  })().then((snapshot) => reply({ ok: true, snapshot })).catch(() => reply({ ok: false }));
  return true;
});
