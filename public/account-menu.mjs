// A disclosure keeps account actions within reach without occupying a nav row.
export function initializeAccountMenu(document) {
  const root = document.querySelector('#account-menu');
  const trigger = root.querySelector('#account-menu-button');
  const panel = root.querySelector('#account-menu-panel');
  function close({ restoreFocus = false } = {}) {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  trigger.addEventListener('click', () => {
    const expanded = panel.hidden;
    panel.hidden = !expanded;
    trigger.setAttribute('aria-expanded', String(expanded));
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    close({ restoreFocus: true });
  });
  for (const type of ['pointerdown', 'focusin']) {
    document.addEventListener(type, (event) => {
      if (!panel.hidden && !root.contains(event.target)) close();
    });
  }
  document.defaultView.addEventListener('hashchange', () => close());
  return { close };
}
