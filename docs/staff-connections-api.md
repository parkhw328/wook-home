# 감지 대상과 직원 연결 API

직원 정의는 SQLite에 저장하고 현재 CLI·웹 감지 대상과의 연결은 서버 메모리에 둔다. 연결은 공급자의 실행 권한을 변경하지 않는다. 모든 경로는 기존 로컬 주소·동일 출처 검증과 JSON 입력 제한을 적용한다.

## 등록·연결·해제

| 요청 | 입력 | 결과 |
| --- | --- | --- |
| `POST /api/agents/from-discovery` | `{ entryId, name, role, projectName? }` | 201, 새 직원과 관찰 연결 |
| `PUT /api/agents/:id/connection` | `{ entryId, settingsRevision? }` | 200, 같은 공급자의 기존 직원 연결 변경 |
| `DELETE /api/agents/:id/connection` | 선택 JSON `{ settingsRevision? }` | 200, 연결만 해제한 직원 |

`entryId`는 최신 `GET /api/discovery` 응답에서 선택한다. 직원 별칭(`name`) 1~40자, 역할 1~120자이며 선택 사항인 `projectName`은 0~80자의 한 줄이다. 공급자·모델·제어 권한을 클라이언트에서 지정하지 않는다. 지원되는 CLI 저장 대화, 실행 중인 프로세스, 열린 웹 대화·서비스 화면을 선택할 수 있다.

현재 UI는 연결 변경·해제 시 조회한 직원의 `settingsRevision`을 항상 전송한다. 값은 0 이상의 안전한 정수이며 형식 오류는 400 `VALIDATION_ERROR`, 다른 화면의 변경으로 오래된 값은 409 `SETTINGS_CONFLICT`다. 충돌하면 직원 설정과 메모리 연결 매핑을 모두 유지한다. 최신 목록을 확인한 뒤 다시 선택·저장하며 자동으로 덮어쓰지 않는다. 필드 생략과 본문 없는 DELETE는 기존 클라이언트 호환용이고 이 경우 버전 충돌 보호는 적용되지 않는다.

대상이 사라지거나 감지 연결이 끊기면 409 `ENTRY_UNAVAILABLE`, 이미 다른 직원에 연결됐으면 409 `ENTRY_ALREADY_LINKED`, 공급자가 다르면 409 `PROVIDER_MISMATCH`다. 입력 실패는 직원을 만들거나 기존 연결을 바꾸지 않는다. 중복 요청으로 직원을 추가 생성하지 않는다. 응답 유실 시 목록을 조회하고 자동 재전송하지 않는다.

연결 해제는 직원·CLI·웹 탭을 삭제하거나 종료하지 않는다. 일반 직원 정보 등록인 `POST /api/agents`와 체험 업무 API는 기존 동작을 유지한다.

## 조회

`GET /api/discovery`의 각 항목에 `linkedAgentId`, `linkedAgentName`, `canRegister`가 추가된다. 두 식별 정보는 미연결이면 `null`이며, 연결 가능한 최신 대상만 `canRegister=true`다.

`GET /api/state`의 등록 직원에는 선택적으로 `connection`이 포함된다.

```json
{
  "source": "web",
  "kind": "conversation",
  "status": "connected",
  "statusLabel": "연결 관찰",
  "canControl": false
}
```

- `source`: `cli` / `web`. `kind`: CLI는 `session` / `process`, 웹은 `conversation` / `page`.
- `status`: `connected`, `disconnected`, `missing`, `ended`, `unknown`, `not_connected`.
- CLI 연결의 `lifecycle`은 `live` / `not_loaded` / `unknown`으로 생존 근거와 마지막 활동을 분리한다. `sessionId`는 전체 UUID이며 별칭(`name`)과 독립이다.
- 메모리에 연결이 있으면 `entryId`, 현재 감지 항목이 있으면 `name`, `scope`, `tabCount`, `updatedAt`을 포함한다. 연결된 CLI 저장 대화만 `sessionId`를 포함한다.
- `canControl`은 최신 CLI 저장 대화의 실제 호스트 지시 허용, 사무실 재개와 직원 업무가 창고 보관 중이 아닌 상태를 모두 확인한다. 웹·프로세스 감지는 항상 `false`다. 실제 지시는 기존 `/api/local-sessions/:sessionId/commands`로 보낸다.
- 직원 상태는 관찰 연결 중 `observing`, 확인이 필요하면 `unknown`, 나머지 단절 상태는 `disconnected`로 투영한다. 이 상태를 업무 성공이나 웹 로그인으로 해석하지 않는다.

## 저장과 재시작

DB에는 직원 별칭·설정, `{ source, kind }`와 로컬 전용 `sessionRegistry`를 보관한다. 등록 키는 공급자와 전체 세션 UUID를 해시한 값이고 값은 직원 ID 또는 명시적 자동 등록 제외를 뜻하는 `null`이다. 원문 세션 UUID·브라우저·프로세스 정보는 저장하지 않는다. 연결 변경·해제·직원 해제도 같은 DB 갱신에서 반영한다. 직원 100명·등록 기록 4096개 한도에 도달하면 대상을 미등록 목록에 유지한다.

`GET /api/state`와 `GET /api/discovery`는 최신 관찰에 맞춰 현재 프로젝트의 `lifecycle=live` 세션을 한 번만 직원으로 등록한다. 같은 키는 같은 직원으로 연결하고 별칭을 덮어쓰지 않는다. 해제한 키는 자동 등록하지 않는다. 기존 버전에서 등록한 세션 직원에 해시 정보가 없다면 먼저 기존 직원을 명시적으로 연결하여 중복 등록을 피한다.

재시작 후 생존이 확인된 동일 세션만 자동 연결한다. 생존 미확인 기록의 키가 기존 직원과 일치하면 전체 ID를 표시하되 `not_connected`·제어 불가로 유지하고 중복 등록을 막는다. 웹·프로세스는 기존처럼 직접 다시 선택한다. `GET /api/handoff`와 공개 직원 상태는 등록 레지스트리를 제외하며 인계에는 원문 관찰 정보·연결 선택도 넣지 않는다.
