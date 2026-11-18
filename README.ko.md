<p align="center"><img src="assets/icon.png" width="112" alt="hookwich 아이콘"></p>

<h1 align="center">hookwich (훅위치)</h1>

<p align="center"><b>Claude Code를 위한 훅 샌드위치.</b><br>
Claude Code 라이프사이클의 아무 순간 앞뒤에 글·명령·스킬을 끼워 넣어요.<br>
화면 구석에 떠 있는 작은 창에서요.</p>

<p align="center"><a href="README.md">English</a></p>

---

Claude Code는 한 바퀴씩 돌아요. 세션이 시작되고, 프롬프트를 보내고, 툴을 부르고, 멈춰요.
훅으로 그 순간마다 끼어들 수 있지만, 그러려면 JSON과 셸 스크립트를 직접 고쳐야 해요.

hookwich는 그 한 바퀴를 샌드위치 더미로 그려요. 단계가 속재료이고, 그 앞 칸과 뒤 칸이 빵이에요.
칸의 `+`를 눌러 무언가를 끼워 넣으세요.

| 넣는 것 | 하는 일 |
|---|---|
| **글** | 그 순간 모델에게 건네요. 예: 프롬프트마다 앞에 *"답은 영어로"*. |
| **명령** | 세션 폴더에서 돌리고 출력을 모델에게 줘요. 항상 주거나, 실패할 때만 줘요. 예: 턴이 끝날 때 `npm test`를 실패할 때만 넣으면, 통과할 때까지 Claude가 계속 고쳐요. |
| **스킬** | 설치된 스킬 하나를 쓰라고 시켜요. 예: 턴이 끝날 때 `code-review`. |

항목마다 켜고 끌 수 있고, 툴 칸은 특정 툴(`Bash, Edit`)에만 넣을 수 있어요.
**Once**를 켜면 한 번 실행한 뒤 스스로 꺼져요.

<p align="center"><img src="assets/screenshot.png" width="460" alt="hookwich 패널과 버블"></p>

## 창

- 모든 창 위에 떠 있고, 평소엔 오른쪽 아래에 🥪 버블로 접혀 있어요.
- 누르면 펼쳐지고, 끌면 원하는 곳으로 옮겨져요.
- `–`는 버블로 접고, `×`는 상단 메뉴 막대로 숨겨요. 메뉴 막대 아이콘을 누르면 다시 나와요.
- 방금 실행된 칸이 빛나고, 최근에 넣은 것들이 아래에 보여요.

## 설치

**1. 플러그인**: Claude Code 프롬프트에서 실행해요. 마켓플레이스 추가는 `y`, 그다음 범위를 골라요.

```
/plugin install hookwich --marketplace minjund/hookwich
```

셸에서는 `claude plugin install hookwich --marketplace minjund/hookwich`예요.

**2. 창 앱(macOS)**: 세션이 처음 시작될 때 플러그인이 최신 [릴리스](https://github.com/minjund/hookwich/releases)에서
받아요. SHA-256을 확인한 뒤 열어요. 직접 빌드할 수도 있어요(아래 참고).

그다음 `/hookwich`로 창을 보이거나 숨겨요(`/hookwich show`, `/hookwich hide`).

## 소스로 빌드

Node 20+, Rust(stable), Xcode 명령줄 도구가 필요해요.

```sh
cd app
npm install
npm run tauri dev        # 창 실행
npm run tauri build      # Hookwich.app 빌드
```

## 안전

명령 항목은 그 이벤트가 일어날 때마다 내 컴퓨터에서 셸 명령을 실행해요. settings 훅과 같은 권한이에요.
직접 실행해도 괜찮은 명령만 넣으세요. 명령은 30초가 지나면 멈춰요.

## 라이선스

MIT
