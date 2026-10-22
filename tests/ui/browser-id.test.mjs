import test from 'node:test';
import assert from 'node:assert/strict';
import { browserId, localExtensionAvailable } from '../../public/browser-id.mjs';
import { webcrypto } from 'node:crypto';

test('web detection and search use UUID v4 on HTTP without randomUUID or subtle', () => {
  const source = { getRandomValues: (array) => webcrypto.getRandomValues(array) };
  const ids = Array.from({ length: 30 }, () => browserId(source));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.throws(() => browserId({}), /요청 식별자/);
});

test('extension availability matches its local HTTP content-script scope', () => {
  for (const url of ['http://localhost:8080', 'http://127.0.0.1:18083']) assert.equal(localExtensionAvailable(new URL(url)), true);
  for (const url of ['http://office.test:8080', 'http://192.0.2.10:8080', 'https://localhost:8080']) assert.equal(localExtensionAvailable(new URL(url)), false);
});

test('blocked browser storage still allows a stable in-memory import identity', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage denied'); } });
  try {
    const { searchImportClient } = await import(`../../public/browser-id.mjs?blocked-storage`);
    const id = searchImportClient();
    assert.equal(searchImportClient(), id);
    assert.match(id, /^[a-f0-9-]{36}$/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
