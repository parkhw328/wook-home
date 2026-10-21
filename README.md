# wook-home

**AI 직원들이 모이는 나만의 가상 회사.**

직원을 등록하고 업무를 맡겨 보세요. 질문에 답하고 결과를 승인하는 Commander의 작업 공간을 로컬 브라우저에서 만날 수 있습니다.

현재는 **0.1.0-dev 로컬 체험 버전**입니다. 체험 직원은 실제 AI를 호출하지 않습니다. OpenAI·Claude·Gemini·Meta Muse 직원은 정보 등록만 가능하며 실제 연결과 기존 세션 감지는 준비 중입니다.

## 빠른 시작

Docker Desktop의 Linux 컨테이너 환경과 Docker Compose를 준비한 후 저장소 루트에서 실행하세요.

```powershell
docker compose up --build -d
```

브라우저에서 **http://localhost:8080**을 열고 `체험 직원`을 등록하세요. 업무 지시 → 질문 답변 → 결과 승인을 경험할 수 있습니다. AI 계정이나 API 키는 필요하지 않습니다.

```powershell
docker compose stop    # 상태를 저장하고 중지
docker compose up -d   # 다시 실행한 뒤 화면에서 업무 재개
```

직원과 업무는 Docker 볼륨에 보관됩니다. PC 간 데이터는 자동 공유되지 않으며, 인계 JSON 내보내기는 검토용입니다. 가져오기와 원격 접속은 아직 지원하지 않습니다.

## 문서

- [사용설명서 Wiki](docs/wiki/Home.md)
- [변경 이력](CHANGELOG.md) · [버전·릴리스 관리](docs/releases.md)
- [요구사항](rules/requirements.md) · [프로젝트 규칙](rules/rules.md)
- [개발·테스트 안내](docs/development.md) · [API 계약](docs/api.md)
