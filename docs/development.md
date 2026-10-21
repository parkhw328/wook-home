# 개발 및 검증

## 구조

- `server/`: Node.js HTTP API, 업무 상태 전환, SQLite 저장.
- `public/`: 빌드 단계 없는 HTML/CSS/JS 사무실 GUI.
- `public/fonts/`: 자체 호스팅 폰트와 라이선스. 출처는 해당 폴더 README에 기록한다.
- `scripts/`: 호스트에서 실행하는 읽기 전용 Codex 관찰 프로그램. Docker 이미지에 포함하지 않는다.
- `tests/server/`, `tests/ui/`: Node.js 기본 테스트 러너를 사용하는 자동 검증.
- `docs/`: API 계약, 협업 현황, 사용자 Wiki, 릴리스 관리.
- `data/`: 로컬 개발 실행 데이터. Git 제외 대상.

## 로컬 실행

Node.js 24.14 이상을 사용한다. Docker 기본 이미지는 Node.js 24.14.0이며 로컬 Node.js 26.10에서도 검증한다. 외부 npm 의존성은 없다.

```powershell
npm ci
npm start
npm test
```

`npm start`는 http://localhost:8080 에서 GUI와 API를 제공한다. `npm run dev`는 서버 변경 시 재시작한다. 서버 재시작 시 진행 업무가 일시 중지될 수 있다. HTML/CSS/JS는 저장 후 브라우저를 새로 고치면 반영된다.

환경 변수는 `HOST`(기본 127.0.0.1), `PORT`(기본 8080), `DATA_DIR`(기본 ./data), `OFFICE_NAME`(기본 StackQueue Office), `CODEX_BRIDGE_FILE`(기본 ./data/bridge/codex.json)이다. Docker Compose의 외부 포트는 `WOOK_PORT`로 지정한다. 로컬 서버와 컨테이너를 동시에 사용할 때는 포트를 구분한다. Node 직접 실행은 `.env`를 자동으로 읽지 않으므로 셸 환경 변수로 지정한다.

`npm run bridge:codex -- --workspace .`는 현재 프로젝트의 최근 Codex 세션을 관찰한다. 다른 프로젝트의 전체 기록이나 인증 파일을 컨테이너에 연결하지 않는다. [CLI 연결 안내](wiki/CLI.md)에 조건과 상태의 의미를 기록한다.

## Docker

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose stop
```

컨테이너는 비루트 사용자로 실행하며, 정적 파일과 서버 코드만 이미지에 복사한다. 파일시스템은 데이터 볼륨과 임시 디렉터리를 제외하고 읽기 전용이다. 호스트의 `data/bridge`는 `/app/bridge`에 읽기 전용으로 마운트하며 대화 본문을 포함하지 않는 상태만 전달한다. Compose 포트는 127.0.0.1에만 바인딩한다. 현재 외부 접속용 인증 기능은 없다.

## 테스트와 완료 기준

`npm test`는 서버와 UI 테스트를 실행하고 `npm run test:server`는 서버 테스트만 실행한다. 서버 테스트는 임시 DB에서 업무 전환, 중복 실행 방지, 재시작 보존, 입력·origin 검증과 정적 파일 제공을 확인한다. Codex 관찰 테스트는 프로젝트 필터, 부분 기록, 민감 필드 제외, 오래된 활동과 연결 끊김을 검증한다. UI 테스트는 웹 담당 세션이 관리한다.

변경 범위에 맞는 자동 검증 후, Docker 빌드·health check와 브라우저의 실제 사용 흐름을 확인한다. 검사에 사용한 가상 직원과 실제 AI 연결을 구분하고 검증 결과를 커밋에 연결한다. [초기 검증 기록](validation.md)을 참고한다.

## 문서와 협업

작업 전에 rules의 두 문서를 읽는다. [협업 현황](collaboration.md)의 파일 소유 범위와 [API 계약](api.md)을 따른다. JavaScript는 ES modules, 들여쓰기는 두 칸을 사용하며 `.editorconfig`를 적용한다. 별도 formatter/linter는 아직 도입하지 않았다.

Node SQLite와 Compose 참고: [Node.js SQLite](https://nodejs.org/download/release/v24.14.0/docs/api/sqlite.html), [Docker Compose 서비스](https://docs.docker.com/reference/compose-file/services/).
