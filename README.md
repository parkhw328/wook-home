# wook-home

**AI 직원들이 모이는 나만의 가상 회사.**

프로젝트마다 전용 층을 가진 입체 사무실에서 동료와 함께 일하세요. 업무와 협업을 나누고 공용 대표이사실에서 질문과 보고를 받습니다. 1층 대기실에서 다음 작업을 정리하고, 다과실에서 지난 작업 히스토리를 돌아볼 수 있습니다. Commander의 작업 공간, **StackQueue Office**를 로컬 브라우저에서 만날 수 있습니다.

현재는 **0.2.1 개발 버전**입니다. 기존 Codex의 활동과 최근 대화기록을 보고 선택한 세션에 실제 지시를 보낼 수 있습니다. 체험 직원으로 업무·질문·승인 흐름도 경험할 수 있습니다. 직원별 **담당 프로젝트와 기본 추론 설정**을 저장하고 목록에서 확인할 수 있습니다. 연결한 Codex 직원은 선택한 모델·강도로 다음 지시를 보냅니다. 새 AI 세션 채용과 다른 공급자의 실제 업무 실행은 준비 중입니다.

한글·영문 본문은 17px, 메뉴·입력창은 16px, 보조 정보는 최소 14px로 표시하며 작은 화면에서도 글자 크기를 유지합니다. 왼쪽 탐색 영역 맨 위 카드에서 현재 사용자·역할과 서버 연결 상태를 함께 확인하고, 그 아래 사무실 이름을 눌러 홈으로 이동합니다.

왼쪽 **화면 테마**에서 라이트·다크·기기 설정을 선택하면 모든 화면과 대화창에 적용되며, 선택은 현재 브라우저에 저장됩니다. 사무실도 라이트에서는 자연광이 드는 낮, 다크에서는 도시 불빛과 실내등이 켜진 밤으로 바뀝니다. 주요 실행은 진한 빨강, 보조 행동은 중립색 테두리, 일시중지·연결 해제는 황토색으로 구분합니다. [테마·버튼과 화면 사용법](https://github.com/parkhw328/wook-home/wiki/UI)을 참고하세요.

직원 상세에서 **직원 등록 해제**를 할 수 있습니다. 기존 업무·보관 메모는 해제 기록에 남으며 다시 등록할 수 있습니다.

방 안의 **직원 수·업무 건수**를 누르면 해당 목록이 열리고, 직원 정보나 업무보고로 이어집니다. 화면 사용법과 앱 버전은 왼쪽 탐색 영역 하단에 표시합니다.

**다과실**에서는 저장된 업무·CLI 공개 대화·사무실 활동을 검색하고, 프로젝트별로 모아 볼 수 있습니다. 연결이 꺼져도 이미 보관한 기록은 유지됩니다.

CLI 세션을 누르면 대화기록이 바로 열립니다. 위쪽 닫기·Escape로 닫고, 읽던 위치와 지시 초안을 이어갈 수 있습니다. **자료 검색**에서는 연결한 프로젝트의 CLI 기록과 보관을 켠 웹 대화를 찾고, 종료하거나 닫은 뒤에도 저장된 자료를 다시 읽을 수 있습니다. 확장 연결이 없는 원격 HTTP 화면에서도 공개 텍스트를 직접 보관할 수 있습니다. [검색 보관 연결 방법](https://github.com/parkhw328/wook-home/wiki/Search).

중단된 연결과 생존 확인이 필요한 직원은 **1층 대기실**에서 확인하세요. CLI 대화나 직원 상세의 **업무 보관**에서 남은 일과 다음 행동을 저장하고, 나중에 복귀·재연결할 수 있습니다. 대기실 표시는 실제 CLI 종료 판정이나 자동 업무 보관이 아니며, 보관 메모는 로컬에 유지합니다. 실제 CLI 재개와 지시 재전송은 자동으로 하지 않습니다. [대기실 사용법](https://github.com/parkhw328/wook-home/wiki/Staff#대기실와-중단-업무).

맵 하단에서 **최상층 대표이사실 → 프로젝트별 사무실·회의실 → 1층 휴게실·대기실·다과실** 순서로 방을 선택하거나 **전체 건물**을 펼칩니다. 방 버튼은 층 번호·아이콘으로 표시하며 마우스 올림·키보드 초점·터치로 전체 이름을 확인합니다. 움직임은 맵 상단에서 조절합니다. 하단 탐색과 위치·동선 안내는 작은 화면에서도 가로 스크롤로 사용할 수 있습니다. 오른쪽은 방 설명과 업무 목록에 집중합니다.

## 빠른 시작

현재 프로젝트에서 살아 있는 Codex 세션은 **직원 · 연결 관리**에 자동 등록됩니다. 카드에 마우스를 올려 전체 **session-id**를 확인하고 **별칭 · 직원 설정**에서 이름을 붙이세요. **미등록 세션 · 등록 대기**와 감지 목록의 나머지 CLI·웹 탭은 직접 등록하거나 기존 직원에 연결하세요. 웹은 탭 상태를 관찰하며 메시지는 원래 서비스에서 작성합니다. [직원 연결 안내](https://github.com/parkhw328/wook-home/wiki/Staff).

Windows는 Docker Desktop의 Linux 컨테이너 환경, Linux는 Docker Engine과 Compose를 준비한 후 저장소 루트에서 실행하세요.

```powershell
docker compose up --build -d
```

브라우저에서 **http://localhost:8080**을 열고 `admin`으로 로그인하세요. 초기 비밀번호는 서버 로컬 파일에서 확인하고 첫 로그인에서 변경합니다. [로그인 안내](docs/wiki/Login.md)를 따라 입장한 뒤 `체험 직원`을 등록하세요. 사무실 입장 → 업무 지시 → 대표이사실 질문·답변 → 보고·승인을 경험할 수 있습니다. AI 계정이나 API 키는 필요하지 않습니다. 지원되는 Codex의 협업·질문 이벤트는 [회의와 발표 동작](https://github.com/parkhw328/wook-home/wiki/Activity)으로 연결됩니다.

사무실 이름은 `.env`의 `OFFICE_NAME=StackQueue Office`로 바꿀 수 있습니다. `.env.example`을 참고하고 변경 후 `docker compose up -d`로 적용하세요.

다른 PC에서 확인하려면 `.env`에 바인딩 주소와 접속할 서버 주소를 지정하세요. [네트워크 접속 설정](https://github.com/parkhw328/wook-home/wiki/Linux#다른-pc에서-접속).

**CLI·웹 감지는 Windows와 Linux에서 사용할 수 있습니다.** 호스트의 별도 터미널에서 `npm run bridge:codex -- --workspace .`를 실행하면 지원 CLI의 추가·종료를 확인합니다. Linux에서는 같은 사용자 계정의 프로세스를 감지합니다. 웹 탭은 Chrome/Chromium에 [감지 확장프로그램](https://github.com/parkhw328/wook-home/wiki/Detection)을 설치하고 화면에서 **웹 탭 감지 켜기**를 누르세요. [Linux 실행과 권한 안내](https://github.com/parkhw328/wook-home/wiki/Linux).

직원 상세의 **모델 설정과 작업 지시**에서 Codex가 지원하는 모델·강도를 선택하세요. 프로세스만 연결했다면 **지시할 Codex 대화 연결**로 대상을 먼저 선택합니다. [모델·작업 지시 안내](https://github.com/parkhw328/wook-home/wiki/Models).

왼쪽 **연결 설정**에서 **공개 대화 읽기·CLI 검색 보관·Codex 지시 전송**을 선택하고 저장하세요. 적용 상태와 최초 실행 명령을 화면에서 확인할 수 있으며, 이후 설정 변경에는 연결기 재시작이 필요 없습니다.

이미 실행 중인 Codex에 지시하려면 호스트에 Node.js 24.14 이상(27 미만)과 `codex queue`를 지원하는 CLI를 준비하고 별도 터미널에서 실행하세요. [Wiki의 연결·명령 안내](https://github.com/parkhw328/wook-home/wiki/CLI)를 확인할 수 있습니다.

```powershell
npm ci
npm run bridge:codex -- --workspace .
```

```powershell
docker compose stop    # 체험 상태를 저장하고 중지 (외부 Codex는 별도 종료)
docker compose up -d   # 다시 실행한 뒤 화면에서 업무 재개
```

직원과 업무는 Docker 볼륨에 보관됩니다. PC 간 데이터는 자동 공유되지 않으며, 인계 JSON 내보내기는 검토용입니다. 가져오기와 다중 사용자·클라우드 운영은 아직 지원하지 않습니다.

## 문서

- [CLI·웹 감지 안내](https://github.com/parkhw328/wook-home/wiki/Detection) · [전체 연결 점검](https://github.com/parkhw328/wook-home/wiki/Connections)
- [사용설명서 Wiki](https://github.com/parkhw328/wook-home/wiki)
- [기존 Codex 연결](https://github.com/parkhw328/wook-home/wiki/CLI) · [StackQueue Blog](https://blog.naver.com/stack-queue)
- [공급자 서비스 접속·연결 준비](https://github.com/parkhw328/wook-home/wiki/Providers)
- [변경 이력](CHANGELOG.md) · [버전·릴리스 관리](docs/releases.md)
- [요구사항](rules/requirements.md) · [프로젝트 규칙](rules/rules.md)
- [개발·테스트 안내](docs/development.md) · [API 계약](docs/api.md)

첫 실행은 `admin`으로 로그인하고 초기 비밀번호를 변경하세요. 초기 비밀번호 위치와 업데이트 방법은 [로그인 안내](docs/wiki/Login.md)를 참고하세요.
