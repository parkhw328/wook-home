export function readCliTools(value, connected) {
  const ids = ['codex', 'claude', 'gemini', 'muse'];
  return ids.map((id) => {
    const item = Array.isArray(value) && value.length <= 4 ? value.find((entry) => entry?.id === id) : null;
    return { id, installed: connected && typeof item?.installed === 'boolean' ? item.installed : null };
  });
}
