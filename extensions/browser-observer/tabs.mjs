export const SITE_PATTERNS = [
  'https://chatgpt.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*',
  'https://www.meta.ai/*', 'https://meta.ai/*',
];
const providers = new Map([
  ['chatgpt.com', 'openai'], ['claude.ai', 'claude'], ['gemini.google.com', 'gemini'],
  ['www.meta.ai', 'meta'], ['meta.ai', 'meta'],
]);
const uuid = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const routes = {
  openai: new RegExp(`^/(?:g/[^/]+/)?c/(${uuid})/?$`, 'i'),
  claude: new RegExp(`^/chat/(${uuid})/?$`, 'i'),
  gemini: /^\/app\/([a-f0-9]{8,64})\/?$/i,
  meta: new RegExp(`^/prompt/(${uuid})/?$`, 'i'),
};

export function identifyPage(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
    const provider = providers.get(url.hostname);
    if (!provider) return null;
    const conversation = routes[provider].exec(url.pathname)?.[1]?.toLowerCase();
    return { provider, kind: conversation ? 'conversation' : 'page', conversation };
  } catch { return null; }
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

// Only derived identifiers leave the extension. URL queries, titles, content,
// cookies, account identifiers, and unrelated/incognito tabs are never exported.
export async function summarizeTabs(tabs, clientId, now = Date.now()) {
  const eligible = tabs.filter((tab) => !tab.incognito && Number.isInteger(tab.id) && tab.id >= 0 && identifyPage(tab.url));
  const rows = [];
  for (const tab of eligible.slice(0, 128)) {
    const page = identifyPage(tab.url);
    rows.push({
      id: String(tab.id), provider: page.provider, kind: page.kind,
      key: await digest(`${clientId}:${page.provider}:${page.conversation || `tab:${tab.id}`}`),
    });
  }
  return { schemaVersion: 1, clientId, observedAt: new Date(now).toISOString(), truncated: eligible.length > 128, tabs: rows };
}

export function isOfficeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      && !url.username && !url.password && ['/', '/index.html'].includes(url.pathname);
  } catch { return false; }
}

export function officeOrigins(value = 'http://localhost:8080/') {
  if (!isOfficeUrl(value)) throw new Error('INVALID_OFFICE');
  const url = new URL(value);
  const port = url.port ? `:${url.port}` : '';
  return [`http://localhost${port}`, `http://127.0.0.1${port}`];
}
