import { SITE_PATTERNS, isOfficeUrl, officeOrigins, summarizeTabs } from './tabs.mjs';

// Storage holds only a random profile alias, never browsing data.
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
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'stackqueue:collect' || !sender.tab || sender.frameId !== 0 || !isOfficeUrl(sender.url) || sender.tab.incognito) return;
  (async () => {
    const settings = await chrome.storage.local.get('officeUrl');
    if (!officeOrigins(settings.officeUrl).includes(new URL(sender.url).origin)) throw new Error('OFFICE_NOT_ALLOWED');
    if (!collecting) collecting = (async () => {
      const id = await clientId();
      const tabs = await chrome.tabs.query({ url: SITE_PATTERNS });
      return summarizeTabs(tabs, id);
    })().finally(() => { collecting = null; });
    return collecting;
  })().then((snapshot) => reply({ ok: true, snapshot })).catch(() => reply({ ok: false }));
  return true;
});
