# 개발 및 검증

## 구조

- `server/`: Node.js HTTP API, 업무 상태 전환, SQLite 저장.
- `public/`: HTML/CSS/JS 사무실 GUI. `rooms.mjs`는 층·문·복도·엘리베이터 경로, `office-models.mjs`는 자체 제작 입체 건물·가구·캐릭터, `office-3d.mjs`는 카메라·동선·활동 애니메이션, `workspace.mjs`는 공간별 업무 패널, `conversation.mjs`는 터미널과 세션 전환이다.
- `public/vendor/three/`: 버전을 고정한 Three.js ES 모듈과 MIT 라이선스. 앱 실행 중 CDN 요청 없이 제공한다.
- `public/fonts/`: 자체 호스팅 폰트와 라이선스. 출처는 해당 폴더 README에 기록한다.
- `public/program-icons/`: wShell·wPost·wText의 실제 앱 아이콘과 라이선스. 원본 커밋·파일·SHA-256은 [자산 안내](../public/program-icons/README.md)에 기록한다.
- `public/readability.css`: 마지막에 적용하는 공통 글자 크기와 반응형 가독성 규칙. 새 화면도 이 파일의 `--font-*` rem 토큰과 requirements 4.3의 최소 크기를 사용한다.
- `public/themes.css`: 모든 화면의 의미별 색상 토큰과 라이트·다크 팔레트. 배경·글자·입력·상태·강조·버튼에 공통 토큰을 사용하고 화면별 고정 색상이나 별도 테마 범위를 추가하지 않는다. `theme.js`는 첫 표시 전에 저장된 선택을 적용하며 `data-theme`로 현재 색상, `data-theme-preference`로 사용자 선택을 구분한다. `wook-home.theme`만 브라우저 로컬 저장소에 보관하고 업무 데이터와 분리한다.
- `extensions/browser-observer/`: 브라우저의 지원 AI 탭 감지 확장. 설치 절차는 Wiki Detection 참조.
- `scripts/`: 호스트 Codex 관찰·CLI 설치/프로세스 점검·대화 수집과 명시적으로 활성화하는 공식 큐 전달. Docker 이미지에 포함하지 않는다.
- `tests/server/`, `tests/ui/`, `tests/extension/`: Node.js 기본 테스트 러너를 사용하는 API·화면 로직·브라우저 확장 자동 검증. 파일 이름은 `*.test.js` 또는 `*.test.mjs`다.
- `docs/`: API 계약, 협업 현황, 사용자 Wiki, 릴리스 관리.
- `data/`: 로컬 개발 실행 데이터. Git 제외 대상.

## 로컬 실행

Node.js 24.14 이상, 27 미만을 사용한다. Docker 기본 이미지는 Node.js 24.14.0이며 로컬 Node.js 26.10에서도 검증한다. 서버는 Node 기본 모듈을 사용하고 입체 화면은 Three.js 0.186.1을 사용한다. 호스트 연결기의 공식 WebSocket 통신에는 `ws` 8.22.0(MIT)을 사용한다. Three.js 원본 재복사 및 호스트용 의존성과 무결성은 package-lock.json에 고정하며 호스트에서 `npm ci`가 필요하다. Docker 서버는 Node 기본 모듈만 사용한다.

```powershell
npm ci
npm start
npm test
```

정적 브라우저 자산은 저장소에 포함되어 별도 앱 빌드 없이 실행한다. Three.js 배포 파일을 재현하거나 버전을 갱신할 때는 `npm ci` 후 `npm run vendor:three`로 두 ES 모듈과 라이선스를 복사하고 테스트·시각 검증을 수행한다. Docker 빌드는 서버와 이 정적 자산을 복사하며 npm 다운로드를 수행하지 않는다.

Three.js는 유지보수 중인 [공식 프로젝트](https://github.com/mrdoob/three.js)이며 MIT 라이선스로 배포된다. [WebGLRenderer 공식 문서](https://threejs.org/docs/pages/WebGLRenderer.html)에 따라 WebGL 2를 사용한다. 미지원·컨텍스트 손실 시 방 목록과 업무 패널을 유지한다. 입체 장면은 30fps 상한, 장면 밖 탭의 렌더 중지, 제한된 픽셀 비율을 적용하고 보행 완료가 렌더 루프에 의존하지 않도록 한다.

`npm start`는 http://localhost:8080 에서 GUI와 API를 제공한다. `npm run dev`는 서버 변경 시 재시작한다. 서버 재시작 시 진행 업무가 일시 중지될 수 있다. HTML/CSS/JS는 저장 후 브라우저를 새로 고치면 반영된다.

환경 변수는 `HOST`(기본 127.0.0.1), `PORT`(기본 8080), `DATA_DIR`(기본 ./data), `OFFICE_NAME`(기본 StackQueue Office), `CODEX_BRIDGE_FILE`(기본 ./data/bridge/codex.json)이다. Docker Compose의 외부 포트는 `WOOK_PORT`로 지정한다. 로컬 서버와 컨테이너를 동시에 사용할 때는 포트를 구분한다. Node 직접 실행은 `.env`를 자동으로 읽지 않으므로 셸 환경 변수로 지정한다.

`npm run bridge:codex -- --workspace .`로 호스트 연결기를 실행하고 화면의 **연결 설정**에서 대화 읽기·CLI 검색 보관·지시 전송을 선택한다. `server/bridge-settings.js`는 제한된 로컬 설정의 읽기·저장·적용 확인, `public/bridge-settings.mjs`는 설정 탭과 최초 실행 안내를 담당한다. 설정 파일은 `CODEX_COMMANDS_DIR/bridge-settings.json`이며 호스트의 출력 폴더 `commands`와 같은 디렉터리를 공유해야 한다. 기존 CLI 기능 옵션은 저장된 화면 설정이 없을 때만 초기값으로 사용한다. [CLI 연결 안내](wiki/CLI.md)를 참조한다.

설정 테스트는 `node --test tests/server/bridge-settings.test.js tests/ui/bridge-settings.test.mjs`로 실행한다. 실제 임시 호스트 프로세스에서 기본 꺼짐·실행 중 켜기/끄기·재시작·검색 사본 유지·읽기 사본 제거를 검증하고 API 충돌·실패·출처 검사와 지시 차단을 확인한다.
브라우저·Docker 확인 범위는 [연결 설정 검증](connection-settings-validation.md)에 기록한다.

## Docker

Windows는 Docker Desktop의 Linux 컨테이너, Linux는 Docker Engine과 Compose를 사용한다. 호스트 감지는 컨테이너 밖에서 실행하며 [Linux 실행 안내](wiki/Linux.md)에 계정·권한·확장 설치 절차를 정리한다.

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose stop
```

컨테이너는 비루트 사용자로 실행하며 정적 파일과 서버 코드만 이미지에 복사한다. 데이터 볼륨·지시 폴더·임시 디렉터리만 쓰기를 허용한다. 호스트의 `data/bridge`는 `/app/bridge`에 읽기 전용으로, `data/bridge/commands`는 `/app/commands`에 읽기·쓰기로 마운트한다. 두 바인드 마운트의 `z` 옵션은 Linux SELinux의 공유 레이블을 지정한다. 지시 본문은 CLI 호출 전에 제거한다. Compose는 기본 127.0.0.1에 바인딩한다. `WOOK_BIND_ADDRESS=0.0.0.0`으로 네트워크 접속을 켤 때 `OFFICE_ALLOWED_HOSTS`에 사용할 서버 주소와 포트를 쉼표로 지정한다. 실제 IP 설정은 Git 제외 `.env`에 두고 예시는 `.env.example`을 따른다. 같은 출처 검사와 admin 로그인을 함께 적용한다.

Linux 프로세스 감지기는 `scripts/lib/linux-processes.mjs`다. `/proc/<pid>/status`의 유효 UID로 범위를 제한하고 `stat`의 시작 tick과 부팅 시각, `getconf CLK_TCK`로 실행 시각을 계산한다. NUL 구분 인수와 공식 npm 심볼릭 링크는 분류 중 메모리에서만 확인한다. 인수·경로·사용자 이름은 상태 파일/API에 넣지 않는다. 최대 32,768 PID·512 후보·64 CLI, 파일별 읽기 한도와 조회 시간 한도를 두며 불완전한 조회는 종료로 처리하지 않는다. 자동 검증은 `tests/server/linux-processes.test.js`와 기존 lifecycle·bridge·discovery 테스트에 포함한다.

근거: [Linux procfs](https://docs.kernel.org/filesystems/proc.html), [Compose bind 마운트](https://docs.docker.com/reference/compose-file/services/#volumes).

## 테스트와 완료 기준

`npm test`는 서버·UI·확장 테스트를 실행하고 `npm run test:server`는 서버 테스트만 실행한다. 서버 테스트는 임시 DB에서 업무 전환, 중복 실행 방지, 재시작 보존, 입력·origin 검증과 정적 파일 제공을 확인한다. Codex 관찰 테스트는 프로젝트 필터, 부분 기록, 민감 필드 제외, 오래된 활동과 연결 끊김을 검증한다. 대화 테스트는 역할 제외·마스킹·분량 제한·프로젝트/세션 격리와 인계 제외를 검증한다. UI 테스트는 모든 방 사이 문·복도 경로, 보고 상태 분류, HTML 비실행과 늦은 세션 응답 차단도 검증한다. `public/model.mjs`의 `officeStatItems`는 현황 카드와 상세 목록에 같은 집계 기준을 제공하며 `tests/ui/model.test.mjs`에서 상태 전환·완료 제외 조건·정렬과 원본 보존을 확인한다. 현황 목록·탐색 레이아웃의 브라우저 검증은 [현황 상세 검증](room-details-validation.md)에 기록한다.

변경 범위에 맞는 자동 검증 후, Docker 빌드·health check와 브라우저의 실제 사용 흐름을 확인한다. 검사에 사용한 가상 직원과 실제 AI 연결을 구분하고 검증 결과를 커밋에 연결한다. [검증 기록](validation.md)과 [실내 배치 검증](office-layout-validation.md)을 참고한다.

테마 동작은 `node --test tests/ui/theme.test.mjs tests/ui/office-scene.test.mjs`로 저장·복원, 기기 설정, 탭 동기화, 저장소 차단과 장면 상태 보존을 확인한다. 화면 변경 시 두 테마에서 실제 브라우저의 최종 계산 색상·글꼴과 320·390·768·1366·1920px 배치, 대화상자·전체화면·확대 상태도 점검한다.

## 활성 프로젝트 층 검증

`activeOfficeProjects`는 저장된 프로젝트 목록에서 활성 등록 직원이 있는 프로젝트만 표시 대상으로 고른다. `configureProjectFloors`는 이 목록을 공용 층 사이에 연속 배치한다. 프로젝트·직원·업무 DB를 삭제하거나 저장된 프로젝트 식별자를 변경하지 않는다.

```bash
node --test tests/ui/project-floors.test.mjs tests/ui/project-floor-refresh.test.mjs
node tests/browser/project-floors-preview.mjs
# 별도 터미널. Python Playwright와 Chromium이 설치된 검증 환경에서 실행합니다.
python3 tests/browser/project-floors.py
```

미리보기는 127.0.0.1:18089의 임시 메모리 사무실이며 실제 DB·호스트 연결기를 읽지 않는다. `FLOOR_TEST_PORT`로 포트를 바꿀 수 있다. 브라우저 테스트는 합성 API 응답의 세션 연결을 바꾸며 화면의 자동 갱신을 검증한다. 기존 로그인·보관 기록 흐름은 `office-update-preview.mjs`와 `office-update.py`로 확인한다. 범위와 결과는 [프로젝트 층 검증](project-floor-lifecycle-validation.md)을 참고한다.

## 문서와 협업

작업 전에 rules의 두 문서를 읽는다. [협업 현황](collaboration.md)의 파일 소유 범위와 [API 계약](api.md)을 따른다. 감지와 연결 진단의 상세 계약은 [감지 API](discovery-api.md), [연결 점검 API](connections-api.md)에 기록한다. JavaScript는 ES modules, 들여쓰기는 두 칸을 사용하며 `.editorconfig`를 적용한다. 별도 formatter/linter는 아직 도입하지 않았다.

Node SQLite와 Compose 참고: [Node.js SQLite](https://nodejs.org/download/release/v24.14.0/docs/api/sqlite.html), [Docker Compose 서비스](https://docs.docker.com/reference/compose-file/services/).

## 데이터 저장과 인계

| 데이터 | 기본 로컬 경로 | Docker 위치·보존 범위 |
| --- | --- | --- |
| 직원·체험 업무·해제 기록·보관 메모 | `data/office.sqlite` | `office-data` 볼륨의 `/app/data/office.sqlite` |
| 검색을 켠 CLI·웹의 공개 메시지 사본 | `data/session-search.sqlite` | 같은 볼륨의 `/app/data/session-search.sqlite`. 업무 DB·인계와 분리 |
| 호스트 관찰 상태·최근 공개 대화 | `data/bridge/codex.json`, `data/bridge/conversations/` | `/app/bridge` 읽기 전용 마운트. 최근 관찰용이며 업무 인계에서 제외 |
| CLI 검색 수집 사본 | `data/bridge/search-history/` | `/app/bridge/search-history/`에서 읽어 검색 DB에 반영 |
| 연결 설정·지시 접수 기록 | `data/bridge/commands/` | `/app/commands` 읽기·쓰기 마운트. `bridge-settings.json`과 지시별 JSON |
| 원문 직원 연결 매핑·웹 탭 감지 | 서버 메모리 | 재시작하면 재연결 필요. DB·인계에 관찰 식별자를 저장하지 않음 |

`DATA_DIR`, `CODEX_BRIDGE_FILE`, `CODEX_COMMANDS_DIR`로 직접 실행 경로를 바꿀 수 있다. SQLite는 WAL 모드로 쓰며 `office_state.payload`에 `schemaVersion: 1`인 업무 상태 JSON을 저장한다. 상태 변경은 저장 성공 후 메모리에 반영한다. 검색 DB는 별도 파일이며 수집을 꺼도 기존 검색 사본을 유지한다.

`GET /api/handoff`는 검토용 JSON을 내려준다. 현재 직원과 보고 담당자 확인에 필요한 해제 직원·업무·사용자 입력은 포함하고, 보관 메모·관찰 연결·CLI/웹 공개 대화 사본·설정·지시 접수 기록은 제외한다. 필드는 [API 계약](api.md)을 따른다. 다운로드는 DB 백업이나 가져오기 기능이 아니며 PC 간 볼륨 복제·GitHub 전송을 수행하지 않는다. 사용자 입력은 공개 전 검토해야 한다.

정상 종료와 재시작 시 미완료 체험 업무를 일시 중지하는 복구만 제공한다. DB 백업·손상 복원·자동 데이터 이전은 후속 범위다. 이 절의 로컬 데이터는 Git·Docker 이미지·공개 Wiki에 복제하지 않는다.

## 세션 자료 검색 개발

`server/session-search.js`는 업무 DB와 분리된 SQLite 검색 사본, `scripts/lib/session-search-history.mjs`는 선택 프로젝트의 공개 CLI 기록 수집, `public/session-search*.mjs`와 `public/cli-dialog.mjs`는 검색·즉시 대화 모달을 담당한다. 외부 의존성 추가 없이 Node 내장 SQLite를 사용한다. 확장 0.2.0은 개별 대화 동의 후에만 공개 메시지를 읽는다. [검색 계약](session-search-api.md)과 [사용 안내](wiki/Search.md)를 참조한다.

미리보기 사본 안의 중복 테스트를 피하려면 저장소 테스트 경로를 명시한다.

```powershell
node --test tests/server/*.test.js tests/ui/*.test.mjs tests/extension/*.test.mjs
```

## Codex 모델·강도와 지시

`server/execution-options.js`는 공개 모델 목록을 제한·검증하고, `scripts/lib/codex-control.mjs`는 공식 proxy 또는 호스트에 지정한 원격 엔드포인트에 연결한다. 모델 선택 시 설정 변경 확인 후 큐에 넣는다. `codex queue -m/-c`는 0.163.0에서 큐 요청에 모델 설정을 포함하지 않으므로 이 용도로 사용하지 않는다. 승인·샌드박스·작업 폴더·협업 모드를 덮어쓰지 않는다.

검증 명령: `node --test tests/server/execution.test.js tests/server/commands.test.js tests/ui/execution.test.mjs`. [모델 API 계약과 검증 범위](execution-controls.md), [사용 안내](wiki/Models.md).

## 상세창·HTTP 보관 브라우저 회귀 검증

공통 닫기·초점 복귀는 `public/dialog-layer.mjs`, 고정 헤더와 스크롤은 `public/dialog-layer.css`에서 관리합니다. 새 상세창은 이 관리자를 사용하고 비동기 읽기를 닫기 시 정리합니다. HTTP에서도 사용할 식별자는 `browser-id.mjs`, 직접 보관의 본문 해시는 서버가 담당합니다.

`npm test`는 유지관리하는 server/ui/extension 세 테스트 경로만 실행하고 로컬 참고·백업 사본을 탐색하지 않습니다. 레이어 전환·늦은 응답·UUID 대체 경로·명시적 보관의 입력 검증·마스킹·중복 방지를 포함합니다. 실제 화면 회귀는 Python 3과 Playwright/Chromium이 설치된 별도 검증 환경에서 실행합니다. 준비가 필요하면 가상 환경에 `python -m pip install playwright`와 `python -m playwright install chromium`을 실행합니다.

```bash
# 첫 터미널: 메모리 DB·합성 대화만 사용하는 격리 서버
node tests/browser/layer-preview.mjs
# 다른 터미널
python tests/browser/layers.py
# CLI 모달 전용 진입·읽기·업무 초안·전체화면 회귀
python tests/browser/cli-modal.py
# 늦은 업무 답변 뒤 CLI 열람 화면의 이동·초점 보존
python tests/browser/cli-late-navigation.py
```

포트 기본값은 18084이며 양쪽 명령에 `LAYER_TEST_PORT`로 바꿀 수 있습니다. 검증 서버는 실제 사용자 데이터·연결기·AI를 사용하지 않습니다. HTTP 검증의 `office.test`는 Chromium 내부에서만 loopback으로 연결합니다. 실서버에 이 테스트를 실행하지 않습니다. 두 테마·320/390/768/1366/1920px·실제 200% 브라우저 확대, 닫기·초점·초안·전체화면, 저장 도중 닫기와 HTTP 보관을 검사하고 `artifacts/layer-audit/`에 로컬 결과를 남깁니다. 검증 서버는 Ctrl+C로 종료합니다. [검증 범위](layer-audit-validation.md).

CLI 전용 검증은 같은 합성 서버에서 실행하며 결과와 화면을 `artifacts/cli-modal/`에 저장합니다. 방 진입 시 불필요한 대화 조회가 없는지, 닫은 뒤 조회 중단, 검색창 Esc 닫기, 현재 방·필터·읽던 위치·업무 답변 유지도 확인합니다.

## 업무 대기실 검증

합성 서버 `node tests/browser/layer-preview.mjs`를 실행한 뒤 `python tests/browser/work-archive.py`로 보관·메모·복귀·재연결과 보고 답변·승인·취소를 검증합니다. 실제 업무 데이터나 AI에는 실행하지 않습니다. 결과 화면은 Git 제외 `artifacts/work-archive/`에 남습니다. `tests/server/work-archive.test.js`와 `tests/server/commands.test.js`는 재시작·메모 보존·인계 제외·충돌·중복 접수와 보관 중 새 지시 차단을 검사합니다.

## 층 안내와 직원 등록 해제 검증

`LAYER_TEST_PORT=18086 node tests/browser/layer-preview.mjs`로 합성 서버를 실행한 뒤 `python tests/browser/directory-release.py`와 `python tests/browser/staff-release-flows.py`를 실행합니다. 두 테마·5개 화면 폭·실제 200% 확대에서 목록 높이·스크롤·글꼴, 직원 해제·메모 보존·재등록과 진행 업무 보호·기존 보고 담당자 표시·전체화면을 검사합니다. 실제 업무 서버에는 실행하지 않습니다.

같은 합성 서버의 `python tests/browser/staff-connection-refresh.py`는 연결 목록 새로고침·조회 실패 후 대상과 초안 보존, 실제 409 충돌과 명시적 재시도, 해제 버전 전송, 서버 연결 실패·복구 전후 지시 초안을 검증합니다. 실행 결과와 후속 범위는 [서비스 재점검](service-review-2026-10-26.md)에 기록합니다.

## 세션 직원 등록 검증

현재 적재 세션은 공식 `thread/loaded/list`와 본문 없는 `thread/read`로 확인한다. 정확한 작업 폴더가 일치하는 메타데이터와 기존 기록만 상태 파일로 내보내며, 작업 폴더·미리보기·다른 프로젝트 ID는 버린다. 지시 권한과 독립된 읽기 전용 관찰이며 신규 실행·재개·구독을 요청하지 않는다. 메타데이터는 최대 128개 후보·8개 동시 읽기·4.5초 탐색 예산, 출력은 기존처럼 최대 24개다. 저장 기록 탐색의 7일/최근 24시간 제한과 달리 현재 적재 세션은 로그 파일 없이도 표시한다.

직원 레지스트리는 `office.sqlite`의 로컬 상태에 공급자·세션 ID의 SHA-256 키만 저장한다. 별칭 복원·해제 선택을 유지하며 원문 ID와 레지스트리 모두 인계에서 제외한다. 이전 버전의 세션 직원은 먼저 현재 대상에 명시적으로 연결한다.

```bash
node tests/browser/session-registration-preview.mjs
# 다른 터미널에서, 합성 서버에만 실행
python tests/browser/session-registration.py
python tests/browser/session-identity.py
```

자동 테스트는 `npm test`에 포함된다. 브라우저 검증은 같은 앞·뒤 글자의 세 세션, 자동 등록·별칭·수동 등록·해제·초안, 기본 ID 숨김과 마우스 올림·키보드 초점·터치 확인, 두 테마·5개 화면 폭·실제 200% 확대를 검사하며 결과는 Git 제외 `artifacts/session-registration/`에 저장한다. [검증 범위](session-registration-validation.md).

ID 전용 브라우저 검증은 터치와 자동 갱신, 전체화면·감지·현황·검색에서 전체 ID 확인과 닫기를 검사한다. 검색 응답은 합성 자료로 대체하며 실제 보관함이나 사용자 자료에 접근하지 않는다.

## 관리자 인증 (0.2.0)

실행 진입점은 `server/auth.js`의 인증 저장소를 생성해 HTTP 서버에 주입합니다. `DATA_DIR/admin-auth.json`에는 scrypt(N=32768, r=8, p=1)의 솔트와 해시만 저장하고 초기 비밀번호 파일은 최초 변경 시 제거합니다. 두 파일은 0600 권한이며 Git·이미지에서 제외됩니다. HttpOnly·SameSite=Strict 쿠키, 8시간 세션과 동일 출처 검사를 사용합니다. 메모리 세션은 재시작·로그아웃·비밀번호 변경으로 폐기합니다. HTTP 서버 팩토리의 인증 미주입은 기존 격리 테스트 전용이며 운영 진입점에는 해제 옵션이 없습니다.

`node --test tests/server/auth.test.js`는 초기 발급·API 차단·최초 변경 강제·만료·재시작·로그아웃·이전 세션 폐기·반복 실패 제한을 검증합니다. [로그인 사용 안내](wiki/Login.md).

## 0.2.0 통합 검증

로그인·프로젝트 층·대기실·히스토리는 [검증 기록](office-update-validation.md)의 합성 서버와 브라우저 절차로 확인합니다. `node tests/browser/office-update-preview.mjs` 실행 후 `python tests/browser/office-update.py`로 두 테마·5개 화면 폭·실제 200% 확대를 검사합니다.

## 화면 밀도·계정 변경 검증

지시 모달의 크기·입력·연결 정보 배치와 초안 유지 확인은 [지시 모달 검증 기록](command-dialog-validation.md)을 참고하세요. 아래 합성 서버를 함께 사용합니다.

합성 데이터만 사용하는 브라우저 검증 서버를 별도 터미널에서 실행합니다. Python Playwright와 Chromium이 필요합니다. 포트는 운영 서버와 분리하며 실제 계정·DB·CLI를 사용하지 않습니다.

```bash
node tests/browser/density-preview.mjs
```

다른 터미널에서 다음을 실행합니다. 기본 18089 포트를 바꿀 때는 두 명령에 같은 `DENSITY_TEST_PORT`를 지정합니다.

```bash
python3 tests/browser/density.py
```

두 테마·320/390/768/1366/1920px·Chromium 200% 확대에서 화면·상세창과 가독성을 확인합니다. 방 이름 툴팁, 계정 메뉴의 키보드·터치·닫기·초점 복귀·갱신 중 유지, 블로그 이름 한 줄과 도움말·버전의 새 탭 링크, 비밀번호 7/8자 경계·변경·다른 로그인 해제·늦은 저장 응답도 검증합니다. 외부 링크는 요청을 가로채 목적지만 확인하고 실제 외부 본문은 수집하지 않습니다. 결과와 합성 화면은 Git에서 제외한 `artifacts/density/`에 생성합니다. 전체 단위·통합 검증은 `npm test`입니다.
