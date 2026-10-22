// Run before styles and the first paint; theme changes never rebuild the UI.
(() => {
  const key = 'wook-home.theme';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const normalize = (value) => ['light', 'dark'].includes(value) ? value : 'system';
  let storage;
  let preference = 'system';
  try {
    storage = window.localStorage;
    preference = normalize(storage.getItem(key));
  } catch { /* Keep a working in-memory choice when browser storage is blocked. */ }

  function apply() {
    const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a1120' : '#f7f4f2');
    document.querySelectorAll('[data-theme-choice]').forEach((select) => { select.value = preference; });
    window.dispatchEvent(new CustomEvent('office-theme-change', { detail: { theme } }));
  }

  apply();
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-choice]').forEach((select) => {
      select.value = preference;
      select.addEventListener('change', () => {
        preference = normalize(select.value);
        try { storage?.setItem(key, preference); } catch { /* Selection still applies to this tab. */ }
        apply();
      });
    });
  }, { once: true });
  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', (event) => {
    if (storage && event.storageArea === storage && (event.key === key || event.key === null)) {
      preference = normalize(event.newValue);
      apply();
    }
  });
})();
