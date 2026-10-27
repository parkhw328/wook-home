// A single tooltip lives in the top layer, outside card/map scrolling clips.
export function initializeIdentityTooltip(document) {
  const view = document.defaultView;
  const tooltip = document.createElement('div');
  tooltip.id = 'session-identity-tooltip';
  tooltip.className = 'identity-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('popover', 'manual');
  tooltip.hidden = true;
  const label = document.createElement('span');
  const code = document.createElement('code');
  tooltip.append(label, code);
  let anchor;
  let source;
  let pinned = false;
  let timer;
  let dismissedAnchor;
  let scope;
  let keyboardFocus = false;

  function hide() {
    clearTimeout(timer);
    if (anchor) {
      const describedBy = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== tooltip.id);
      if (describedBy.length) anchor.setAttribute('aria-describedby', describedBy.join(' '));
      else anchor.removeAttribute('aria-describedby');
    }
    if (tooltip.matches(':popover-open')) tooltip.hidePopover();
    tooltip.hidden = true;
    anchor = null;
    source = null;
    pinned = false;
    scope = null;
    keyboardFocus = false;
  }

  function position() {
    if (!anchor) return;
    const box = anchor.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    tooltip.style.left = `${Math.max(8, Math.min(box.left, view.innerWidth - width - 8))}px`;
    const below = box.bottom + 6;
    tooltip.style.top = `${Math.max(8, Math.min(below + height <= view.innerHeight - 8 ? below : box.top - height - 6, view.innerHeight - height - 8))}px`;
  }

  function targetFor(element) {
    if (!(element instanceof view.Element)) return null;
    const button = element.closest('button');
    const identity = button?.matches('[data-session-identity]') ? button : button?.querySelector('[data-session-identity]');
    return identity && !button.disabled ? { anchor: button, source: identity } : null;
  }

  function show(target) {
    clearTimeout(timer);
    if (anchor === target.anchor && source === target.source) return;
    hide();
    anchor = target.anchor;
    source = target.source;
    scope = source.parentElement.closest('[id]');
    keyboardFocus = anchor.matches(':focus-visible');
    label.textContent = source.dataset.identityLabel;
    code.textContent = source.dataset.sessionIdentity;
    (anchor.closest('dialog') || document.fullscreenElement || document.body).append(tooltip);
    anchor.setAttribute('aria-describedby', `${anchor.getAttribute('aria-describedby') || ''} ${tooltip.id}`.trim());
    tooltip.hidden = false;
    tooltip.showPopover?.();
    position();
  }

  function scheduleHide() {
    clearTimeout(timer);
    timer = view.setTimeout(() => {
      if (!pinned && !anchor?.matches(':hover, :focus-visible') && !tooltip.matches(':hover')) hide();
    }, 140);
  }

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    if (tooltip.contains(event.target)) { clearTimeout(timer); return; }
    const target = targetFor(event.target);
    if (target?.anchor === dismissedAnchor) return;
    dismissedAnchor = null;
    if (target) show(target);
  });
  document.addEventListener('pointerout', scheduleHide);
  document.addEventListener('focusin', (event) => {
    const target = targetFor(event.target);
    dismissedAnchor = null;
    if (target && event.target.matches(':focus-visible')) { show(target); keyboardFocus = true; }
    else if (!tooltip.contains(event.target)) hide();
  });
  document.addEventListener('focusout', () => {
    if (!pinned) scheduleHide();
  });
  document.addEventListener('click', (event) => {
    if (tooltip.contains(event.target)) return;
    const button = event.target.closest('button[data-session-identity]');
    if (button && !button.disabled) {
      event.preventDefault();
      event.stopPropagation();
      if (anchor === button && pinned) { dismissedAnchor = anchor; hide(); }
      else { dismissedAnchor = null; show({ anchor: button, source: button }); pinned = true; }
    } else hide();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && anchor) {
      event.preventDefault();
      event.stopPropagation();
      dismissedAnchor = anchor;
      hide();
    }
  }, true);
  document.addEventListener('scroll', (event) => {
    if (!anchor || tooltip.contains(event.target)) return;
    const box = anchor.getBoundingClientRect();
    if (box.bottom < 0 || box.top > view.innerHeight || box.right < 0 || box.left > view.innerWidth) hide();
    else if (pinned || anchor.matches(':hover, :focus-visible')) position();
    else hide();
  }, true);
  view.addEventListener('resize', hide);
  document.addEventListener('fullscreenchange', hide);
  document.addEventListener('close', hide, true);
  // Polling or selection changes must never leave an ID for a stale target.
  new view.MutationObserver(() => {
    if (!anchor) return;
    if (!anchor.isConnected || !source.isConnected) {
      // A refreshed list can replace its DOM while the same ID is being read.
      const replacement = scope?.isConnected && [...scope.querySelectorAll('[data-session-identity]')]
        .find((node) => node.dataset.sessionIdentity === source.dataset.sessionIdentity
          && node.dataset.identityLabel === source.dataset.identityLabel);
      const next = targetFor(replacement);
      if (next && next.anchor.checkVisibility() && (pinned || keyboardFocus || tooltip.matches(':hover') || next.anchor.matches(':hover'))) {
        const keepPinned = pinned;
        const keepFocus = keyboardFocus;
        show(next);
        pinned = keepPinned;
        if (keepFocus) next.anchor.focus({ preventScroll: true });
      } else hide();
    } else if (!anchor.checkVisibility() || anchor.closest('dialog:not([open]), [hidden]')) hide();
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
}
