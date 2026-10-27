# 초기 API 계약

서버 세션과 웹 세션의 통합 기준. JSON은 camelCase, 시간은 ISO 8601 UTC, 직원·업무·대화 세션 ID는 UUID다. 감지 항목의 ID 형식은 각 계약을 따른다. API는 같은 origin의 /api 경로를 사용한다. 기본은 로컬 전용이며 `OFFICE_ALLOWED_HOSTS`에 지정한 서버 주소(IP·도메인과 포트)도 허용한다. 와일드카드는 받지 않고 다른 출처의 API 호출은 계속 거절한다. 외부 공개용 인증은 아직 없다.

## 응답

- 성공: 조회는 아래 객체, 생성은 HTTP 201과 생성된 객체, 변경은 HTTP 200과 변경된 객체.
- 오류: `{ "error": { "code": "VALIDATION_ERROR", "message": "사용자 안내" } }`.
- 요청 본문은 application/json. API 키·토큰을 보내거나 저장하는 기능은 없다.
- `GET /api/health`: `{ "status": "ok", "version": "0.1.0-dev" }`.
- `GET /api/state`: 아래 전체 상태. GUI는 2~3초마다 재조회하며 연결 실패는 별도 표시한다.

```json
{
  "office": { "name": "StackQueue Office", "paused": false, "mode": "local", "version": "0.1.0-dev" },
  "providers": [],
  "agents": [],
  "releasedAgents": [],
  "tasks": [],
  "events": [],
  "programs": [],
  "localSessions": { "status": "not_connected", "updatedAt": null, "workspace": "", "sessions": [] }
}
```

## 공급자와 직원

감지한 CLI·웹에서 직원 등록·기존 직원 연결·해제는 [직원 연결 API](staff-connections-api.md)를 따른다. `/state`는 등록 직원의 관찰 연결을 `connection`으로 제공하며, 관찰 중인 직원의 `status`는 `observing`이다.

- `GET /api/providers`: 공급자 객체 배열.
- 공급자: `{ id, name, available, kind, reason, models, reasoningEfforts, capabilities, webUrl?, guideUrl? }`. kind는 demo 또는 external. capabilities는 `{ createSession, observeSession, resumeSession, interrupt, changeModel }` 불리언 객체.
- 외부 공급자의 `webUrl`은 공식 서비스 접속 주소, `guideUrl`은 공급자 연결 안내 Wiki다. 고정 HTTPS 링크이며 인증·연동 상태를 의미하지 않는다. 링크를 열어도 `available`이나 capabilities는 바뀌지 않는다.
- 공급자 ID: demo, openai, claude, gemini, meta. 초기에는 demo만 available=true. 외부 공급자의 새 세션 실행은 미구현이며 인증됨으로 표시하지 않는다. 연결한 Codex의 실행 옵션은 별도 `localSessions.execution`을 사용한다.
- demo의 모델은 `local-demo`, 추론 강도는 `none`. 외부 공급자 models/ reasoningEfforts는 빈 배열. 미확인 모델 목록을 만들어 내지 않는다.
- `POST /api/agents`: `{ name, role, provider, model?, reasoningEffort?, projectName? }`. 이름 1~40자, 역할 1~120자. 외부 공급자는 model과 reasoningEffort를 비워 등록만 가능하다.
- `PATCH /api/agents/:id`: `{ name?, role?, projectName?, executionPreference?, settingsRevision? }`. 기존 `model`/`reasoningEffort`의 관찰값 변경은 지원하지 않는다. 공급자 변경은 불가.
- 직원: `{ id, name, role, provider, model, reasoningEffort, projectName, executionPreference, settingsRevision, status, location, createdAt, updatedAt }`. 기본 status는 idle / working / waiting_input / waiting_approval / paused / unavailable이며 관찰 연결을 합친 응답은 observing / unknown / disconnected도 사용한다. 연결 상태·추가 필드는 [직원 연결 API](staff-connections-api.md)를 따른다. location은 local-container.

- `projectName`은 수동 배정한 대표 프로젝트 이름(0~80자, 한 줄)이며 빈 문자열은 미배정이다. 감지 등록에도 입력할 수 있다. 실제 실행 경로나 관찰 범위를 바꾸지 않는다.
- `executionPreference`는 `null`(CLI 설정 유지) 또는 `{ model, reasoningEffort }`다. 새 값은 현재 연결된 Codex 대화의 실제 모델 목록으로 검증한다. 저장은 AI 요청을 만들지 않으며 화면이 다음 지시 요청에 저장값을 명시적으로 포함한다. 끊긴 연결에서도 기존 값을 유지하거나 해제할 수 있다.
- `settingsRevision`은 직원 편집·연결 변경마다 증가한다. 화면은 편집 시작 값을 보내고 서버 값과 다르면 `409 SETTINGS_CONFLICT`로 전체 변경을 거절한다. 필드 생략은 기존 클라이언트 호환용이며 현재 UI는 항상 전송한다.
- 기존 DB 직원은 `projectName: ""`, `executionPreference: null`, `settingsRevision: 0`으로 보완한다. 직원 설정은 재시작 후 유지하고 관찰 식별자·실제 작업 폴더는 인계에 포함하지 않는다.

## 업무와 Q&A

- `POST /api/tasks`: `{ agentId, title, description? }`. 제목 1~120자, 설명 최대 4000자. 한 직원은 동시에 하나의 미완료 업무만 가능.
- 외부 공급자에 실행 요청하면 HTTP 409 PROVIDER_UNAVAILABLE. 사무실 중지 중에는 HTTP 409 OFFICE_PAUSED.
- demo 직원에게 업무를 만들면 waiting_input 상태로 전환한다. 실제 AI 호출 없이 UI 동작을 체험하는 고정 안내 질문이 생성된다.
- `POST /api/tasks/:id/messages`: `{ content }` 최대 4000자. waiting_input 상태에서 Commander 답변을 저장하고 데모 결과와 함께 waiting_approval로 전환.
- `POST /api/tasks/:id/approve`: `{}`. waiting_approval 업무를 completed로 변경.
- `POST /api/tasks/:id/cancel`: `{}`. 미완료 업무를 cancelled로 변경.
- 업무: `{ id, agentId, title, description, status, messages, result, createdAt, updatedAt }`.
- 메시지: `{ id, role, content, createdAt }`. role은 user / assistant / system. demo 출력은 항상 체험용임을 표시.
- 이벤트: `{ id, type, message, createdAt }`. 최근 순서. 사용자 입력·대화 원문을 이벤트나 서버 로그에 복제하지 않는다.

## 사무실·인계

- `office.name`은 실행 시 `OFFICE_NAME`으로 지정한다. 기본값은 `StackQueue Office`, 앞뒤 공백을 제외한 1~80자다. 재시작하면 기존 DB에도 새 이름이 적용되며 직원·업무는 유지된다.
- `POST /api/office/pause`: `{}`. 새 업무와 진행을 중지하고 미완료 업무를 paused로 저장. 이전 상태를 내부 보관한다.
- `POST /api/office/resume`: `{}`. 이전 상태 복원. 위 두 응답은 office 객체.
- `GET /api/handoff`: 검토용 JSON 파일 다운로드. `{ schemaVersion: 1, exportedAt, notice, office, agents, releasedAgents, tasks }`. tasks는 제목·설명·상태·결과·messages를 포함한다. 해제 직원은 기존 보고 담당자 확인을 위해 포함하지만 직원 연결 매핑·선택한 연결 종류·보관 메모, CLI/웹 대화 사본·설정·지시 접수 기록은 제외한다. 내용에 사용자 입력이 포함되므로 공개 전 검토가 필요하며 자동 커밋·푸시하지 않는다. 인계 가져오기·DB 백업은 후속 기능이다. 저장 위치는 [개발 안내](development.md#데이터-저장과-인계)를 따른다.
- SIGTERM 종료 시 업무 상태를 저장하며 미완료 작업은 paused로 남긴다. 재시작 후 Commander가 resume을 눌러 이어간다.
- 프로그램: `{ name, description, url }` 네 개(StackQueue Blog, wShell, wPost, wText).

## 로컬 Codex 관찰

- `localSessions`는 호스트의 읽기 전용 연결 프로그램이 생성한 상태를 보여준다. `status`는 connected / disconnected / not_connected, `updatedAt`은 마지막 상태 수집 시각, `workspace`는 선택한 작업 폴더의 이름이다.
- `sessions`: `{ id, name, provider: "openai", status, lifecycle, lastActivityAt }` 배열. ID는 전체 Codex 세션 UUID, 이름은 `Codex · 전체 UUID`다. 직원의 별칭은 별도 `agent.name`으로 저장한다. 사용자 대화 제목·내용·인증 정보·절대 경로는 전달하지 않는다.
- 세션 상태: working(최근 활동 기록), idle(턴 종료 기록), interrupted(중단 기록), unknown(확인 필요), disconnected(연결 프로그램 갱신 중단).
- 5초마다 수집한다. 연결 프로그램의 스냅샷이 20초 이상 갱신되지 않으면 disconnected, working 기록이 120초 이상 오래되면 unknown으로 표시한다. 활동 시각만으로 프로세스 생존이나 프로젝트 완료를 판정하지 않는다. 별도 `lifecycle`은 공식 현재 적재 목록을 근거로 `live` / `not_loaded` / `unknown`을 표시하며 연결이 오래되면 `unknown`으로 바꾼다.
- 살아 있는 현재 프로젝트 세션은 직원으로 등록해 직원 수에 포함한다. 미등록 기록은 직원·업무 집계에서 제외한다. 원문 관찰 세션과 로컬 해시 등록 기록은 인계 JSON에 넣지 않는다. [직원 자동 등록 계약](staff-connections-api.md)을 따른다. 사무실 pause는 새 지시 접수를 막지만 이미 전달된 지시나 호스트 CLI를 중단하지 않는다.
- Docker는 상태 JSON 폴더를 읽기 전용으로, 지시 폴더를 별도 읽기·쓰기로 연결한다. 상세 실행법은 [CLI 연결 안내](wiki/CLI.md)를 따른다.

## CLI 프로세스 추가·종료

- `localSessions.processes`: `{ status, platform, scope, updatedAt, items, events }`. `status`는 connected / unavailable / unsupported / disconnected다. `platform`은 win32 / linux / unknown, `scope`는 각각 login_session / same_user / this_pc다. 플랫폼 정보가 없는 이전 연결기도 받는다. 같은 Windows 로그인 세션 또는 Linux 연결 프로그램과 같은 유효 UID의 지원 CLI 실행을 약 5초마다 확인하며, 현재 프로젝트의 저장 대화 목록인 `sessions`와 분리한다. 계정 이름과 UID는 전달하지 않는다.
- `items`: `{ id, pid, provider, name, status, startedAt, firstSeenAt, lastSeenAt, endedAt }`. ID는 PID·시작 시각에서 만든 `cli-` 접두사 식별자이며 UUID가 아니다. provider는 openai / claude / gemini, 상태는 running / exited / unknown이다. 첫 대화 이전도 감지한다. 종료 시각은 프로세스 부재를 확인한 시각이며 업무 완료를 의미하지 않는다.
- `events`: `{ id, type: "detected" | "exited", processId, at }`. 중복 관찰은 같은 이벤트를 반복 생성하지 않는다. 최대 50개, 최근 10분만 보관한다. 실행 중 최대 64개와 최근 종료 최대 24개를 제공한다.
- 프로세스 목록 조회에 실패하면 이전 실행을 unknown으로 표시하고 마지막 성공 시각을 유지한다. 20초 이상 갱신이 멈추면 disconnected다. 미지원 OS는 unsupported이며 저장 대화 관찰은 계속 가능하다.
- 명령 인수·실행 경로·제목·대화·인증 정보는 응답에 포함하지 않는다. 프로세스를 대화 UUID에 추정 연결하지 않고 프로세스 감지만으로 지시·종료 권한을 부여하지 않는다. 기존 스냅샷에 processes가 없으면 unsupported로 처리한다.

## 로컬 Codex 지시 전송

- `localSessions.control`: `{ enabled, reason, bridgeId? }`. reason은 ready / not_enabled / cli_unavailable / disconnected. 화면의 Codex 지시 전송 설정을 연결기가 적용하고 공식 CLI의 큐 지원이 확인된 경우 활성화된다. 저장된 설정이 없을 때만 호환 옵션 `--allow-commands`를 초기값으로 사용한다. 개별 전달 성공은 접수 결과로 확인한다.
- `POST /api/local-sessions/:sessionId/commands`: `{ id, content }`. 클라이언트가 생성한 UUID와 1~4000자의 지시. 현재 프로젝트의 관찰 세션만 대상이다. 사무실 중지·관찰 연결 끊김·제어 미활성화는 409, 없는 세션은 404.
- HTTP 202: `{ id, sessionId, status, createdAt, updatedAt, code? }`. 새 요청은 pending. 같은 ID·대상·내용·추론 설정을 다시 보내면 기존 상태를 반환하며 다른 요청은 409 COMMAND_ID_CONFLICT. 응답 유실 시 같은 ID의 접수 기록을 조회하며 UI는 자동 재전송하지 않는다. 수동으로 접수를 재시도할 때도 기존 ID를 유지한다.
- `GET /api/local-commands/:id`: 위 접수 객체. 지시 원문은 반환하지 않는다. 기록 없음은 404 COMMAND_NOT_FOUND.
- status: pending(전달 대기), sending(CLI 호출 중), accepted(공식 큐 접수), failed(거절), unknown(전달 여부 불명), expired(만료). **accepted는 업무 완료가 아니다.** 결과·승인·중단은 원래 Codex에서 처리한다.
- code: QUEUED / CLI_REJECTED / DELIVERY_UNCERTAIN / REQUEST_EXPIRED / SESSION_UNAVAILABLE / BRIDGE_RESTARTED. 원시 CLI 오류 출력은 전달하지 않는다.
- 요청 유효 시간 60초, CLI 호출 제한 15초. 전달 전 원문을 지우며 중단된 sending 요청은 자동 재실행하지 않는다. 연결 프로그램 재시작 전 요청은 만료 처리한다. 접수 기록은 연결 프로그램 실행 중 7일 보관, 최대 1000개다.

모델·강도 선택 요청은 `{ id, content, model, reasoningEffort }`로 확장한다. 실제 목록·적용 시점·접수 필드·추가 오류와 검증 범위는 [모델·강도 계약](execution-controls.md)을 따른다. 모델 미선택의 기존 요청·응답은 호환한다.

## 로컬 Codex 대화기록

- `localSessions.conversations`: `{ enabled }`. 화면 연결 설정의 공개 대화 읽기를 켜고 연결기가 적용했을 때 활성화한다. 저장된 설정이 없으면 기존 실행 옵션도 지원한다.
- `GET /api/local-sessions/:sessionId/conversation`: `{ sessionId, status, messages, updatedAt, truncated, limit: 60 }`. 현재 작업 공간의 관찰 목록에 있는 UUID만 읽는다. 동일 출처 요청 검사와 `Cache-Control: no-store`를 적용한다.
- `status`: ready(기록 수신), empty(수집 범위에 공개 대화 없음), disabled(미활성화), disconnected(20초 이상 갱신 중단), unavailable(세션 없음·읽기 실패·형식 불일치).
- 메시지: `{ role: "user" | "assistant", timestamp, content, truncated }`. 시스템·개발자 지침, 내부 추론, 도구 원문을 제외한다. 호스트에서 알려진 인증 정보·개인 경로·연락처 패턴을 마스킹하고 화면은 HTML로 실행하지 않는다.
- 로그 끝 1MB에서 최근 최대 60개, 총 24,000자, 메시지당 4,000자만 제공한다. 제한이 적용되면 `truncated`를 표시한다. 기록 파일은 200KB까지 읽으며 상태 JSON은 기존 64KB 한도를 유지한다.
- 호스트는 `data/bridge/conversations/<uuid>.json`을 원자적으로 게시한다. 관찰 범위에서 사라진 파일과 비활성화 시의 내보낸 파일은 다음 수집 때 삭제한다. 원래 Codex 로그를 수정·삭제하지 않는다. SQLite·인계·Git·이미지에 대화를 복제하지 않는다.

## 현재 범위

진행·보관 세션의 자료 검색과 웹 대화 선택 보관은 별도의 [검색 API](session-search-api.md)를 사용합니다. 직접 붙여넣기 보관은 `/api/search/import`를 사용하며 자동 웹 수집을 켜지 않습니다. 최근 대화 API와 업무 인계 계약은 그대로 유지합니다.

기존 Codex에 대한 큐 지시 외에 신규 AI 세션 실행, 실제 CLI 승인·중단, 다른 공급자 제어, 토큰·비용 측정, 임의 프로세스 감지, GitHub 자동 인계와 클라우드 인증은 지원하지 않는다.

지원 CLI·AI 웹 탭의 통합 목록은 [감지 API](discovery-api.md), 설치·감지·API 인증의 분리된 점검은 [연결 점검 API](connections-api.md)를 따른다. API 연결 점검 성공은 위 업무 실행 기능을 활성화하지 않는다.

## 호스트 연결 설정

- `GET /api/bridge/settings`: 저장한 `options`(conversations, searchHistory, commands), `revision`, `saved`, `writable`, `status`, 현재 적용된 `applied`와 프로젝트 표시명·수신 시각을 반환한다. 호스트 경로·인증 값은 반환하지 않는다.
- `PUT /api/bridge/settings`: `{ revision, options: { conversations, searchHistory, commands } }`의 전체 불리언 선택만 받는다. 최초 revision은 null이며 다음 저장에는 조회한 revision을 사용한다. 변경 충돌은 409, 읽기·쓰기 실패는 503이다. 같은 출처 검사와 4096바이트 한도를 적용한다.
- 상태: `not_connected`, `upgrade_required`, `pending`, `applied`, `storage_error`, `bridge_error`. 설정 적용과 CLI 지시 지원 여부는 별개이며 `applied.commands`와 `controlReason`을 함께 확인한다.
- 서버는 `CODEX_COMMANDS_DIR/bridge-settings.json`에 원자적으로 저장한다. 호스트는 출력 폴더의 `commands`에서 읽고 상태 파일의 `settings: { version: 1, revision, options, error }`로 응답한다. 두 경로는 같은 공유 폴더여야 한다.
- 읽을 수 없는 설정은 기능을 켜지 않는다. 지시 끄기는 서버의 신규 접수를 즉시 차단하며 호스트 적용 전 성공을 주장하지 않는다. 전송 중인 지시와 검색 사본은 취소·삭제하지 않는다. 설정·대화·접수 정보는 인계에 포함하지 않는다.

## 업무 창고

- `POST /api/local-sessions/:id/archive`: `{ "note": "다음 행동" }`로 현재 또는 마지막 관찰 CLI를 직원 업무로 보관합니다. 응답은 201과 연결 정보를 포함한 직원입니다. 기존 직원에게 연결된 항목은 409이며 직원 보관 API를 사용합니다. 관찰 식별자는 영속 저장하지 않습니다.
- `PUT /api/agents/:id/archive`: `{ "stored": true, "note": "다음 행동", "settingsRevision": 0 }`. `false`는 복귀이며 실제 실행·재연결은 하지 않습니다. 4,000자 한도와 직원 설정 버전 충돌을 검사합니다. 체험 직원은 지원하지 않습니다.
- 직원의 `workArchive`에는 `stored`, `note`, `updatedAt`을 반환합니다. 로컬 DB에서 유지하고 인계에서 제외합니다. 보관 중 새 지시는 `409 WORK_ARCHIVED`, 이미 접수된 동일 ID·본문 요청은 기존 접수 결과를 반환합니다.

## 직원 등록 해제

`POST /api/agents/:id/release`와 `/restore`는 `{ "settingsRevision": 0 }`을 받습니다. 해제는 `{ "id": "…", "released": true }`, 재등록은 직원 정보를 반환합니다. 진행 중 체험 업무와 버전 충돌은 409입니다. `/api/state`의 `agents`는 등록 직원만, `releasedAgents`는 업무·보관 메모를 보존한 해제 기록입니다. 해제 시 연결 매핑을 제거하고 재등록으로 자동 연결하지 않습니다. 인계에는 보고 담당자를 유지하기 위한 해제 직원 정보도 포함하지만 보관 메모는 제외합니다.
