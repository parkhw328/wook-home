import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { executionSelectionReason, newCommandId } from '../../public/execution-controls.mjs';
import { CommandDelivery, commandPresentation } from '../../public/commands.mjs';

test('LAN HTTP command IDs use secure random bytes when randomUUID is unavailable', () => {
  const source = { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) };
  const ids = new Set(Array.from({ length: 50 }, () => newCommandId(source)));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('stale model selection blocks send without replacing the draft with a default', () => {
  const choice = { model: 'model-a', reasoningEffort: 'high' };
  assert.equal(executionSelectionReason({ status: 'ready', models: [{ id: 'model-a', reasoningEfforts: ['high'] }] }, choice), '');
  assert.ok(executionSelectionReason({ status: 'unavailable', models: [] }, choice));
  assert.ok(executionSelectionReason({ status: 'ready', models: [{ id: 'model-a', reasoningEfforts: ['low'] }] }, choice));
  assert.equal(choice.reasoningEffort, 'high');
  assert.equal(executionSelectionReason(null, {}), '');
});

test('explicit retries retain exactly the original model and effort with the same command ID', async () => {
  const posts = [];
  const record = { id: newCommandId(), sessionId: newCommandId(), content: 'work', model: 'model-a', reasoningEffort: 'high' };
  const delivery = new CommandDelivery(async (path, options) => {
    if (options?.method === 'POST') { posts.push(options.body); if (posts.length === 1) throw new Error('lost response'); return { status: 'accepted' }; }
    throw Object.assign(new Error('missing'), { code: 'COMMAND_NOT_FOUND' });
  }, record);
  await delivery.send();
  assert.equal(posts.length, 1);
  await delivery.retry();
  assert.deepEqual(posts, [0, 1].map(() => ({ id: record.id, content: 'work', model: 'model-a', reasoningEffort: 'high' })));
  assert.equal(delivery.record.status, 'accepted');
  assert.match(commandPresentation({ status: 'failed', code: 'SETTINGS_UNCERTAIN' }).description, /지시는 전송하지 않았/);
});
