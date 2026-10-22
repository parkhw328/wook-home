# 연결 점검

사무실 화면의 **연결 관리 → 연결 점검** 탭에서 **연결 점검 실행**을 누르세요. 대상별 상태와 필요한 조치를 확인할 수 있습니다. **감지** 탭으로 돌아가면 기존 필터로 CLI·웹 목록을 확인할 수 있습니다. 탭 전환과 자동 갱신은 저장된 점검 결과만 표시하며, 외부 API 점검은 실행 버튼을 눌렀을 때 요청합니다.

## 무엇을 확인하나요?

| 대상 | 확인하는 내용 | 확인되지 않는 내용 |
| --- | --- | --- |
| 사무실 서버 | HTTP 응답 | 다른 PC·인터넷에서의 접근 |
| 호스트 연결 프로그램 | 최근 수신과 Codex 지시 연결 설정 | 원래 CLI 업무 완료 |
| CLI | PATH의 Codex·Claude·Gemini 실행 파일 후보, Windows의 지원 프로세스 실행·종료 | 설치 후보의 버전·인증·프로젝트 소속, Muse Code 실행 |
| AI 웹 | 연결한 Chrome 프로필의 ChatGPT·Claude·Meta AI·Gemini 탭 | 로그인·작업 실행·대화 내용·웹 지시 전송 |
| API | 서버 인증 설정과 공식 모델 목록 응답 | 실제 직원 실행, 생성 권한·잔액·작업 성공 |

설치 여부, CLI 기록, 실행 프로세스, 웹 탭, API 인증은 서로 다른 항목입니다. 같은 계정의 웹 로그인이나 CLI 구독만으로 API 키가 생기지는 않습니다. API 점검에 성공해도 준비 중인 직원 실행 기능이 활성화되지는 않습니다.

## 로컬 CLI와 웹 연결

- CLI는 호스트 PC에서 연결 프로그램을 실행해야 합니다. [CLI 연결 안내](CLI)를 따라 실행·기록·지시 허용 범위를 설정하세요.
- PATH에 실행 파일 후보가 없더라도 다른 경로에서 CLI가 실행될 수 있습니다. 설치 미감지를 삭제나 미설치의 확정으로 해석하지 않습니다.
- 웹은 브라우저 확장프로그램 설치 후 사무실에서 감지를 켜야 합니다. [웹·CLI 통합 감지 안내](Detection)를 따르세요. 연결한 브라우저 프로필만 관찰합니다.
- 호스트 연결이나 브라우저 감지가 끊기면 마지막 관찰과 현재 상태를 구분합니다. 실행·종료 목록과 저장된 Codex 대화는 별개입니다.

## API 설정

사용할 공급자의 키만 서버 환경 변수에 설정하세요. Docker Compose에서는 저장소 루트의 로컬 `.env`에 설정한 뒤 `docker compose up -d --build`로 컨테이너를 다시 만듭니다. 기존 `.env`는 보존하며, 처음 설정할 때만 `.env.example`을 복사합니다. 키는 화면이나 채팅에 입력하지 않습니다.

| 공급자 | 환경 변수 | 공식 안내 |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | [API 인증](https://developers.openai.com/api/reference/overview) |
| Claude | `ANTHROPIC_API_KEY` | [API 인증](https://platform.claude.com/docs/en/manage-claude/authentication) |
| Gemini | `GEMINI_API_KEY` | [API 키 설정](https://ai.google.dev/gemini-api/docs/api-key) |
| Meta Model API | `MODEL_API_KEY` | [API 인증](https://dev.meta.ai/docs/authentication) |

Gemini는 `GEMINI_API_KEY`가 비어 있으면 `GOOGLE_API_KEY`, Meta는 `MODEL_API_KEY`가 비어 있으면 `META_API_KEY`를 사용합니다. 여러 Claude 워크스페이스에 접근하는 키는 `ANTHROPIC_WORKSPACE_ID`도 설정합니다. 직접 Node 서버를 실행할 때는 시작하는 프로세스의 환경 변수를 설정해야 하며 `.env`를 자동으로 읽지 않습니다.

`.env`와 인증 값은 Git·Docker 이미지·화면 응답에 포함하지 않습니다. 키를 수정한 뒤에는 서버나 컨테이너를 재시작하고 다시 점검하세요. API 점검은 컨테이너의 네트워크에서 실행되므로 호스트 CLI의 접속 결과와 다를 수 있습니다.

## 결과 읽기

정상 응답·감지는 **초록색**, 확인 필요·일부 연결·오래된 결과는 **황토색**, 연결 끊김·오류는 **빨간색**으로 표시합니다. 점검 중·설치 감지 정보는 파란색, 사용하지 않거나 설정하지 않은 연결은 회색입니다. 아이콘·문구·카드 테두리도 함께 구분하며 [감지 상태 색상 안내](Detection#상태-색상-읽기)에서 예시를 볼 수 있습니다. 미설정·열린 탭 없음은 실패가 아니며, 초록색 API 응답도 직원 업무 실행을 의미하지 않습니다.

- **미설정 / 미점검:** 서버에 키가 없거나 아직 실제 요청을 보내지 않았습니다.
- **응답 정상 / 모델 없음:** 모델 목록 형식을 확인했습니다. 비어 있는 목록은 별도로 표시합니다.
- **인증·접근·요청 거절:** API 키, 프로젝트·지역·접속 제한을 확인하세요. 공급자 오류 원문은 수집하지 않습니다.
- **요청 제한 / 시간 초과 / 연결 실패:** 공급자 한도 또는 컨테이너의 인터넷·DNS·TLS·프록시 설정을 확인하세요.
- **응답 확인 실패 / 서비스 오류 / 주소 변경 거절:** 응답 형식·서비스 상태·공식 주소를 확인하세요. 인증 정보를 다른 주소로 보내지 않습니다.
- **재점검 필요:** 마지막 API 점검 후 5분이 지났습니다. 확인 시각과 함께 다시 점검하세요.

한 번의 API 점검은 최대 6초이며 같은 서버의 동시 요청은 합칩니다. 다시 점검하려면 완료 후 30초가 필요합니다. 모델 목록을 읽는 GET 요청만 사용하고 생성 요청·업무 실행·로그인·키 발급은 자동으로 하지 않습니다. 인증 값과 모델·오류 응답 원문은 화면·로그·인계에 저장하지 않습니다.

공식 점검 경로: [OpenAI 모델 목록](https://developers.openai.com/api/reference/resources/models/methods/list), [Claude 모델 목록](https://platform.claude.com/docs/en/api/models/list), [Gemini 모델 목록](https://ai.google.dev/api/models), [Meta 모델 목록](https://dev.meta.ai/docs/api-reference/models/list-models).
