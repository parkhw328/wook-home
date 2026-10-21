# 두 세션 개발 현황

## 담당과 작업 경계

사용자가 두 세션의 병렬 개발을 요청했다. 같은 작업 폴더를 사용하므로 다른 세션의 파일을 덮어쓰거나 일괄 스테이징하지 않는다.

| 담당 | 소유 경로 | 현재 작업 |
| --- | --- | --- |
| 서버 세션 | server/, tests/, package.json, package-lock.json, Dockerfile, compose.yaml, .dockerignore, .gitignore, .env.example | API·SQLite 저장·Docker 실행 기반 구현 중 |
| 웹 세션 | web/ 전체 | 사무실 GUI 구현. web/package.json, web/package-lock.json과 빌드 결과 web/dist/ 제공 |
| 서버 세션 통합 | README.md, CHANGELOG.md, docs/wiki/Home.md, rules/ 문서, docs/api.md | 실행 검증 후 실제 구현 범위 반영 |

- 이 문서의 서버 항목은 서버 세션이 갱신한다. 웹 세션은 아래 웹 진행 메모를 갱신해 소통한다.
- Git index는 공유된다. 커밋 전 스테이징된 파일을 확인하고 상대 세션 파일을 포함하지 않는다. 다른 세션의 스테이징을 해제하지 않는다.
- Docker 기본 주소는 http://localhost:8080 이다. 웹 개발 서버는 /api 요청을 http://localhost:8080 으로 프록시한다.
- 서버는 web/dist를 정적으로 제공한다. 프론트 빌드는 web/에서 npm ci 및 npm run build로 수행한다. 루트 npm 스크립트는 서버 세션이 관리한다.
- 실제 AI 인증과 호스트 세션 자동 감지는 이번 실행 기반의 미구현 영역이다. 데모는 별도 공급자 demo로 표시하고 실제 모델 추론으로 표현하지 않는다.
- API 계약은 [api.md](api.md)를 기준으로 한다. 화면은 응답에 없는 기능을 추정하지 않는다.

## 웹 진행 메모

웹 담당 세션이 진행 상황과 필요한 계약 변경을 여기에 기록한다.

## 서버 진행 메모

- 진행 중: SQLite 영속 저장, 직원 등록, 데모 업무·질문·승인, 사무실 일시 중지, 인계 내보내기, Docker 구성.
- 확정 전: 실제 AI 공급자 연결, 인증 저장, 호스트 연결 프로그램.
