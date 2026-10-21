# Linux에서 사무실과 감지 실행

Linux에서는 Docker Engine과 Compose로 사무실을 실행하고, 호스트의 Node.js 연결 프로그램으로 CLI를 감지합니다. Docker Desktop은 필요하지 않습니다. 웹 감지는 Chrome/Chromium에 설치한 확장프로그램을 사용합니다.

## 준비와 실행

Docker Engine·Compose와 Node.js 24.14 이상(27 미만)을 준비합니다. `docker info`, `docker compose version`, `node --version`으로 확인하세요. CLI를 사용하는 계정으로 저장소 루트에서 실행합니다.

```sh
mkdir -p data/bridge
npm run bridge:codex -- --workspace .
```

연결 프로그램 터미널을 유지하고 다른 터미널에서 실행합니다.

```sh
docker compose up --build -d
docker compose ps
```

컨테이너가 `healthy`이면 **http://localhost:8080**을 엽니다. **직원 · 연결 관리 → 연결 관리 → 감지**에서 `Linux 같은 사용자`와 CLI 실행 수를 확인하세요. 기본 연결은 메타데이터 관찰이며 AI 로그인·메시지 전송·대화 본문 수집을 켜지 않습니다.

## CLI 감지 범위

- 연결 프로그램과 같은 유효 UID의 Codex·Claude Code·Gemini CLI를 약 5초마다 확인합니다. 같은 사용자의 다른 터미널·SSH 세션도 포함하며 다른 사용자나 Windows 프로세스는 포함하지 않습니다.
- Linux `/proc`와 `/usr/bin/getconf CLK_TCK`를 사용합니다. PID와 커널 시작 시각으로 실행을 구분하며 첫 대화 전의 CLI도 표시합니다. Codex의 npm 부모와 네이티브 자식을 중복 집계하지 않습니다.
- 공식 Claude·Gemini npm 진입점의 심볼릭 링크도 확인합니다. 인증·업데이트·서버·비대화형 보조 명령은 제외합니다. 프로세스 이름을 대화 ID에 연결하거나 실행 중인 AI 업무로 추정하지 않습니다.
- 권한 거절, 조회 중 인스턴스 변경, 수집 한도 초과는 `확인 불가`로 표시합니다. 기존 실행을 종료로 처리하지 않으며 다음 정상 조회에서 복구합니다.
- 호스트 감지기를 컨테이너 안에서 실행하면 호스트 전체를 볼 수 없습니다. 호스트에서 실행하세요. WSL은 같은 WSL 환경 안에서 실행합니다.

## 웹 탭 연결

1. 같은 PC의 Chrome/Chromium에서 `chrome://extensions`를 엽니다.
2. **개발자 모드 → 압축해제된 확장 프로그램을 로드합니다**에서 `extensions/browser-observer`를 선택합니다.
3. 사무실 페이지를 새로고침하고 **직원 · 연결 관리 → 연결 관리 → 감지 → 웹 탭 감지 켜기**를 누릅니다.
4. ChatGPT·Claude·Gemini·Meta AI 탭을 열어 확인합니다. 같은 대화의 중복 탭은 대화 하나와 탭 수로 표시합니다.

사무실 페이지를 켜 두어야 갱신됩니다. 다른 프로필과 시크릿 창은 자동 연결하지 않습니다. 감지만으로 대화 제목·본문·쿠키·인증 정보를 수집하지 않습니다. 다른 포트를 사용한다면 확장 아이콘에서 사무실 주소도 변경하세요. 자세한 범위와 해제 방법은 [감지 안내](Detection.md)를 참고하세요.

## 폴더 권한과 문제 해결

사무실 서버는 기본 UID/GID `1000:1000`의 비루트 사용자로 실행합니다. 연결 프로그램을 먼저 실행해 호스트 `data/bridge`를 만들면 Docker가 해당 폴더를 root 소유로 먼저 생성하는 문제를 피할 수 있습니다. 기본 상태 파일은 읽기용이며 컨테이너의 `/app/bridge` 마운트도 읽기 전용입니다.

- **감지 미연결**: 연결 프로그램이 실행 중인지, 실행 계정·출력 위치와 `data/bridge`의 컨테이너 읽기·디렉터리 접근 권한을 확인합니다. root로 실행한 감지기는 root CLI만 감지합니다.
- **CLI 확인 불가**: `/proc` 접근 제한, `getconf` 설치, 프로세스 조회 권한을 확인합니다. 전체 시스템의 접근 제한을 해제하지 말고 CLI와 같은 사용자·호스트 환경에서 실행하세요.
- **대화 본문·명령 폴더 접근 실패**: `--include-conversations`, `--include-search-history`, `--allow-commands`는 별도 선택 사항입니다. 이 기능들의 비공개 파일은 소유자만 접근하므로 호스트와 컨테이너의 사용자·파일 권한을 맞춰야 합니다. 기본 메타데이터 감지 성공이 이 기능들의 준비 완료를 의미하지 않습니다. [CLI 안내](CLI.md)의 조건을 함께 확인하세요.
- **SELinux 환경**: Compose는 두 bridge 바인드 마운트에 공유 `z` 레이블을 지정합니다. 대상은 이 저장소의 `data/bridge`뿐입니다. SELinux가 활성화된 환경의 실제 정책 검증은 별도로 필요합니다.
- **웹 감지 응답 없음**: 확장을 설치한 프로필에서 사무실 페이지를 다시 열고 감지를 켜세요. Docker나 호스트 감지기만 시작해도 웹 탭이 자동 연결되지는 않습니다.

## 중지와 다음 실행

```sh
npm run bridge:codex -- --stop
docker compose stop
```

다음에는 연결 프로그램을 다시 실행하고 `docker compose up -d`로 사무실을 엽니다. 감지기 중지는 CLI 자체를 종료하지 않습니다. 기본 구성은 재부팅 후 자동 시작을 등록하지 않습니다. 직원·업무는 Docker 볼륨에 남으며 웹 감지는 브라우저 프로필에서 다시 연결합니다.

[CLI 연결](CLI.md) · [연결 점검](Connections.md) · [검증 범위](https://github.com/parkhw328/wook-home/blob/main/docs/validation.md)
