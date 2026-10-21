# 공개 구현 참고와 적용 결정

2026-10-21에 공개 README와 라이선스를 다시 확인했다. 이 저장소에는 과거 조사 저장소 목록이 남아 있지 않아 아래 프로젝트를 추가로 검토했다. 코드나 그래픽 자산을 복사하거나 새로운 런타임 의존성을 추가하지 않았다.

| 자료 | 참고한 구성 | wook-home 적용 |
| --- | --- | --- |
| [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) | 터미널 에이전트와 캐릭터 대응, 활동·입력 대기 표현, 공급자 연결 경계, 이름 있는 공간 | 세션 ID로 캐릭터를 유지하고 실제 상태와 움직임을 연결. 관찰과 명령 전달을 별도 모듈로 분리 |
| [Star Office UI](https://github.com/ringhyacinth/Star-Office-UI) | 업무 상태에 따른 구역 배치, 여러 에이전트의 상태 수집과 화면 표현 분리 | 업무 구역·회의실·라운지를 구분하고 연결 끊김을 완료와 구별. 화면 동작은 상태를 근거로 표현 |
| [Codex 공식 CLI](https://learn.chatgpt.com/docs/developer-commands) | 기존 세션 UUID에 지시를 큐로 전달 | `codex queue --thread … --message …`를 호스트에서 실행. 기존 세션을 별도로 resume해 중복 실행하지 않음 |

Pixel Agents의 [코드 라이선스는 MIT](https://github.com/pixel-agents-hq/pixel-agents/blob/main/LICENSE)이며, 배포 자산은 도입 시 개별 출처도 확인해야 한다. Star Office UI는 [코드 MIT·아트 비상업용 조건](https://github.com/ringhyacinth/Star-Office-UI/blob/master/LICENSE)을 구분한다. 현재 사무실 그래픽은 자체 작성 자산을 사용한다.

## 가로 배치와 입체 공간 보정 — 2026-10-22

| 자료 | 참고한 구성 | 적용 결정 |
| --- | --- | --- |
| [AI Office](https://github.com/Gaurav2693/ai-office) | 입체 사무실, 움직이는 에이전트, 유리로 구분한 회의 공간 | 가구 높이와 방의 깊이가 보이는 층별 사선 보기, 책상 사이 통로를 지나는 보행 |
| [Random Office Generator](https://github.com/designtology/random_office_generator) | 긴 복도와 분기, 방 표시와 표시 요소 전환 | 가로 복도를 연결 축으로 삼고 문까지 분기 표시, 동선 켜기·끄기 |
| [Three.js OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html) | 투영 범위와 확대율 | 창 비율에 맞는 건물 배치와 화면 맞춤, 글자 크기를 유지하는 장면 확대 |

공간 구성의 아이디어를 참고했으며 외부 코드·이미지·캐릭터 자산이나 의존성을 추가하지 않았다. 장면은 기존 Three.js와 자체 작성 가구·캐릭터로 구성한다. 전체 보기는 층 사이 관계를, 한 층 보기는 내부 깊이와 동선을 보여 주도록 구분한다.

## 이번 설계의 연결 경계

브라우저 → 로컬 HTTP API → 전용 지시 폴더 → 호스트 연결 프로그램 → 공식 Codex 큐 순서다. 컨테이너에는 호스트 인증 폴더나 범용 셸 실행 권한을 주지 않는다. 지시 본문은 셸 문자열에 결합하지 않고 별도 인수로 전달한다.

요청 ID로 중복을 막고 전달 전에 원문을 제거한다. 큐 접수, 전송 실패, 접수 여부 불명, 만료를 구분한다. 연결 프로그램이 재시작하면 이전 미접수 지시를 만료 처리하며, 전달 중 중단된 지시는 확인 필요로 남긴다. 답변 원문·승인 UI·신규 세션 채용은 후속 범위다.

향후 다른 공급자는 같은 관찰·지시 경계에 어댑터를 추가한다. 라이브러리나 엔진 교체는 필요 기능과 실제 성능 문제를 확인한 뒤 결정한다.
