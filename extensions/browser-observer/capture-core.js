// Isolated content-script world. Only explicit public message containers are read.
// Unknown layouts fail closed; there is deliberately no document-body fallback.
globalThis.StackQueueCapture = {
  extract(root, provider) {
    const selectors = {
      openai: '[data-message-author-role="user"], [data-message-author-role="assistant"]',
      claude: '[data-testid="user-message"], .font-claude-response',
      gemini: 'user-query, model-response',
      meta: '[data-message-author-role="user"], [data-message-author-role="assistant"], [data-testid="user-message"], [data-testid="assistant-message"]',
    };
    if (!selectors[provider]) return [];
    const messages = [];
    const nodes = [...root.querySelectorAll(selectors[provider])].slice(-1000);
    for (const node of nodes) {
      if (node.closest('[hidden], [aria-hidden="true"], [data-testid*="thinking"], [data-testid*="reasoning"], thoughts-panel, thinking-block')) continue;
      const role = node.getAttribute('data-message-author-role')
        || (node.matches('[data-testid="user-message"], user-query') ? 'user' : 'assistant');
      if (!['user', 'assistant'].includes(role)) continue;
      const copy = node.cloneNode(true);
      copy.querySelectorAll('script, style, button, textarea, input, nav, [hidden], [aria-hidden="true"], [data-testid*="thinking"], [data-testid*="reasoning"], [data-testid*="tool"], thoughts-panel, thinking-block, .thinking-block, .tool-result').forEach((element) => element.remove());
      const content = copy.textContent.trim();
      if (!content) continue;
      messages.push({ role, content: content.slice(0, 20000), truncated: content.length > 20000,
        identity: node.getAttribute('data-message-id') || node.closest('[data-message-id]')?.getAttribute('data-message-id') || node.id || null });
    }
    return messages;
  },
};
