import { escapeHtml as esc } from './model.mjs';

const icons = {
  office: '<path d="M3 11h18v4H3zM5 15v5m14-5v5M8 11V4h8v7"/>',
  meeting: '<rect x="6" y="8" width="12" height="8" rx="2"/><path d="M9 4v4m6-4v4M9 16v4m6-4v4M2 12h4m12 0h4"/>',
  executive: '<path d="m4 5 4 4 4-6 4 6 4-4-2 12H6zM7 21h10"/>',
  lounge: '<path d="M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M4 10a2 2 0 0 1 2 2v3h12v-3a2 2 0 0 1 4 0v7H2v-7a2 2 0 0 1 2-2Zm1 9v2m14-2v2"/>',
  warehouse: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  pantry: '<path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Zm13 1h2a3 3 0 0 1 0 6h-2M7 2v3m4-3v3m4-3v3"/>',
  building: '<path d="M4 21V3h16v18M2 21h20M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2M10 21v-3h4v3"/>',
};
const icon = (kind) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind] || icons.office}</svg>`;

export function roomNavigationMarkup(rooms) {
  return rooms.toSorted((a, b) => b.floor - a.floor).map((room) => {
    const label = `${room.floor}층 · ${room.projectName ? `${room.projectName} · ` : ''}${room.name}`;
    return `<button type="button" class="room-nav-button" data-room="${esc(room.id)}" data-room-label="${esc(label)}" aria-label="${esc(label)}" aria-pressed="false"><span aria-hidden="true">${room.floor}F</span>${icon(room.kind || room.id)}</button>`;
  }).join('') + `<button type="button" class="room-nav-button" data-floor="0" data-room-label="전체 건물" aria-label="전체 건물" aria-pressed="false">${icon('building')}</button>`;
}

// Popovers remain readable outside the scrolling navigation, including fullscreen.
export function initializeRoomTooltip(nav) {
  const document = nav.ownerDocument;
  const view = document.defaultView;
  const tooltip = document.createElement('div');
  tooltip.id = 'room-navigation-tooltip';
  tooltip.className = 'room-navigation-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('popover', 'manual');
  tooltip.hidden = true;
  let anchor, timer, dismissed, touch = false, pinned = false, keyboardFocus = false;
  function hide() {
    clearTimeout(timer);
    anchor?.removeAttribute('aria-describedby');
    if (tooltip.matches(':popover-open')) tooltip.hidePopover();
    tooltip.hidden = true; anchor = null; pinned = false;
  }
  function position() {
    if (!anchor) return;
    const box = anchor.getBoundingClientRect();
    const bounds = nav.getBoundingClientRect();
    if (box.right <= bounds.left || box.left >= bounds.right || box.bottom < 0 || box.top > view.innerHeight) { hide(); return; }
    tooltip.style.left = `${Math.max(8, Math.min(box.left, view.innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(box.top - tooltip.offsetHeight - 6, view.innerHeight - tooltip.offsetHeight - 8))}px`;
  }
  function show(button) {
    clearTimeout(timer);
    if (!button || button.disabled || dismissed === button) return;
    if (anchor !== button) hide();
    anchor = button;
    tooltip.textContent = button.dataset.roomLabel;
    (document.fullscreenElement || document.body).append(tooltip);
    anchor.setAttribute('aria-describedby', tooltip.id);
    tooltip.hidden = false;
    tooltip.showPopover?.(); position();
  }
  function scheduleHide() {
    clearTimeout(timer);
    timer = view.setTimeout(() => {
      if (!pinned && !anchor?.matches(':hover, :focus-visible') && !tooltip.matches(':hover')) hide();
    }, 150);
  }
  nav.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'touch' && !keyboardFocus) show(event.target.closest('[data-room-label]'));
  });
  nav.addEventListener('pointermove', (event) => {
    // Scrolling a focused button into view can move another button under a
    // stationary pointer. Only deliberate pointer movement takes precedence.
    if (event.pointerType !== 'touch' && (event.movementX || event.movementY)) {
      keyboardFocus = false; show(event.target.closest('[data-room-label]'));
    }
  });
  nav.addEventListener('pointerout', (event) => { if (!event.target.closest('[data-room-label]')?.contains(event.relatedTarget)) dismissed = null; scheduleHide(); });
  tooltip.addEventListener('pointerenter', () => clearTimeout(timer));
  tooltip.addEventListener('pointerleave', scheduleHide);
  nav.addEventListener('focusin', (event) => {
    dismissed = null;
    keyboardFocus = event.target.matches(':focus-visible');
    if (keyboardFocus) show(event.target.closest('[data-room-label]'));
  });
  nav.addEventListener('focusout', scheduleHide);
  document.addEventListener('pointerdown', (event) => {
    touch = event.pointerType === 'touch';
    keyboardFocus = false;
    if (!nav.contains(event.target) && !tooltip.contains(event.target)) hide();
  });
  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-room-label]');
    if (touch && button) { dismissed = null; show(button); pinned = true; }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && anchor) { event.preventDefault(); event.stopPropagation(); dismissed = anchor; hide(); }
  }, true);
  document.addEventListener('scroll', position, true);
  document.addEventListener('fullscreenchange', hide);
  view.addEventListener('resize', hide);
  view.addEventListener('hashchange', hide);
  new view.MutationObserver(() => { if (anchor && (!anchor.isConnected || !anchor.checkVisibility() || document.querySelector('dialog[open]'))) hide(); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
}
