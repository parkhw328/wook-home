# 연결 점검 API

서버는 `server/connections.js`의 `createConnections({ observer, discovery, env, fetchImpl, clock })`로 연결 상태를 구성한다. 인증은 서버 시작 시 환경 변수에서 읽는다. 웹 요청으로 키·주소·모델을 받지 않는다. 테스트에서는 `env: {}`와 가짜 `fetchImpl`을 주입하여 실제 공급자를 호출하지 않는다.

## 경로와 응답

- `GET /api/connections`: 로컬 감지와 마지막 API 점검 결과. 외부 요청 없음.
- `POST /api/connections/check`: 빈 JSON 객체 `{}`만 허용. 네 공급자의 설정된 API만 읽기 전용으로 점검한다. 잘못된 본문은 `400 INVALID_CONNECTION_CHECK`다.
- 기존 로컬 Host·Origin 제한과 `Cache-Control: no-store`가 적용된다.

두 경로는 `{ checkedAt, nextCheckAt, checking, checks }`를 반환한다. 상위 `checkedAt`은 마지막 점검 묶음의 완료 시각, `nextCheckAt`은 다음 외부 요청 가능 시각이며 미실행 때는 `null`이다.

각 `checks` 항목은 `id`, `source` (`office`, `cli`, `web`, `api`), `name`, `status`, `statusLabel`, `message`, `action`, `checkedAt`, `canControl`, 고정 Wiki `guideUrl`을 포함한다. 공급자 항목에는 `provider`가 있다. API에는 `configured`, `httpStatus`, `latencyMs`, 일부 CLI에는 `installed`가 추가된다. 인증 값과 모델 이름은 반환하지 않는다. API 항목의 `canControl`은 항상 `false`다.

API 상태: `not_configured`, `not_checked`, `checking`, `reachable`, `no_models`, `auth_failed`, `forbidden`, `request_rejected`, `rate_limited`, `timeout`, `network_error`, `invalid_response`, `service_error`, `redirect_blocked`, `config_invalid`, `stale`.

## 요청 제한과 경계

- 공식 HTTPS 모델 목록 GET만 허용. 공급자별 인증 헤더를 사용하며 리디렉션을 따르지 않는다.
- 요청·본문 수신에 6초 제한, 응답 256 KiB 제한. 공급자 오류 본문은 읽지 않는다.
- 동시 호출은 진행 중인 요청 하나를 공유한다. 완료 후 30초 동안 기존 결과를 반환하며 자동 재시도하지 않는다.
- 결과는 메모리에만 저장한다. 5분 뒤 `stale`로 표시하고 서버 재시작 때 초기화한다. DB·인계에는 추가하지 않는다.
- HTTP 200만으로 성공하지 않는다. 공식 JSON 목록 형식과 각 모델 식별자 존재를 검사한다. 빈 목록은 `no_models`다.
- API 키 수정은 서버 재시작이 필요하다. 현재 구현은 공식 직접 API 대상이며 프록시·Azure·Vertex 등 다른 API 규약은 포함하지 않는다.

CLI 설치 후보 수집은 호스트의 `scripts/lib/cli-tools.mjs`가 수행한다. 제한된 절대 PATH에서 파일 존재만 검사하며 실행·인증 파일 열람은 하지 않는다. `server/cli-tools.js`가 ID와 `installed: true|false|null`만 수용하고 연결이 오래되면 `null`로 정제한다. 프로세스 실행·종료는 별도 센서를 사용한다.

사용법과 출처는 [Connections Wiki 원본](wiki/Connections.md)을 참고한다. 검증: `node --test tests/server/connections.test.js tests/server/connections-http.test.js`.
