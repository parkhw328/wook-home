import test from 'node:test';
import assert from 'node:assert/strict';
import { DialogLayer } from '../../public/dialog-layer.mjs';

function environment() {
  const document = new EventTarget();
  document.defaultView = Object.assign(new EventTarget(), { location: { hash: '#office' } });
  document.querySelectorAll = () => [];
  const element = () => ({ isConnected: true, closest: () => null, matches: () => true,
    focus() { document.activeElement = this; } });
  const trigger = element(); trigger.focus();
  const events = [];
  function dialog() {
    const node = Object.assign(new EventTarget(), element(), {
      ownerDocument: document, classList: { add() {} }, open: false,
      showModal() { this.open = true; },
      close() { this.open = false; events.push(() => this.dispatchEvent(new Event('close'))); },
      querySelector: () => element(),
      getBoundingClientRect: () => ({ top: 20, left: 20, right: 200, bottom: 200 }),
    });
    return node;
  }
  return { document, trigger, dialog, flush: () => { while (events.length) events.shift()(); } };
}

test('switching dialogs keeps one open and returns focus to the original entry', () => {
  const f = environment(); const cleaned = [];
  const a = new DialogLayer(f.dialog(), { onClose: () => cleaned.push('a') });
  const b = new DialogLayer(f.dialog(), { onClose: () => cleaned.push('b') });
  a.open(); b.open();
  const focus = f.document.activeElement;
  assert.equal(a.dialog.open, false); assert.equal(b.dialog.open, true);
  f.flush();
  assert.equal(f.document.activeElement, focus, 'old close event must not steal focus');
  b.close(); f.flush();
  assert.equal(f.document.activeElement, f.trigger);
  assert.deepEqual(cleaned, ['a', 'b']);
});

test('immediate close and reopen does not cancel the new reader or run cleanup twice', () => {
  const f = environment(); let cleanups = 0;
  const layer = new DialogLayer(f.dialog(), { onClose: () => { assert.equal(layer.dialog.open, true); cleanups += 1; } });
  layer.open(); layer.close(); layer.open(); f.flush();
  assert.equal(layer.dialog.open, true); assert.equal(cleanups, 1);
  layer.dialog.dispatchEvent(new Event('cancel', { cancelable: true })); f.flush();
  assert.equal(layer.dialog.open, false); assert.equal(cleanups, 2);
});

test('backdrop click dismisses but dragging from the content to the backdrop does not', () => {
  const f = environment(); const layer = new DialogLayer(f.dialog()); layer.open();
  const point = (type, x) => layer.dialog.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: x }));
  point('pointerdown', 60); point('click', 0);
  assert.equal(layer.dialog.open, true);
  point('pointerdown', 0); point('click', 0);
  assert.equal(layer.dialog.open, false);
});

test('route changes close old layers without closing a dialog already opened on the destination', () => {
  const f = environment(); const layer = new DialogLayer(f.dialog()); layer.open();
  f.document.defaultView.location.hash = '#search';
  f.document.defaultView.dispatchEvent(new Event('hashchange'));
  assert.equal(layer.dialog.open, false);
  layer.open(); f.flush();
  f.document.defaultView.dispatchEvent(new Event('hashchange'));
  assert.equal(layer.dialog.open, true);
});
