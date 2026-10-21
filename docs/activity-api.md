# Observed scene activity

`GET /api/state`의 `localSessions.activities.enabled`는 호스트 연결기의 활동 요약 지원 여부다. 연결기는 선택한 프로젝트의 구조화 이벤트만 읽으며 `session.activity`는 다음 형태의 선택 필드다.

```json
{
  "kind": "collaborating",
  "phase": "recent",
  "since": "2026-10-22T01:00:00.000Z",
  "expiresAt": "2026-10-22T01:01:00.000Z",
  "peerSessionIds": ["00000000-0000-0000-0000-000000000002"]
}
```

- `collaborating/recent`: 완료된 `codex_tui.send_message_to_thread` MCP 이벤트. 성공한 전송만 최대 60초 표현하고 관찰 범위에 있는 상대 세션에 양방향 연결한다. `read_thread`, 단순 도구 이름 언급, 실패한 전달은 해당하지 않는다.
- `question/active`: `request_user_input` 또는 `request_user_input_async` 구조화 호출. 해당 응답·정확한 비동기 응답 봉투·턴 경계에서 해제한다. 비동기 질문의 단순 접수 응답은 답변으로 간주하지 않는다.
- `approval/active`: 기록된 명시적 승인 요청 이벤트. 승인 요청이 로그에 없는 클라이언트는 감지할 수 없다. 실제 승인은 원래 Codex 인터페이스에서 처리한다.
- 질문·승인은 최대 30분, 협업은 60초로 제한한다. 생성 시각이 미래이거나 오래된 연결기, 잘못된 값, 중단 상태와 감지 범위 밖 참여 ID는 제거한다.

이 필드는 실행 상태·비용·완료·제어 권한이 아니다. UI는 회의실의 논의 또는 대표이사실의 발표에만 사용한다. 체험 업무의 질문·승인 상태는 같은 발표 동작으로 연결한다. 명령 전송·공급자 승인·관찰은 기존 계약을 유지한다.

활동에는 원문·프롬프트·질문·도구 출력·개인 경로를 넣지 않는다. 연결기의 로컬 상태파일과 서버 메모리만 사용하고 DB·검색 기록·인계·배포물에 넣지 않는다. 지원 이벤트가 없는 웹 탭과 다른 CLI에는 활동을 추정하지 않는다.

상태와 요청 해제 방식의 참고: [Codex App Server](https://learn.chatgpt.com/docs/app-server). JSONL은 설치된 클라이언트의 확인된 구조에 맞춰 제한적으로 처리하므로 모든 App Server 이벤트가 로컬 로그에 남는다고 가정하지 않는다.
