import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../../public/theme.js', import.meta.url), 'utf8');
const key = 'wook-home.theme';

function browser({ saved = null, dark = false, blocked = '', values = new Map(saved ? [[key, saved]] : []) } = {}) {
  const listeners = new Map();
  const media = { matches: dark, addEventListener: (name, listener) => listeners.set(`media:${name}`, listener) };
  const storage = {
    getItem(name) { if (blocked === 'read') throw new Error('denied'); return values.get(name) ?? null; },
    setItem(name, value) { if (blocked === 'write') throw new Error('denied'); values.set(name, value); },
  };
  const selects = [0, 1].map(() => ({ value: '', addEventListener(name, listener) { this[name] = listener; } }));
  let parsed = false;
  const document = {
    documentElement: { dataset: {} },
    querySelector: () => ({ setAttribute: (name, value) => { document.themeColor = value; } }),
    querySelectorAll: () => parsed ? selects : [],
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  const window = {
    get localStorage() { if (blocked === 'access') throw new Error('denied'); return storage; },
    matchMedia: () => media,
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatchEvent: (event) => { window.lastEvent = event; },
  };
  runInNewContext(script, { window, document, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  return {
    root: document.documentElement.dataset, document, window, values, selects,
    parse() { parsed = true; listeners.get('DOMContentLoaded')(); },
    choose(value, index = 0) { selects[index].value = value; selects[index].change(); },
    system(dark) { media.matches = dark; listeners.get('media:change')(); },
    otherTab(value, changedKey = key) { listeners.get('storage')({ key: changedKey, newValue: value, storageArea: storage }); },
  };
}

test('saved preference is applied before the body parses and restores after a reload', () => {
  const page = browser({ saved: 'dark' });
  assert.equal(page.root.theme, 'dark');
  assert.equal(page.document.themeColor, '#0a1120');
  page.parse();
  assert.deepEqual(page.selects.map((select) => select.value), ['dark', 'dark']);
  page.choose('light', 1);
  assert.equal(page.root.theme, 'light');
  assert.equal(page.selects[0].value, 'light');
  assert.equal(browser({ values: page.values, dark: true }).root.theme, 'light');
  assert.equal(page.window.lastEvent.detail.theme, 'light');
});

test('system changes apply only while following the device preference', () => {
  const page = browser({ dark: true });
  assert.equal(page.root.theme, 'dark');
  assert.equal(page.root.themePreference, 'system');
  page.parse();
  page.system(false);
  assert.equal(page.root.theme, 'light');
  page.choose('dark');
  page.system(true); page.system(false);
  assert.equal(page.root.theme, 'dark');
  page.choose('system');
  assert.equal(page.root.theme, 'light');
  page.system(true);
  assert.equal(page.root.theme, 'dark');
});

test('same-origin tabs synchronize preferences and storage reset restores system mode', () => {
  const page = browser({ saved: 'light', dark: true }); page.parse();
  page.otherTab('dark', 'unrelated-key');
  assert.equal(page.root.theme, 'light');
  page.otherTab('dark');
  assert.equal(page.root.theme, 'dark');
  assert.equal(page.selects[1].value, 'dark');
  page.otherTab(null, null);
  assert.equal(page.root.themePreference, 'system');
  page.system(false);
  assert.equal(page.root.theme, 'light');
});

test('invalid saved values and denied browser storage do not prevent theme selection', () => {
  for (const blocked of ['', 'access', 'read', 'write']) {
    const page = browser({ saved: 'invalid-theme', dark: true, blocked }); page.parse();
    assert.equal(page.root.themePreference, 'system');
    page.choose('light');
    assert.equal(page.root.theme, 'light');
    page.system(false); page.system(true);
    assert.equal(page.root.theme, 'light');
    page.choose('dark');
    assert.equal(page.root.theme, 'dark');
  }
});
