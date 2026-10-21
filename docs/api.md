# 초기 API 계약

서버 세션과 웹 세션의 통합 기준. JSON은 camelCase, 시간은 ISO 8601 UTC, ID는 UUID다. API는 같은 origin의 /api 경로를 사용한다. 로컬 전용이며 외부 공개용 인증은 아직 없다.

## 응답

- 성공: 조회는 아래 객체, 생성은 HTTP 201과 생성된 객체, 변경은 HTTP 200과 변경된 객체.
- 오류: `{ "error": { "code": "VALIDATION_ERROR", "message": "사용자 안내" } }`.
- 요청 본문은 application/json. API 키·토큰을 보내거나 저장하는 기능은 없다.
- `GET /api/health`: `{ "status": "ok", "version": "0.1.0-dev" }`.
- `GET /api/state`: 아래 전체 상태. GUI는 2~3초마다 재조회하며 연결 실패는 별도 표시한다.

```json
{
  "office": { "name": "wook-home", "paused": false, "mode": "local", "version": "0.1.0-dev" },
  "providers": [],
  "agents": [],
  "tasks": [],
  "events": [],
  "programs": []
}
```

## 공급자와 직원

- `GET /api/providers`: 공급자 객체 배열.
- 공급자: `{ id, name, available, kind, reason, models, reasoningEfforts, capabilities }`. kind는 demo 또는 external. capabilities는 `{ createSession, observeSession, resumeSession, interrupt, changeModel }` 불리언 객체.
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

- `POST /api/office/pause`: `{}`. 새 업무와 진행을 중지하고 미완료 업무를 paused로 저장. 이전 상태를 내부 보관한다.
- `POST /api/office/resume`: `{}`. 이전 상태 복원. 위 두 응답은 office 객체.
- `GET /api/handoff`: 검토용 JSON 파일 다운로드. `{ schemaVersion, exportedAt, office, agents, tasks }`. tasks는 제목·설명·상태·결과·messages를 포함한다. 내용에 사용자 입력이 포함되므로 공개 전 검토가 필요하며 자동 커밋·푸시하지 않는다. 인계 가져오기는 후속 기능이다.
- SIGTERM 종료 시 업무 상태를 저장하며 미완료 작업은 paused로 남긴다. 재시작 후 Commander가 resume을 눌러 이어간다.
- 프로그램: `{ name, description, url }` 세 개(wShell, wPost, wText).

## 현재 범위

외부 AI 호출, 토큰·비용 측정, 호스트 프로세스 감지, GitHub 자동 인계, 클라우드 인증은 이 API 버전에서 지원하지 않는다. 별도의 진짜 세션이 감지된 것처럼 표시하지 않는다.
