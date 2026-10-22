import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightedText, resultMarkup, SearchRequest } from '../../public/session-search-model.mjs';

test('literal Unicode highlights preserve text and never execute matching or surrounding HTML', () => {
  assert.equal(highlightedText('가나다 ABC 자료', 'abc'), '가나다 <mark>ABC</mark> 자료');
  assert.equal(highlightedText('ＡＢＣ 자료', 'abc'), '<mark>ＡＢＣ</mark> 자료');
  assert.equal(highlightedText('<script>alert(1)</script>', '<script>'), '<mark>&lt;script&gt;</mark>alert(1)&lt;/script&gt;');
  assert.equal(highlightedText('a.b a*b [x]', '.*'), 'a.b a*b [x]');
  assert.equal(highlightedText('①번 자료', '1'), '<mark>①</mark>번 자료');
  const markup = resultMarkup({ session: { id: 'safe', name: '<img src=x onerror=alert(1)>', provider: 'claude', source: 'web', state: 'stored' }, key: 'key', role: 'assistant', snippet: '<script>자료</script>' }, '자료');
  assert.doesNotMatch(markup, /<script>|<img/);
});

test('late searches and aborted failures cannot overwrite the newest results', async () => {
  const request = new SearchRequest();
  let finish;
  const first = request.run(() => new Promise((resolve) => { finish = resolve; }));
  const second = await request.run(async () => 'newest');
  finish('stale');
  assert.equal(await first, null);
  assert.deepEqual(second, { value: 'newest' });
});

test('closing a search detail cancels old reads before a new detail is opened', async () => {
  const request = new SearchRequest(); let fail;
  const old = request.run((signal) => new Promise((resolve, reject) => { fail = reject; signal.addEventListener('abort', () => reject(new Error('aborted'))); }));
  request.cancel();
  assert.deepEqual(await request.run(async () => 'new conversation'), { value: 'new conversation' });
  fail(new Error('late failure'));
  assert.equal(await old, null);
});
