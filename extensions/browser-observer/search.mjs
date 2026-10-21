import { identifyPage } from './tabs.mjs';

export function searchConversation(url) {
  const page = identifyPage(url);
  if (page?.kind !== 'conversation') return null;
  const sites = { openai: ['chatgpt.com', 'c'], claude: ['claude.ai', 'chat'], gemini: ['gemini.google.com', 'app'], meta: ['www.meta.ai', 'prompt'] };
  const [host, route] = sites[page.provider];
  return { provider: page.provider, key: `${page.provider}:${page.conversation}`, url: `https://${host}/${route}/${page.conversation}` };
}

// A selection stores only the canonical chosen conversation, never its title or text.
export function selectedConversations(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((entry) => {
    const item = searchConversation(entry?.url);
    if (!item || seen.has(item.key) || seen.size >= 50) return [];
    seen.add(item.key);
    return [item];
  });
}

export async function collectSearchTabs(tabs, selected, capture) {
  const result = [];
  let characters = 0;
  const captured = await Promise.all(selectedConversations(selected).map(async (entry) => {
    const open = tabs.filter((tab) => !tab.incognito && searchConversation(tab.url)?.key === entry.key);
    const responses = await Promise.all(open.slice(0, 3).map(async (tab) => {
      try { return await capture(tab.id, entry.url); } catch { return null; }
    }));
    const data = responses.find((response) => response?.ok && response.url === entry.url && Array.isArray(response.messages) && response.messages.length);
    return { entry, data, isOpen: Boolean(open.length) };
  }));
  for (const { entry, data, isOpen } of captured) {
    const messages = [];
    for (const message of (data?.messages || []).slice(0, 1000)) {
      if (!/^[a-f0-9]{64}$/.test(message.key) || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') continue;
      const content = message.content.slice(0, 20000);
      if (characters + content.length > 500000) break;
      characters += content.length;
      messages.push({ key: message.key, role: message.role, content, timestamp: null, truncated: Boolean(message.truncated) });
    }
    result.push({ provider: entry.provider, url: entry.url, observation: data ? 'open' : isOpen ? 'unavailable' : 'closed', messages,
      truncated: Boolean(data?.truncated || (data && messages.length < data.messages.length)) });
  }
  return result;
}
