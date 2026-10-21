# AI 공급자 접속과 연결 준비

사무실의 공급자 카드에서 **서비스 열기**를 누르면 공식 서비스가 새 탭으로 열립니다. **연결 안내**는 이 페이지로 연결됩니다. 각 서비스의 로그인은 해당 사이트에서 진행하세요.

외부 서비스에 로그인해도 사무실이 그 계정의 대화나 실행 세션에 자동으로 연결되지는 않습니다. 현재 실제 지시 전송은 호스트에서 연결한 기존 Codex 세션에 제공하며, 다른 공급자의 직원은 정보 등록까지만 가능합니다.

## 공식 서비스와 준비 문서

| 공급자 | 공식 서비스 | 설치·인증 및 개발 문서 | 이 사무실의 현재 지원 |
| --- | --- | --- | --- |
| OpenAI | [ChatGPT 열기](https://chatgpt.com/) | [Codex CLI 명령](https://learn.chatgpt.com/docs/developer-commands), [사무실 연결 절차](CLI.md) | 기존 로컬 Codex 관찰·지시 전송. ChatGPT 웹 대화 가져오기는 미지원 |
| Claude | [Claude 열기](https://claude.ai/) | [Claude Code 설치와 로그인](https://code.claude.com/docs/en/quickstart) | 직원 정보 등록. Claude Code 실행·세션 연결은 준비 중 |
| Google Gemini | [Gemini 열기](https://gemini.google.com/) | [Gemini CLI 시작 안내](https://geminicli.com/docs/get-started/) | 직원 정보 등록. Gemini CLI 실행·세션 연결은 준비 중 |
| Meta Muse | [Meta AI 열기](https://www.meta.ai/), [Muse 앱 안내](https://ai.meta.com/muse/) | [Muse 다운로드](https://ai.meta.com/muse/download/), [Meta Model API 에이전트 연결](https://dev.meta.ai/docs/agent-frameworks) | 직원 정보 등록. 모델 API 실행과 기존 앱 세션 연결은 준비 중 |

Meta 카드의 **Meta AI 열기**는 Meta AI 웹 서비스로 연결됩니다. 별도 개인 에이전트인 Muse 앱은 위 공식 안내에서 접근하세요. Muse 앱의 기존 세션 연결과 Muse 모델 API를 이용한 새 직원 실행은 별도 기능입니다. 서비스 이용 가능 여부와 인증 조건은 각 공식 사이트에서 확인하세요.

## 지금 Codex에 지시하려면

Docker가 실행 중인 PC에서 프로젝트 폴더의 터미널을 열고 다음 명령을 실행합니다. Node.js와 공식 Codex CLI가 필요하며, 해당 PC에서 Codex를 먼저 로그인하고 프로젝트 세션을 열어야 합니다.

```powershell
npm run bridge:codex -- --workspace . --allow-commands
```

사무실에서 표시된 CLI 세션을 선택하고 지시를 입력합니다. **Codex 접수**는 큐가 지시를 받은 상태입니다. 진행 중인 턴이 끝난 뒤 처리될 수 있으며, 답변·승인 요청·중단은 원래 Codex에서 확인합니다. 설정과 문제 해결은 [기존 Codex 연결 안내](CLI.md)를 따르세요.

## 다른 공급자를 준비하려면

1. 카드의 공식 서비스 링크에서 필요한 계정으로 로그인합니다.
2. 위 표의 공식 문서에서 사용할 CLI 또는 API의 설치·인증 조건을 확인합니다.
3. 사무실에는 직원 이름과 역할을 등록할 수 있습니다. 연결 기능이 제공되기 전까지 실제 실행 버튼과 모델 설정은 활성화되지 않습니다.

이 사무실은 현재 외부 공급자 비밀번호나 API 키를 입력받지 않습니다. 인증 정보는 각 공식 도구에서 관리하며 Git이나 Docker 이미지에 넣지 마세요.

공식 링크 확인: 2026-10-21. [화면 사용법](UI.md) · [빠른 시작](Home.md)
