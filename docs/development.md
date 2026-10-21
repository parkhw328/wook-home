# 개발 및 검증

## 구조

- `server/`: Node.js HTTP API, 업무 상태 전환, SQLite 저장.
- `public/`: HTML/CSS/JS 사무실 GUI. `rooms.mjs`는 층·문·복도·엘리베이터 경로, `office-models.mjs`는 자체 제작 입체 건물·가구·캐릭터, `office-3d.mjs`는 카메라·동선·활동 애니메이션, `workspace.mjs`는 공간별 업무 패널, `conversation.mjs`는 터미널과 세션 전환이다.
- `public/vendor/three/`: 버전을 고정한 Three.js ES 모듈과 MIT 라이선스. 앱 실행 중 CDN 요청 없이 제공한다.
- `public/fonts/`: 자체 호스팅 폰트와 라이선스. 출처는 해당 폴더 README에 기록한다.
- `public/program-icons/`: wShell·wPost·wText의 실제 앱 아이콘과 라이선스. 원본 커밋·파일·SHA-256은 [자산 안내](../public/program-icons/README.md)에 기록한다.
- `public/readability.css`: 마지막에 적용하는 공통 글자 크기와 반응형 가독성 규칙. 새 화면도 이 파일의 `--font-*` rem 토큰과 requirements 4.3의 최소 크기를 사용한다.
- `extensions/browser-observer/`: 브라우저의 지원 AI 탭 감지 확장. 설치 절차는 Wiki Detection 참조.
- `scripts/`: 호스트 Codex 관찰·CLI 설치/프로세스 점검·대화 수집과 명시적으로 활성화하는 공식 큐 전달. Docker 이미지에 포함하지 않는다.
- `tests/server/`, `tests/ui/`, `tests/extension/`: Node.js 기본 테스트 러너를 사용하는 API·화면 로직·브라우저 확장 자동 검증. 파일 이름은 `*.test.js` 또는 `*.test.mjs`다.
- `docs/`: API 계약, 협업 현황, 사용자 Wiki, 릴리스 관리.
- `data/`: 로컬 개발 실행 데이터. Git 제외 대상.

## 로컬 실행

Node.js 24.14 이상, 27 미만을 사용한다. Docker 기본 이미지는 Node.js 24.14.0이며 로컬 Node.js 26.10에서도 검증한다. 서버는 Node 기본 모듈을 사용하고 입체 화면은 Three.js 0.186.1을 사용한다. Three.js 원본 재복사를 위한 개발 의존성과 무결성은 package-lock.json에 고정한다.

```powershell
npm ci
npm start
npm test
```

정적 브라우저 자산은 저장소에 포함되어 별도 앱 빌드 없이 실행한다. Three.js 배포 파일을 재현하거나 버전을 갱신할 때는 `npm ci` 후 `npm run vendor:three`로 두 ES 모듈과 라이선스를 복사하고 테스트·시각 검증을 수행한다. Docker 빌드는 서버와 이 정적 자산을 복사하며 npm 다운로드를 수행하지 않는다.

Three.js는 유지보수 중인 [공식 프로젝트](https://github.com/mrdoob/three.js)이며 MIT 라이선스로 배포된다. [WebGLRenderer 공식 문서](https://threejs.org/docs/pages/WebGLRenderer.html)에 따라 WebGL 2를 사용한다. 미지원·컨텍스트 손실 시 방 목록과 업무 패널을 유지한다. 입체 장면은 30fps 상한, 장면 밖 탭의 렌더 중지, 제한된 픽셀 비율을 적용하고 보행 완료가 렌더 루프에 의존하지 않도록 한다.

`npm start`는 http://localhost:8080 에서 GUI와 API를 제공한다. `npm run dev`는 서버 변경 시 재시작한다. 서버 재시작 시 진행 업무가 일시 중지될 수 있다. HTML/CSS/JS는 저장 후 브라우저를 새로 고치면 반영된다.

환경 변수는 `HOST`(기본 127.0.0.1), `PORT`(기본 8080), `DATA_DIR`(기본 ./data), `OFFICE_NAME`(기본 StackQueue Office), `CODEX_BRIDGE_FILE`(기본 ./data/bridge/codex.json)이다. Docker Compose의 외부 포트는 `WOOK_PORT`로 지정한다. 로컬 서버와 컨테이너를 동시에 사용할 때는 포트를 구분한다. Node 직접 실행은 `.env`를 자동으로 읽지 않으므로 셸 환경 변수로 지정한다.

`npm run bridge:codex -- --workspace .`는 현재 프로젝트의 최근 Codex 세션을 관찰한다. `--allow-commands`를 붙이면 공식 `codex queue`로 기존 세션에 지시를 전달한다. `--include-conversations`를 추가하면 선택한 프로젝트의 제한된 공개 대화기록을 별도 로컬 파일과 API로 제공한다. 다른 프로젝트의 전체 기록이나 인증 파일을 컨테이너에 연결하지 않는다. [CLI 연결 안내](wiki/CLI.md)에 조건과 상태의 의미를 기록한다. 명령 폴더는 `CODEX_COMMANDS_DIR`(기본 ./data/bridge/commands)로 지정한다.

## Docker

Windows는 Docker Desktop의 Linux 컨테이너, Linux는 Docker Engine과 Compose를 사용한다. 호스트 감지는 컨테이너 밖에서 실행하며 [Linux 실행 안내](wiki/Linux.md)에 계정·권한·확장 설치 절차를 정리한다.

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose stop
```

컨테이너는 비루트 사용자로 실행하며 정적 파일과 서버 코드만 이미지에 복사한다. 데이터 볼륨·지시 폴더·임시 디렉터리만 쓰기를 허용한다. 호스트의 `data/bridge`는 `/app/bridge`에 읽기 전용으로, `data/bridge/commands`는 `/app/commands`에 읽기·쓰기로 마운트한다. 두 바인드 마운트의 `z` 옵션은 Linux SELinux의 공유 레이블을 지정한다. 지시 본문은 CLI 호출 전에 제거한다. Compose는 기본 127.0.0.1에 바인딩한다. `WOOK_BIND_ADDRESS=0.0.0.0`으로 네트워크 접속을 켤 때 `OFFICE_ALLOWED_HOSTS`에 사용할 서버 주소와 포트를 쉼표로 지정한다. 실제 IP 설정은 Git 제외 `.env`에 두고 예시는 `.env.example`을 따른다. 같은 출처 검사는 유지하며 외부 접속용 인증 기능은 없다.

Linux 프로세스 감지기는 `scripts/lib/linux-processes.mjs`다. `/proc/<pid>/status`의 유효 UID로 범위를 제한하고 `stat`의 시작 tick과 부팅 시각, `getconf CLK_TCK`로 실행 시각을 계산한다. NUL 구분 인수와 공식 npm 심볼릭 링크는 분류 중 메모리에서만 확인한다. 인수·경로·사용자 이름은 상태 파일/API에 넣지 않는다. 최대 32,768 PID·512 후보·64 CLI, 파일별 읽기 한도와 조회 시간 한도를 두며 불완전한 조회는 종료로 처리하지 않는다. 자동 검증은 `tests/server/linux-processes.test.js`와 기존 lifecycle·bridge·discovery 테스트에 포함한다.

근거: [Linux procfs](https://docs.kernel.org/filesystems/proc.html), [Compose bind 마운트](https://docs.docker.com/reference/compose-file/services/#volumes).

## 테스트와 완료 기준

`npm test`는 서버와 UI 테스트를 실행하고 `npm run test:server`는 서버 테스트만 실행한다. 서버 테스트는 임시 DB에서 업무 전환, 중복 실행 방지, 재시작 보존, 입력·origin 검증과 정적 파일 제공을 확인한다. Codex 관찰 테스트는 프로젝트 필터, 부분 기록, 민감 필드 제외, 오래된 활동과 연결 끊김을 검증한다. 대화 테스트는 역할 제외·마스킹·분량 제한·프로젝트/세션 격리와 인계 제외를 검증한다. UI 테스트는 모든 방 사이 문·복도 경로, 보고 상태 분류, HTML 비실행과 늦은 세션 응답 차단도 검증한다.

변경 범위에 맞는 자동 검증 후, Docker 빌드·health check와 브라우저의 실제 사용 흐름을 확인한다. 검사에 사용한 가상 직원과 실제 AI 연결을 구분하고 검증 결과를 커밋에 연결한다. [검증 기록](validation.md)과 [실내 배치 검증](office-layout-validation.md)을 참고한다.

## 문서와 협업

작업 전에 rules의 두 문서를 읽는다. [협업 현황](collaboration.md)의 파일 소유 범위와 [API 계약](api.md)을 따른다. 감지와 연결 진단의 상세 계약은 [감지 API](discovery-api.md), [연결 점검 API](connections-api.md)에 기록한다. JavaScript는 ES modules, 들여쓰기는 두 칸을 사용하며 `.editorconfig`를 적용한다. 별도 formatter/linter는 아직 도입하지 않았다.

Node SQLite와 Compose 참고: [Node.js SQLite](https://nodejs.org/download/release/v24.14.0/docs/api/sqlite.html), [Docker Compose 서비스](https://docs.docker.com/reference/compose-file/services/).

## 세션 자료 검색 개발

`server/session-search.js`는 업무 DB와 분리된 SQLite 검색 사본, `scripts/lib/session-search-history.mjs`는 선택 프로젝트의 공개 CLI 기록 수집, `public/session-search*.mjs`와 `public/cli-dialog.mjs`는 검색·즉시 대화 모달을 담당한다. 외부 의존성 추가 없이 Node 내장 SQLite를 사용한다. 확장 0.2.0은 개별 대화 동의 후에만 공개 메시지를 읽는다. [검색 계약](session-search-api.md)과 [사용 안내](wiki/Search.md)를 참조한다.

미리보기 사본 안의 중복 테스트를 피하려면 저장소 테스트 경로를 명시한다.

```powershell
node --test tests/server/*.test.js tests/ui/*.test.mjs tests/extension/*.test.mjs
```
