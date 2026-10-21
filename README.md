# wook-home

**AI 직원들이 모이는 나만의 가상 회사.**

복도를 지나 동료의 방으로 들어가 보세요. 직원을 등록하고 업무를 맡기며, 회의실에서 질문에 답하고 대표이사실에서 보고를 확인합니다. Commander의 작업 공간, **StackQueue Office**를 로컬 브라우저에서 만날 수 있습니다.

현재는 **0.1.0-dev 개발 버전**입니다. 기존 Codex의 활동과 최근 대화기록을 보고 선택한 세션에 실제 지시를 보낼 수 있습니다. 체험 직원으로 업무·질문·승인 흐름도 경험할 수 있습니다. 새 AI 세션 채용·모델 변경과 다른 공급자의 실제 업무 실행은 준비 중입니다.

한글·영문 본문은 17px, 메뉴·입력창은 16px, 보조 정보는 최소 14px로 표시하며 작은 화면에서도 글자 크기를 유지합니다.

## 빠른 시작

Docker Desktop의 Linux 컨테이너 환경과 Docker Compose를 준비한 후 저장소 루트에서 실행하세요.

```powershell
docker compose up --build -d
```

브라우저에서 **http://localhost:8080**을 열고 `체험 직원`을 등록하세요. 사무실 입장 → 업무 지시 → 회의실 답변 → 대표이사실 보고·승인을 경험할 수 있습니다. AI 계정이나 API 키는 필요하지 않습니다.

사무실 이름은 `.env`의 `OFFICE_NAME=StackQueue Office`로 바꿀 수 있습니다. `.env.example`을 참고하고 변경 후 `docker compose up -d`로 적용하세요.

이미 실행 중인 Codex에 지시하려면 호스트에 Node.js 24.14 이상(27 미만)과 `codex queue`를 지원하는 CLI를 준비하고 별도 터미널에서 실행하세요. [Wiki의 연결·명령 안내](https://github.com/parkhw328/wook-home/wiki/CLI)를 확인할 수 있습니다.

```powershell
npm run bridge:codex -- --workspace . --allow-commands --include-conversations
```

```powershell
docker compose stop    # 체험 상태를 저장하고 중지 (외부 Codex는 별도 종료)
docker compose up -d   # 다시 실행한 뒤 화면에서 업무 재개
```

직원과 업무는 Docker 볼륨에 보관됩니다. PC 간 데이터는 자동 공유되지 않으며, 인계 JSON 내보내기는 검토용입니다. 가져오기와 원격 접속은 아직 지원하지 않습니다.

## 문서

- [CLI·웹 감지 안내](https://github.com/parkhw328/wook-home/wiki/Detection) · [전체 연결 점검](https://github.com/parkhw328/wook-home/wiki/Connections)
- [사용설명서 Wiki](https://github.com/parkhw328/wook-home/wiki)
- [기존 Codex 연결](https://github.com/parkhw328/wook-home/wiki/CLI) · [StackQueue Blog](https://blog.naver.com/stack-queue)
- [공급자 서비스 접속·연결 준비](https://github.com/parkhw328/wook-home/wiki/Providers)
- [변경 이력](CHANGELOG.md) · [버전·릴리스 관리](docs/releases.md)
- [요구사항](rules/requirements.md) · [프로젝트 규칙](rules/rules.md)
- [개발·테스트 안내](docs/development.md) · [API 계약](docs/api.md)
