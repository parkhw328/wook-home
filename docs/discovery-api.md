# CLI·웹 감지 API

모든 경로는 기존 로컬 Host 및 same-origin 검증을 적용한다. 별도 CORS 예외나 원격 업로드 경로를 열지 않는다. 브라우저 확장프로그램은 로컬 페이지에 최소 메타데이터를 전달하고 페이지가 같은 origin으로 API를 호출한다.

## 조회

`GET /api/discovery`

- `sources.cli`: 기존 프로젝트별 Codex 기록 관찰 연결의 `status`, `workspace`, `updatedAt`.
- `sources.processes`: 호스트 CLI 프로세스 센서의 `status`, `updatedAt`, `platform`(win32/linux/unknown), 표시용 `scope`. Linux 같은 사용자 또는 Windows 로그인 세션 범위를 표시하며 사용자 이름·UID는 내보내지 않는다. 이전 연결기의 플랫폼 정보가 없으면 `unknown`과 `이 PC`로 유지한다.
- `sources.browsers`: `id`(무작위 프로필 별칭), `status`(connected/disconnected), `updatedAt`, `truncated`.
- `entries`: 공급자, 이름, `source`(cli/web), `kind`(process/session/conversation/page), `status`, `scope`, 갱신/활동 시각, `tabCount`, `canControl`. CLI 프로세스는 프로젝트 대화 UUID와 연결하지 않는다. 웹 항목에는 원본 URL이나 대화 식별자를 반환하지 않는다.
- CLI 세션의 `scope`는 해당 세션의 프로젝트 이름이며 확인된 `workspace`·`workspaceKey`를 함께 제공한다. 최상위 `sources.cli.workspace`는 공개 대화·지시 전송에 선택한 작업 폴더다. 다른 프로젝트의 살아 있는 세션도 등록할 수 있지만 `canControl: false`로 유지한다.
- `counts`: `cli`(관찰 기록 수), `cliProcesses`(현재 running 수), `webTabs`(연결된 열린 탭 합계), `webConversations`(대화별 중복 제거 수), `webPages`(서비스·새 대화 화면 수).

웹 `status`는 open/disconnected이며 실제 AI 작업 상태가 아니다. CLI 프로세스의 running/exited/unknown과 Codex 기록 상태는 [기존 API](api.md)를 따른다. `canControl`은 웹·프로세스에 항상 false다.

## 브라우저 관찰 갱신

`POST /api/discovery/browser`

```json
{
  "schemaVersion": 1,
  "clientId": "00000000-0000-0000-0000-000000000001",
  "observedAt": "2026-10-22T00:00:00.000Z",
  "truncated": false,
  "tabs": [
    { "id": "1", "provider": "claude", "kind": "page", "key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  ]
}
```

위 값은 계약 예시이며 실제 연결 결과가 아니다. `key`는 확장프로그램에서 프로필 별칭·공급자·대화 식별자(서비스 화면은 탭 번호)를 SHA-256으로 변환한 값이다. 공급자는 openai/claude/gemini/meta, 종류는 conversation/page만 허용한다. 정해진 필드 외 제목·본문·URL 등의 추가 필드는 거절한다.

프로필별 최신 전체 목록으로 교체한다. 빈 배열은 정상 연결에서 열린 대상이 없는 상태다. 동일하거나 이전 시각의 응답은 `{ accepted: false, reason: "outdated" }`로 무시한다. 탭 번호 중복, 잘못된 식별자·시각, 128개 초과는 400, 최대 8개 프로필을 넘는 새 연결은 429다.

관찰이 90초 이상 오래되면 연결 끊김으로 표시하고 열린 탭 집계에서 제외한다. 한 시간 동안 갱신되지 않은 프로필은 제거한다. 브라우저 새 관찰이 들어오면 복구된다. 감지 데이터는 메모리에만 존재하며 서버 재시작 후 남지 않는다.

`DELETE /api/discovery/browser/:clientId`는 해당 관찰값을 지운다. 실제 브라우저 탭·대화에는 영향을 주지 않는다. 아직 켜진 다른 사무실 페이지가 같은 프로필을 계속 전달하면 다음 관찰에 다시 나타날 수 있다. 같은 origin의 페이지는 감지 켜기/끄기를 localStorage로 동기화한다.

확장 설치와 해제는 [Detection](wiki/Detection.md)을 참고한다. 자동 검증은 `node --test tests/extension/*.test.mjs tests/server/discovery.test.js tests/ui/discovery.test.mjs`로 실행한다.
