# Local session search API

All routes enforce the existing loopback Host and same-origin checks, JSON bodies and `Cache-Control: no-store`. Search terms use POST bodies rather than URLs. Errors and logs never echo requests or provider data. `session-search.sqlite` is separate from office state and handoff.

| Method / route | Contract |
| --- | --- |
| GET `/api/search/status` | `webEnabled`, CLI `collection` (enabled/not_enabled/disconnected/unavailable), bounded CLI scope/coverage metadata, counts by source. No dialogue. |
| PUT `/api/search/settings` | `{webEnabled: boolean}`. Default false. Disabling collection retains previously saved material. |
| POST `/api/search/query` | `{query?, source?, provider?, role?, state?, offset?}`. Literal NFKC/case-insensitive substring; up to 200 characters. Source cli/web; provider openai/claude/gemini/meta; role user/assistant; state current/stored. Empty values mean all. Returns total, offset, limit=30 and matching message snippets with session metadata. |
| GET `/api/search/sessions/:id` | 64-character derived ID; returns bounded public messages in recorded order and session metadata. CLI restricted to the currently selected or last known workspace. |
| POST `/api/search/web` | `{clientId, sessions:[{provider,url,observation,messages,truncated?}]}`. Enabled search capture required. Up to 50 selected conversations, 3MB body. Known HTTPS conversation routes only; queries/fragments discarded. Public message shape `{key: sha256,role,content,timestamp?,truncated?}`. All entries validated before mutation. Empty/partial browser windows retain earlier messages. |

CLI bridge flag `--include-search-history` publishes a schema-1 index and sanitized per-session files under `search-history/`. The server validates scope, derived keys, path format, file size and public roles before importing. Source logs remain host-only. Index reading is throttled; identical versions are not reimported. A changed workspace restricts searches to that workspace's CLI material. Web conversations are never inferred to belong to a local project.

Current means a fresh Codex observer entry or a web conversation observed open within 30 seconds. Stored is deliberately not a process-exit verdict. Closed tabs and collection failures remain separate observations. `truncated` indicates bounded records. Source timestamp absence remains null, never fabricated as a message creation time.

The extension's `stackqueue:search-request` / `stackqueue:search-received` channel is independent from metadata discovery. It validates request IDs, top frame, local office origin and page marker. Worker capture is limited to conversations explicitly selected in extension storage. AI content scripts additionally verify the extension sender and current canonical URL before reading known public message containers. Unknown layouts have no body fallback.

Provider record references: [Claude session browser](https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser), [Gemini record types](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts), [Chrome messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging). Local-file adapters are experimental; their fixture coverage does not imply every provider version or live website is verified.
