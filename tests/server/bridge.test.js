import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('background observation can be stopped without controlling a Codex session', { timeout: 15000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wook-home-bridge-'));
  const sessions = join(root, 'sessions');
  const output = join(root, 'bridge');
  await mkdir(sessions);
  const script = fileURLToPath(new URL('../../scripts/codex-bridge.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, '--workspace', root, '--sessions-dir', sessions, '--output-dir', output], { stdio: 'ignore', windowsHide: true });
  const exited = new Promise((done, reject) => { child.once('exit', done); child.once('error', reject); });
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await exited;
    await rm(root, { recursive: true, force: true });
  });
  let published = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await access(join(output, 'codex.json')); published = true; break; } catch {}
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.equal(published, true);
  const result = await promisify(execFile)(process.execPath, [script, '--output-dir', output, '--stop'], { windowsHide: true });
  assert.match(result.stdout, /stop requested/);
  assert.equal(await exited, 0);
});
