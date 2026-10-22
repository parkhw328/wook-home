// One active modal per document. Cleanup happens before close() queues its event,
// so an old close event cannot clear a newly opened reader or steal its focus.
const documents = new WeakMap();
const routes = new Set(['#office', '#agents', '#tasks', '#search', '#handoff', '#connection-settings']);

function managerFor(document) {
  if (documents.has(document)) return documents.get(document);
  const manager = { active: null };
  documents.set(document, manager);
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (link && routes.has(link.getAttribute('href')) && !link.target) {
      manager.active?.close({ restoreFocus: false, reason: 'navigate' });
    }
  });
  document.defaultView?.addEventListener('hashchange', () => {
    if (manager.active && manager.active.route !== document.defaultView.location.hash) {
      manager.active.close({ restoreFocus: false, reason: 'navigate' });
    }
  });
  return manager;
}

function visible(element) {
  return element?.isConnected && !element.disabled && !element.closest('[hidden], dialog:not([open])')
    && (!element.checkVisibility || element.checkVisibility());
}

function focusReturn(document, original) {
  // Polling can replace a list button while its detail window is open.
  const identity = (original?.getAttributeNames?.() || []).filter((name) => name.startsWith('data-') && original.getAttribute(name))
    .map((name) => [name, original.getAttribute(name)]);
  return () => {
    if (visible(original)) return original;
    if (identity.length) {
      const replacement = [...document.querySelectorAll(`[${identity[0][0]}]`)].find((node) => identity.every(([name, value]) => node.getAttribute(name) === value) && visible(node));
      if (replacement) return replacement;
    }
    return [...document.querySelectorAll('#room-heading, #page-title, #hire-button')].find(visible);
  };
}

export class DialogLayer {
  constructor(dialog, { onClose = () => {}, initialFocus } = {}) {
    this.dialog = dialog;
    this.document = dialog.ownerDocument;
    this.manager = managerFor(this.document);
    this.onClose = onClose;
    this.initialFocus = initialFocus;
    this.revision = 0;
    this.queuedCloses = 0;
    dialog.classList.add('dialog-layer');
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    dialog.addEventListener('pointerdown', (event) => { this.backdropStart = this.outside(event); });
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-layer-close]')) this.close();
      else if (this.backdropStart && this.outside(event)) this.close();
      this.backdropStart = false;
    });
    dialog.addEventListener('close', () => {
      if (this.queuedCloses) { this.queuedCloses -= 1; return; }
      if (!dialog.open) this.finish(true, 'dismiss');
    });
  }

  outside(event) {
    if (event.target !== this.dialog) return false;
    const box = this.dialog.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  }

  open() {
    if (this.dialog.open) { this.revision += 1; return; }
    const previous = this.manager.active;
    this.returnFocus = previous?.returnFocus || focusReturn(this.document, this.document.activeElement);
    previous?.close({ restoreFocus: false, reason: 'replace' });
    this.revision += 1;
    this.route = this.document.defaultView?.location.hash;
    this.manager.active = this;
    this.active = true;
    this.dialog.showModal();
    const target = this.initialFocus?.() || this.dialog.querySelector('.dialog-layer-header h2');
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
  }

  finish(restoreFocus, reason) {
    if (!this.active) return;
    this.active = false;
    this.revision += 1;
    if (this.manager.active === this) this.manager.active = null;
    this.onClose(reason);
    if (restoreFocus && !this.manager.active) {
      const target = this.returnFocus?.();
      if (target) { if (!target.matches('button, a, input, select, textarea, [tabindex]')) target.tabIndex = -1; target.focus({ preventScroll: true }); }
    }
  }

  close({ restoreFocus = true, reason = 'dismiss' } = {}) {
    if (!this.active) return;
    // Save scroll/drafts while the dialog still has a layout.
    this.finish(false, reason);
    if (this.dialog.open) { this.queuedCloses += 1; this.dialog.close(); }
    if (restoreFocus && !this.manager.active) {
      const target = this.returnFocus?.();
      if (target) { if (!target.matches('button, a, input, select, textarea, [tabindex]')) target.tabIndex = -1; target.focus({ preventScroll: true }); }
    }
  }
}
