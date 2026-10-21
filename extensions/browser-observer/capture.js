(() => {
  if (window.top !== window) return;
  const sites = {
    'chatgpt.com': ['openai', /^\/(?:g\/[^/]+\/)?c\/([a-f0-9-]{36})\/?$/i, 'chatgpt.com', 'c'],
    'claude.ai': ['claude', /^\/chat\/([a-f0-9-]{36})\/?$/i, 'claude.ai', 'chat'],
    'gemini.google.com': ['gemini', /^\/app\/([a-f0-9]{8,64})\/?$/i, 'gemini.google.com', 'app'],
    'www.meta.ai': ['meta', /^\/prompt\/([a-f0-9-]{36})\/?$/i, 'www.meta.ai', 'prompt'],
    'meta.ai': ['meta', /^\/prompt\/([a-f0-9-]{36})\/?$/i, 'www.meta.ai', 'prompt'],
  };
  const digest = async (value) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'stackqueue:capture-public') return;
    (async () => {
      const config = sites[location.hostname];
      const match = config?.[1].exec(location.pathname);
      if (!match) return { ok: false };
      const [provider, , host, route] = config;
      const url = `https://${host}/${route}/${match[1].toLowerCase()}`;
      if (url !== message.url) return { ok: false };
      const settings = await chrome.storage.local.get('searchSelections');
      if (!settings.searchSelections?.some((entry) => entry.url === url)) return { ok: false };
      const raw = globalThis.StackQueueCapture.extract(document, provider);
      let previousUser = '';
      let duplicate = 0;
      const messages = [];
      let characters = 0;
      for (const item of raw) {
        if (item.role === 'user') { previousUser = item.content; duplicate = 0; }
        const identity = item.identity || `${item.role}:${previousUser}:${item.role === 'user' ? item.content : duplicate++}`;
        if (characters + item.content.length > 500000) break;
        characters += item.content.length;
        messages.push({ key: await digest(`${provider}:${identity}`), role: item.role, content: item.content, truncated: item.truncated });
      }
      return { ok: true, url, messages, truncated: messages.length < raw.length || raw.length >= 1000 || raw.some((item) => item.truncated) };
    })().then(reply).catch(() => reply({ ok: false }));
    return true;
  });
})();
