import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('self-hosted fonts include valid WOFF2 files, provenance, and both redistribution licenses', async () => {
  const base = new URL('../../public/fonts/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  for (const asset of manifest.assets) {
    const file = await readFile(new URL(asset.file, base));
    assert.equal(createHash('sha256').update(file).digest('hex'), asset.sha256, asset.file);
    if (asset.file.endsWith('.woff2')) assert.equal(file.subarray(0, 4).toString(), 'wOF2');
    else assert.match(file.toString(), /SIL OPEN FONT LICENSE Version 1\.1/);
  }
  assert.equal(manifest.assets.filter((asset) => asset.file.endsWith('.woff2')).length, 2);
  const css = await readFile(new URL('../../public/fonts.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /https?:\/\//);
  assert.match(css, /font-display: swap/);
});
