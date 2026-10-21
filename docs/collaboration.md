# 두 세션 개발 현황

## 담당과 작업 경계

사용자가 두 세션의 병렬 개발을 요청했다. 같은 작업 폴더를 사용하므로 다른 세션의 파일을 덮어쓰거나 일괄 스테이징하지 않는다.

| 담당 | 소유 경로 | 현재 작업 |
| --- | --- | --- |
| 서버 세션 | server/, scripts/, tests/server/, package.json, package-lock.json, Dockerfile, compose.yaml, .dockerignore, .gitignore, .env.example | API·SQLite·Docker 및 Codex 관찰 구현·검증 |
| 웹 세션 | public/, tests/ui/, docs/wiki/UI.md | 의존성 없는 HTML/CSS/JS 사무실 GUI 구현 |
| 서버 세션 통합 | README.md, CHANGELOG.md, docs/wiki/Home.md, rules/ 문서, docs/api.md | 실행 검증 후 실제 구현 범위 반영 |

- 이 문서의 서버 항목은 서버 세션이 갱신한다. 웹 세션은 아래 웹 진행 메모를 갱신해 소통한다.
- Git index는 공유된다. 서버 세션이 commit/push를 전담한다. 웹 세션은 완료 파일 목록과 검증 결과를 전달하며 서버 세션이 검토 후 커밋한다.
- Docker 기본 주소는 http://localhost:8080 이다. 웹 개발 서버는 /api 요청을 http://localhost:8080 으로 프록시한다.
- 서버는 public/을 정적으로 제공한다. 웹 빌드 단계나 외부 의존성은 필요 없다. 루트 npm 스크립트는 서버 세션이 관리한다.
- 실제 AI 인증·명령 제어는 미구현이다. 호스트 Codex의 선택한 프로젝트 기록은 읽기 전용 연결 프로그램으로 관찰한다. 데모는 별도 공급자 demo로 표시하고 실제 모델 추론으로 표현하지 않는다.
- API 계약은 [api.md](api.md)를 기준으로 한다. 화면은 응답에 없는 기능을 추정하지 않는다.

## 웹 진행 메모

- 구현 완료: public/의 사무실·직원·업무·인계 화면, 프로그램·블로그 배너, 레드 테마·자체 호스팅 폰트·상태 캐릭터·CLI 관찰 UI, tests/ui/ 15개 테스트와 docs/wiki/UI.md.
- 브라우저 검증: 직원 채용 → 업무 → 답변 → 승인, 중지·재개, JSON 다운로드, 외부 직원 등록과 실행 비활성화, 연결 끊김 안내, 390px 반응형 화면 확인.
- 웹 세션의 파일 수정과 별도 테스트 서버 운영을 마치고 서버 세션에 통합을 인계했다.

## 서버 진행 메모

- 구현 완료: SQLite 영속 저장, 직원 등록, 데모 업무·질문·승인, 사무실 일시 중지, 인계 내보내기, Docker 구성.
- 검증: 서버 19개 테스트 및 UI 포함 통합 34개 테스트 통과. 별도 Docker 검증 환경에서 정상 종료·재시작·승인 단계 복원, 비루트 실행과 이미지 포함 파일 확인.
- 최종 UI 파일과 문서 통합 완료. 기본 http://localhost:8080 에 Docker 컨테이너를 실행하고 서버 연결·사무실 재개·직원 채용 화면을 확인했다.
- 후속 구현: `OFFICE_NAME` 설정, StackQueue Blog 배너 데이터, 호스트 Codex 관찰 프로그램과 `localSessions` 상태 API. 실제 두 세션의 상태만 전달하며 새 Docker 화면에서 표시됨을 확인.
- 확정 전: 실제 AI 공급자 실행 연결, 인증 저장과 세션 제어권.
