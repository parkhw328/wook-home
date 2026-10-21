import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectConversation, redactConversation, publishConversations } from '../../scripts/lib/codex-conversations.mjs';
import { collectSessions } from '../../scripts/lib/codex-observer.mjs';
import { createSessionObserver } from '../../server/sessions.js';
import { createStore } from '../../server/store.js';
import { createOffice } from '../../server/office.js';
import { createHttpServer } from '../../server/http.js';

const id = '00000000-0000-0000-0000-000000000001';
const timestamp = new Date().toISOString();
const message = (role, text, extra = {}) => ({ type: 'response_item', timestamp, payload: { type: 'message', role, content: [{ type: 'input_text', text }], ...extra } });
const fixture = (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'office-conversations-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test('only visible dialogue is included, with duplicate event records and internal content excluded', () => {
  const data = collectConversation([
    message('system', 'hidden-system'), message('developer', 'hidden-developer'),
    message('assistant', 'hidden-reasoning', { channel: 'analysis' }),
    message('user', '# AGENTS.md instructions\nhidden-instructions'),
    { type: 'response_item', timestamp, payload: { type: 'function_call_output', output: 'hidden-tool' } },
    message('user', '진행 상황을 알려 주세요.'),
    { type: 'event_msg', timestamp, payload: { type: 'user_message', message: '진행 상황을 알려 주세요.' } },
    message('assistant', '작업 결과를 보고합니다.', { channel: 'final' }),
  ]);
  assert.equal(data.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(data), /hidden-/);
  assert.deepEqual(data.messages.map((item) => item.role), ['user', 'assistant']);
  assert.equal(data.truncated, false);
});

test('known credentials, contact data, private paths and terminal escapes are redacted before publication', () => {
  const input = 'api_key="example-credential" password=example-password Bearer example-bearer sk-examplekey123456 user@example.test 010-1234-5678 C:\\Users\\example\\private.txt /home/example/private.txt\u001b[31m';
  const safe = redactConversation(input);
  assert.doesNotMatch(safe, /example-credential|example-password|example-bearer|sk-example|user@|010-1234|private\.txt|\u001b/);
  assert.match(safe, /숨김/);
});

test('recent public dialogue is bounded and truncation is explicit', () => {
  const data = collectConversation(Array.from({ length: 70 }, (_, i) => message('user', `${i}:` + 'x'.repeat(6000))));
  assert.ok(data.messages.length <= 60);
  assert.ok(data.messages.reduce((sum, item) => sum + item.content.length, 0) <= 24000);
  assert.ok(data.messages.every((item) => item.content.length <= 4000));
  assert.equal(data.truncated, true);
  assert.ok(data.messages.at(-1).content.startsWith('69:'));
});

test('publication keeps dialogue out of the state snapshot and removes exports when disabled without touching source material', async (t) => {
  const directory = fixture(t);
  const snapshot = { generatedAt: timestamp, sessions: [{ id, conversation: collectConversation([message('user', 'public-dialogue')]) }] };
  writeFileSync(join(directory, 'original.jsonl'), 'source-material');
  await publishConversations(snapshot, directory, true);
  assert.equal(snapshot.sessions[0].conversation, undefined);
  assert.match(readFileSync(join(directory, `${id}.json`), 'utf8'), /public-dialogue/);
  await publishConversations({ sessions: [] }, directory, false);
  assert.equal(existsSync(join(directory, `${id}.json`)), false);
  assert.equal(readFileSync(join(directory, 'original.jsonl'), 'utf8'), 'source-material');
});

test('conversation collection is opt-in and restricted to the exact project', async (t) => {
  const directory = fixture(t);
  const day = join(directory, ...timestamp.slice(0, 10).split('-'));
  mkdirSync(day, { recursive: true });
  const workspace = join(directory, 'workspace');
  const log = (cwd, text) => [{ type: 'session_meta', payload: { id, cwd } }, message('user', text)].map(JSON.stringify).join('\n') + '\n';
  writeFileSync(join(day, 'rollout-selected.jsonl'), log(workspace, 'selected-public-dialogue'));
  writeFileSync(join(day, 'rollout-other.jsonl'), log(directory, 'other-project-private'));
  const disabled = await collectSessions({ sessionsDir: directory, workspace });
  assert.doesNotMatch(JSON.stringify(disabled), /selected-public-dialogue|other-project-private/);
  const enabled = await collectSessions({ sessionsDir: directory, workspace, includeConversations: true });
  assert.equal(enabled.sessions[0].conversation.messages[0].content, 'selected-public-dialogue');
  assert.doesNotMatch(JSON.stringify(enabled), /other-project-private/);
});

test('conversation API validates identity and scope, blocks cross-origin reads, and never includes dialogue in state or handoff', async (t) => {
  const directory = fixture(t);
  const file = join(directory, 'codex.json');
  const conversationDir = join(directory, 'conversations');
  mkdirSync(conversationDir);
  const snapshot = { schemaVersion: 1, generatedAt: timestamp, workspace: 'test', sessions: [{ id, status: 'idle', lastActivityAt: timestamp }], conversations: { enabled: true } };
  writeFileSync(file, JSON.stringify(snapshot));
  const conversationFile = join(conversationDir, `${id}.json`);
  const conversation = { schemaVersion: 1, sessionId: id, generatedAt: timestamp, ...collectConversation([message('user', 'public-conversation')]) };
  writeFileSync(conversationFile, JSON.stringify(conversation));
  let now = Date.parse(timestamp);
  const observer = createSessionObserver({ file, clock: () => now });
  assert.equal(observer.conversation(id).status, 'ready');
  now += 21000;
  assert.equal(observer.conversation(id).status, 'disconnected');
  assert.equal(observer.conversation(id).messages.length, 1);
  assert.equal(observer.conversation('../codex').status, 'unavailable');
  now = Date.parse(timestamp);
  const store = createStore(':memory:');
  const server = createHttpServer(createOffice(store), { bridgeFile: file, clock: () => now });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/api/local-sessions/${id}/conversation`;
  assert.equal((await (await fetch(url)).json()).messages[0].content, 'public-conversation');
  assert.equal((await fetch(url, { headers: { Origin: 'https://outside.test' } })).status, 403);
  for (const path of ['/api/state', '/api/handoff']) assert.doesNotMatch(await (await fetch(base + path)).text(), /public-conversation/);
  writeFileSync(conversationFile, JSON.stringify({ ...conversation, sessionId: id.replace(/1$/, '2') }));
  assert.equal(observer.conversation(id).status, 'unavailable');
  writeFileSync(file, JSON.stringify({ ...snapshot, conversations: { enabled: false } }));
  assert.equal(observer.conversation(id).status, 'disabled');
  assert.deepEqual(observer.conversation(id).messages, []);
});
