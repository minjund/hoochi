<p align="center"><img src="assets/icon.png" width="112" alt="hookwich 아이콘"></p>

<h1 align="center">hookwich (훅위치)</h1>

<p align="center"><b>Claude Code가 일하는 바로 그 순간에, 원하는 걸 시키세요.</b><br>
화면 구석의 작은 창이 Claude가 일하는 순간들을 그림으로 보여 줘요.<br>
순간 하나를 누르고, 그때 넣을 말·명령·스킬을 고르면 끝이에요.</p>

<p align="center"><a href="README.md">English</a> · <b>한국어</b> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">中文</a></p>

---

## 어디에 쓰나요?

Claude Code가 일할 때는 같은 순간이 계속 돌아와요. 대화가 시작되고, 내가 메시지를 보내고,
Claude가 도구를 쓰고(명령 실행, 파일 고치기), Claude가 답을 마쳐요.

hookwich를 쓰면 코드를 짜지 않고도 그 순간마다 무언가를 붙일 수 있어요.

| 넣는 것 | 하는 일 | 예 |
|---|---|---|
| **말** | 그 순간에 Claude가 읽어요. | 메시지를 보낼 때마다 *"답은 영어로 해 줘."* |
| **명령** | 내 컴퓨터에서 실행돼요. 결과를 Claude에게 항상 전하거나, 실패할 때만 전해요. | 답을 마칠 때 `npm test`를 실패할 때만 → 테스트가 통과할 때까지 Claude가 계속 고쳐요. |
| **스킬** | 설치된 스킬을 쓰라고 Claude에게 시켜요. | 답을 마칠 때 `code-review`. |

하나씩 켜고 끌 수 있고, **한 번만**을 켜면 한 번 실행한 뒤 저절로 꺼져요.
도구를 쓰는 순간에는 어떤 도구일 때만 넣을지도 고를 수 있어요.

<p align="center"><img src="assets/screenshot.png" alt="4개 언어로 본 hookwich 창"></p>

## 어디에 적용되나요?

넣은 것은 세 곳 중 한 곳에 들어가요.

- **모든 곳**: 모든 대화에 적용돼요.
- **이 프로젝트**: 그 프로젝트 폴더에서 연 대화에만 적용돼요.
- **이 터미널**: 그 터미널 창·탭에만 적용돼요. 그 터미널에서 Claude Code나 Codex를 다시 켜도 그대로예요.

순간마다 가장 가까운 곳이 이겨요. 이 터미널에 있으면 그것을, 없으면 이 프로젝트, 그것도 없으면 모든 곳의 것을 써요.
꺼 둔 항목도 자리를 차지해서, 특정 프로젝트에서만 '모든 곳' 항목을 조용히 시킬 수 있어요.
프로젝트·터미널 설정은 내 컴퓨터에만 저장되고, 프로젝트 안에는 들어가지 않아요.

탭 아래 버튼으로 다른 곳의 설정을 옮길 수 있어요. 덮어쓰지 않고, 이미 있는 건 건너뛰어요. 방금 옮긴 건 **되돌리기**로 되돌려요.
**모든 곳(전역) 값으로 세팅하기**, **프로젝트 값으로 세팅하기**(터미널에서), **모든 프로젝트에 적용**, **모든 곳(전역)에 적용**이 있어요.
그 자리에서 쓸 수 있는 버튼만 보여요.

**이 터미널**은 늘 지금 채팅하고 있는 터미널이에요. 어디서 치는지 hookwich가 알아서 보고 바뀌어서, 목록에서 터미널을 고를 일이 없어요.

순간 위에 마우스를 올리면 그 순간에 무엇이 들어 있는지(넣은 것, 이미 있는 훅) 보여요.

채팅하는 곳을 따라갈 때, 프로젝트 폴더의 터미널이면 **이 프로젝트**가, 프로젝트가 아닌 터미널이면 **모든 곳**이 먼저 열려요.

이미 있는 훅도 보여요. Claude Code 설정, 플러그인(훅으로 돌아가는 스킬 포함), Codex `hooks.json`에 있는 훅은 순간마다
왼쪽 위 **회색 숫자**로 나오고, 상자를 열면 이름이 보여요. 검은 숫자는 hookwich로 넣은 거예요.
이미 있는 훅마다 켜고 끄는 스위치가 있어요. Claude Code 설정의 훅은 끄면 옆(`~/.hookwich/parked.json`)으로 빼 두었다가 켜면 다시 넣어요.
Codex 훅은 `/hooks`와 같은 방식으로 제자리에서 꺼서 신뢰가 그대로예요. 플러그인 훅은 플러그인 전체로만 끄고 켤 수 있어서 먼저 물어봐요.
바꾸기 전에는 늘 `~/.hookwich/backups/`에 백업을 남겨요.

## Claude Code와 Codex

창에 탭이 둘 있어요. Codex는 자기 순간들(모델에 묻기 전, 도구 쓰기 전, 답을 마칠 때 등)을 따로 그린 그림이 있어요.
Codex 탭을 쓰려면 **Codex 연결하기**를 한 번 누르세요. hookwich가 `~/.codex/hooks.json` 맨 끝에 자기 항목만 더해요.
원래 있던 훅은 그대로이고, 옆에 백업도 남겨요. 그다음 Codex에서 `/hooks`를 한 번 입력하고 hookwich 훅을 신뢰해 주세요.
**연결 끊기**를 누르면 다시 빠져요.

## 창

- 다른 창들 위에, 오른쪽 아래 작은 🥪 버블로 떠 있어요. 끌어서 아무 데나 옮길 수 있어요.
- 버블을 누르면 Claude가 일하는 순간들이 그림으로 펼쳐져요. 공식
  [Claude Code 훅 라이프사이클 그림](https://code.claude.com/docs/en/hooks#hook-lifecycle)을 따라 그렸어요.
- 상자를 누르면 그 순간에 넣을 것을 고를 수 있어요. 상자의 숫자는 켜 둔 개수예요.
- 방금 일어난 순간이 빛나서, Claude가 지금 뭘 하는지 볼 수 있어요.
- **내가 채팅하는 곳 따라가기**(처음부터 켜짐): 마지막으로 채팅을 친 AI(Claude Code나 Codex)·프로젝트·터미널로
  창이 저절로 바뀌어요. 탭이나 터미널을 직접 고르면 꺼져요.
- 정해진 차례가 없는 순간(알림을 보낼 때, 설정이 바뀔 때, 모델을 바꿀 때 등)은 그림 아래 **아무 때나** 칸에 모여 있어요.
- `–`는 버블로 접고, `×`는 숨겨요. 숨겨도 화면 위쪽 메뉴 막대에 남아 있어요.
- 언어: English, 한국어, 日本語, 中文. 컴퓨터 언어를 따라가고, 창 위쪽에서 바꿀 수 있어요.

## 설치

**1. 플러그인**: 터미널에서

```sh
claude plugin install hookwich --marketplace minjund/hookwich
```

또는 Claude Code 안에서

```
/plugin marketplace add minjund/hookwich
/plugin install hookwich@hookwich
```

그다음 Claude Code 대화를 새로 시작하세요.

**2. 창(macOS 11 이상, 애플 실리콘·인텔 모두)**: Claude Code 대화를 처음 시작할 때 플러그인이
[최신 릴리스](https://github.com/minjund/hookwich/releases/latest)에서 창을 받아, SHA-256으로 진짜 파일인지 확인한 뒤 열어요.
`/hookwich`를 입력하면 창을 보이거나 숨겨요.

창을 직접 설치하려면:

```sh
mkdir -p ~/.hookwich && cd ~/.hookwich
curl -fsSLO https://github.com/minjund/hookwich/releases/latest/download/Hookwich-macos-arm64.zip
curl -fsSL https://github.com/minjund/hookwich/releases/latest/download/Hookwich-macos-arm64.zip.sha256 | shasum -a 256 -c
ditto -x -k Hookwich-macos-arm64.zip . && open Hookwich.app
```

이 앱은 애플 공증을 받지 않았어요. 위처럼 `curl`로 받으면 그냥 열려요. 브라우저로 zip을 받으면 처음에 macOS가 열기를 막을 수 있어요.
그때는 `Hookwich.app`을 오른쪽 클릭해서 **열기**를 고르세요.

**3. Codex(선택)**: 창의 Codex 탭에서 **Codex 연결하기**를 누르고, Codex에서 `/hooks`를 한 번 입력해 hookwich 훅을 신뢰해 주세요.

## 안전한가요?

넣은 명령은 그 순간이 올 때마다 내 컴퓨터에서, 나와 같은 권한으로 실행돼요.
직접 실행해도 괜찮은 명령만 넣으세요. 명령은 30초가 지나면 멈춰요.

## 개발자용

- `plugin/`: Claude Code 쪽이에요. 순간("훅 이벤트")마다 원래 있던 훅이 먼저 돌고, 그다음 켜 둔 것을 넣어요.
  Claude가 답을 마치려 할 때는 한 답에 많아야 한 번만 더 이어 가게 해서 끝없이 반복되지 않아요.
- `app/`: 창이에요. Tauri(Rust) + React + 무료 [affectUI](https://www.affectui.com) 컴포넌트로 만들었어요.
- 둘은 `~/.hookwich/`의 파일을 같이 써요. `config.json`(넣은 것), `activity-claude.json`·`activity-codex.json`(방금 일어난 일),
  `places.json`(본 프로젝트·터미널), `parked.json`(꺼 둔 훅), `control.json`(보이기·숨기기)이에요.

직접 빌드하려면 Node 20+, Rust, Xcode 명령줄 도구가 필요해요.

```sh
cd app && npm install
npm run tauri dev      # 창 실행
npm run tauri build    # Hookwich.app 만들기
claude plugin test plugin   # 플러그인 테스트
```

## 라이선스

MIT
