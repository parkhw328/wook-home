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
- 공급자 ID: demo, openai, claude, gemini, meta. 초기에는 demo만 available=true. 외부 공급자는 아직 미구현이며 인증됨으로 표시하지 않는다.
- demo의 모델은 `local-demo`, 추론 강도는 `none`. 외부 공급자 models/ reasoningEfforts는 빈 배열. 미확인 모델 목록을 만들어 내지 않는다.
- `POST /api/agents`: `{ name, role, provider, model?, reasoningEffort? }`. 이름 1~40자, 역할 1~120자. 외부 공급자는 model과 reasoningEffort를 비워 등록만 가능하다.
- `PATCH /api/agents/:id`: `{ name?, role?, model?, reasoningEffort? }`. 공급자 변경은 불가.
- 직원: `{ id, name, role, provider, model, reasoningEffort, status, location, createdAt, updatedAt }`. status는 idle / working / waiting_input / waiting_approval / paused / unavailable. location은 local-container.

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
- `GET /api/handoff`: 검토용 JSON 파일 다운로드. `{ schemaVersion, exportedAt, office, agents, tasks }`. tasks는 제목·설명·상태·결과·messages를 포함한다. 내용에 사용자 입력이 포함되므로 공개 전 검토가 필요하며 자동 커밋·푸시하지 않는다. 인계 가져오기는 후속 기능이다.
- SIGTERM 종료 시 업무 상태를 저장하며 미완료 작업은 paused로 남긴다. 재시작 후 Commander가 resume을 눌러 이어간다.
- 프로그램: `{ name, description, url }` 네 개(StackQueue Blog, wShell, wPost, wText).

## 로컬 Codex 관찰

- `localSessions`는 호스트의 읽기 전용 연결 프로그램이 생성한 상태를 보여준다. `status`는 connected / disconnected / not_connected, `updatedAt`은 마지막 상태 수집 시각, `workspace`는 선택한 작업 폴더의 이름이다.
- `sessions`: `{ id, name, provider: "openai", status, lastActivityAt }` 배열. ID는 Codex 세션 UUID, 이름은 ID 일부로 만든 중립적인 별칭이다. 사용자 대화 제목·내용·인증 정보·절대 경로는 전달하지 않는다.
- 세션 상태: working(최근 활동 기록), idle(턴 종료 기록), interrupted(중단 기록), unknown(확인 필요), disconnected(연결 프로그램 갱신 중단).
- 5초마다 수집한다. 연결 프로그램의 스냅샷이 20초 이상 갱신되지 않으면 disconnected, working 기록이 120초 이상 오래되면 unknown으로 표시한다. 프로세스 생존이나 프로젝트 완료를 판정하지 않는다.
- 직원·업무 집계, SQLite 저장과 인계 JSON에는 관찰 세션을 넣지 않는다. 사무실 pause는 새 지시 접수를 막지만 이미 전달된 지시나 호스트 CLI를 중단하지 않는다.
- Docker는 상태 JSON 폴더를 읽기 전용으로, 지시 폴더를 별도 읽기·쓰기로 연결한다. 상세 실행법은 [CLI 연결 안내](wiki/CLI.md)를 따른다.

## CLI 프로세스 추가·종료

- `localSessions.processes`: `{ status, platform, scope, updatedAt, items, events }`. `status`는 connected / unavailable / unsupported / disconnected다. `platform`은 win32 / linux / unknown, `scope`는 각각 login_session / same_user / this_pc다. 플랫폼 정보가 없는 이전 연결기도 받는다. 같은 Windows 로그인 세션 또는 Linux 연결 프로그램과 같은 유효 UID의 지원 CLI 실행을 약 5초마다 확인하며, 현재 프로젝트의 저장 대화 목록인 `sessions`와 분리한다. 계정 이름과 UID는 전달하지 않는다.
- `items`: `{ id, pid, provider, name, status, startedAt, firstSeenAt, lastSeenAt, endedAt }`. ID는 PID·시작 시각에서 만든 `cli-` 접두사 식별자이며 UUID가 아니다. provider는 openai / claude / gemini, 상태는 running / exited / unknown이다. 첫 대화 이전도 감지한다. 종료 시각은 프로세스 부재를 확인한 시각이며 업무 완료를 의미하지 않는다.
- `events`: `{ id, type: "detected" | "exited", processId, at }`. 중복 관찰은 같은 이벤트를 반복 생성하지 않는다. 최대 50개, 최근 10분만 보관한다. 실행 중 최대 64개와 최근 종료 최대 24개를 제공한다.
- 프로세스 목록 조회에 실패하면 이전 실행을 unknown으로 표시하고 마지막 성공 시각을 유지한다. 20초 이상 갱신이 멈추면 disconnected다. 미지원 OS는 unsupported이며 저장 대화 관찰은 계속 가능하다.
- 명령 인수·실행 경로·제목·대화·인증 정보는 응답에 포함하지 않는다. 프로세스를 대화 UUID에 추정 연결하지 않고 프로세스 감지만으로 지시·종료 권한을 부여하지 않는다. 기존 스냅샷에 processes가 없으면 unsupported로 처리한다.

## 로컬 Codex 지시 전송

- `localSessions.control`: `{ enabled, reason, bridgeId? }`. reason은 ready / not_enabled / cli_unavailable / disconnected. 최신 연결 프로그램이 `--allow-commands`로 실행되고 공식 CLI의 큐 지원이 확인된 경우 활성화된다. 개별 전달 성공은 접수 결과로 확인한다.
- `POST /api/local-sessions/:sessionId/commands`: `{ id, content }`. 클라이언트가 생성한 UUID와 1~4000자의 지시. 현재 프로젝트의 관찰 세션만 대상이다. 사무실 중지·관찰 연결 끊김·제어 미활성화는 409, 없는 세션은 404.
- HTTP 202: `{ id, sessionId, status, createdAt, updatedAt, code? }`. 새 요청은 pending. 같은 ID·내용을 다시 보내면 기존 상태를 반환하며 다른 내용은 409 COMMAND_ID_CONFLICT. 응답 유실 시 같은 ID로 조회·재시도한다.
- `GET /api/local-commands/:id`: 위 접수 객체. 지시 원문은 반환하지 않는다. 기록 없음은 404 COMMAND_NOT_FOUND.
- status: pending(전달 대기), sending(CLI 호출 중), accepted(공식 큐 접수), failed(거절), unknown(전달 여부 불명), expired(만료). **accepted는 업무 완료가 아니다.** 결과·승인·중단은 원래 Codex에서 처리한다.
- code: QUEUED / CLI_REJECTED / DELIVERY_UNCERTAIN / REQUEST_EXPIRED / SESSION_UNAVAILABLE / BRIDGE_RESTARTED. 원시 CLI 오류 출력은 전달하지 않는다.
- 요청 유효 시간 60초, CLI 호출 제한 15초. 전달 전 원문을 지우며 중단된 sending 요청은 자동 재실행하지 않는다. 연결 프로그램 재시작 전 요청은 만료 처리한다. 접수 기록은 연결 프로그램 실행 중 7일 보관, 최대 1000개다.

## 로컬 Codex 대화기록

- `localSessions.conversations`: `{ enabled }`. 연결기를 `--include-conversations`로 실행한 경우에만 활성화한다.
- `GET /api/local-sessions/:sessionId/conversation`: `{ sessionId, status, messages, updatedAt, truncated, limit: 60 }`. 현재 작업 공간의 관찰 목록에 있는 UUID만 읽는다. 동일 출처 요청 검사와 `Cache-Control: no-store`를 적용한다.
- `status`: ready(기록 수신), empty(수집 범위에 공개 대화 없음), disabled(미활성화), disconnected(20초 이상 갱신 중단), unavailable(세션 없음·읽기 실패·형식 불일치).
- 메시지: `{ role: "user" | "assistant", timestamp, content, truncated }`. 시스템·개발자 지침, 내부 추론, 도구 원문을 제외한다. 호스트에서 알려진 인증 정보·개인 경로·연락처 패턴을 마스킹하고 화면은 HTML로 실행하지 않는다.
- 로그 끝 1MB에서 최근 최대 60개, 총 24,000자, 메시지당 4,000자만 제공한다. 제한이 적용되면 `truncated`를 표시한다. 기록 파일은 200KB까지 읽으며 상태 JSON은 기존 64KB 한도를 유지한다.
- 호스트는 `data/bridge/conversations/<uuid>.json`을 원자적으로 게시한다. 관찰 범위에서 사라진 파일과 비활성화 시의 내보낸 파일은 다음 수집 때 삭제한다. 원래 Codex 로그를 수정·삭제하지 않는다. SQLite·인계·Git·이미지에 대화를 복제하지 않는다.

## 현재 범위

진행·보관 세션의 자료 검색과 웹 대화 선택 보관은 별도의 [검색 API](session-search-api.md)를 사용합니다. 최근 대화 API와 업무 인계 계약은 그대로 유지합니다.

기존 Codex에 대한 큐 지시 외에 신규 AI 세션 실행, 실제 CLI 승인·중단·모델 변경, 다른 공급자 제어, 토큰·비용 측정, 임의 프로세스 감지, GitHub 자동 인계와 클라우드 인증은 지원하지 않는다.

지원 CLI·AI 웹 탭의 통합 목록은 [감지 API](discovery-api.md), 설치·감지·API 인증의 분리된 점검은 [연결 점검 API](connections-api.md)를 따른다. API 연결 점검 성공은 위 업무 실행 기능을 활성화하지 않는다.
