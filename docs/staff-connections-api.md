# 감지 대상과 직원 연결 API

직원 정의는 SQLite에 저장하고 현재 CLI·웹 감지 대상과의 연결은 서버 메모리에 둔다. 연결은 공급자의 실행 권한을 변경하지 않는다. 모든 경로는 기존 로컬 주소·동일 출처 검증과 JSON 입력 제한을 적용한다.

## 등록·연결·해제

| 요청 | 입력 | 결과 |
| --- | --- | --- |
| `POST /api/agents/from-discovery` | `{ entryId, name, role }` | 201, 새 직원과 관찰 연결 |
| `PUT /api/agents/:id/connection` | `{ entryId }` | 200, 같은 공급자의 기존 직원 연결 변경 |
| `DELETE /api/agents/:id/connection` | 없음 | 200, 연결만 해제한 직원 |

`entryId`는 최신 `GET /api/discovery` 응답에서 선택한다. 이름 1~40자, 역할 1~120자이며 공급자·모델·제어 권한을 클라이언트에서 지정하지 않는다. 지원되는 CLI 저장 대화, 실행 중인 프로세스, 열린 웹 대화·서비스 화면을 선택할 수 있다.

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
- 메모리에 연결이 있으면 `entryId`, 현재 감지 항목이 있으면 `name`, `scope`, `tabCount`, `updatedAt`을 포함한다. 연결된 CLI 저장 대화만 `sessionId`를 포함한다.
- `canControl`은 최신 CLI 저장 대화의 실제 호스트 지시 허용과 사무실 재개 상태를 모두 확인한다. 웹·프로세스 감지는 항상 `false`다. 실제 지시는 기존 `/api/local-sessions/:sessionId/commands`로 보낸다.
- 직원 상태는 관찰 연결 중 `observing`, 확인이 필요하면 `unknown`, 나머지 단절 상태는 `disconnected`로 투영한다. 이 상태를 업무 성공이나 웹 로그인으로 해석하지 않는다.

## 저장과 재시작

DB에는 직원 정보와 사용자 선택인 `{ source, kind }`만 보관한다. 관찰 식별자·브라우저 정보·프로세스 정보·현재 상태를 저장하지 않는다. 재시작하면 직원 정보는 유지하고 `not_connected`로 표시한다. 최신 목록에서 기존 직원을 선택해 다시 연결한다. `GET /api/handoff`는 연결 선택 정보와 관찰 매핑을 모두 제외한다.
