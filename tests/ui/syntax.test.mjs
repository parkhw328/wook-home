import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('the browser entry point and imported modules parse before the UI is served', () => {
  for (const path of ['app.js', 'api.mjs', 'model.mjs', 'rooms.mjs', 'conversation.mjs', 'workspace.mjs', 'office-3d.mjs', 'office-models.mjs', 'office-view.mjs']) {
    const filename = fileURLToPath(new URL(`../../public/${path}`, import.meta.url));
    const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${path}: ${result.stderr || result.error || 'syntax check failed'}`);
  }
});
