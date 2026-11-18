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

## 창

- 다른 창들 위에, 오른쪽 아래 작은 🥪 버블로 떠 있어요. 끌어서 아무 데나 옮길 수 있어요.
- 버블을 누르면 Claude가 일하는 순간들이 그림으로 펼쳐져요. 공식
  [Claude Code 훅 라이프사이클 그림](https://code.claude.com/docs/en/hooks#hook-lifecycle)을 따라 그렸어요.
- 상자를 누르면 그 순간에 넣을 것을 고를 수 있어요. 상자의 숫자는 켜 둔 개수예요.
- 방금 일어난 순간이 빛나서, Claude가 지금 뭘 하는지 볼 수 있어요.
- `–`는 버블로 접고, `×`는 숨겨요. 숨겨도 화면 위쪽 메뉴 막대에 남아 있어요.
- 언어: English, 한국어, 日本語, 中文. 컴퓨터 언어를 따라가고, 창 위쪽에서 바꿀 수 있어요.

## 설치

**1. 플러그인**: Claude Code에 아래를 입력하고, `y`를 누른 뒤 설치할 곳을 고르세요.

```
/plugin install hookwich --marketplace minjund/hookwich
```

터미널에서는 `claude plugin install hookwich --marketplace minjund/hookwich`예요.

**2. 창(macOS)**: Claude Code 대화를 처음 시작할 때 플러그인이 [릴리스 페이지](https://github.com/minjund/hookwich/releases)에서
창을 받아요. 진짜 파일이 맞는지 확인한 뒤 열어요.

`/hookwich`를 입력하면 창을 보이거나 숨겨요.

## 안전한가요?

넣은 명령은 그 순간이 올 때마다 내 컴퓨터에서, 나와 같은 권한으로 실행돼요.
직접 실행해도 괜찮은 명령만 넣으세요. 명령은 30초가 지나면 멈춰요.

## 개발자용

- `plugin/`: Claude Code 쪽이에요. 순간("훅 이벤트")마다 원래 있던 훅이 먼저 돌고, 그다음 켜 둔 것을 넣어요.
  Claude가 답을 마치려 할 때는 한 답에 많아야 한 번만 더 이어 가게 해서 끝없이 반복되지 않아요.
- `app/`: 창이에요. Tauri(Rust) + React + 무료 [affectUI](https://www.affectui.com) 컴포넌트로 만들었어요.
- 둘은 `~/.hookwich/`의 파일 세 개를 같이 써요. `config.json`(넣은 것), `activity.json`(방금 일어난 일),
  `control.json`(보이기·숨기기)이에요.

직접 빌드하려면 Node 20+, Rust, Xcode 명령줄 도구가 필요해요.

```sh
cd app && npm install
npm run tauri dev      # 창 실행
npm run tauri build    # Hookwich.app 만들기
claude plugin test plugin   # 플러그인 테스트
```

## 라이선스

MIT
