<p align="center">
  <img src="assets/icon.png" width="112" alt="hoochi" />
</p>

<h1 align="center">hoochi (후치)</h1>

<p align="center">
  <b>내 훅은 왜 안 돌지?</b><br />
  후치는 Claude Code와 Codex의 훅을 에이전트가 따지는 순서 그대로 하나씩 확인하고, 처음 막힌 곳을 한 문장으로 알려 줘요. 고치는 건 그 자리에서, 아니면 말로 하면 돼요.
</p>

<p align="center">
  <a href="https://github.com/minjund/hoochi/releases/latest"><img src="https://img.shields.io/github/v/release/minjund/hoochi?label=release&labelColor=333333&color=3fa34d" alt="최신 릴리스" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3fa34d?labelColor=333333" alt="MIT 라이선스" /></a>
  <img src="https://img.shields.io/badge/macOS-11%2B%20%C2%B7%20Apple%20silicon%20%26%20Intel-3fa34d?labelColor=333333&logo=apple&logoColor=white" alt="macOS 11 이상, 애플 실리콘·인텔" />
  <img src="https://img.shields.io/badge/works%20with-Claude%20Code%20%C2%B7%20Codex-3fa34d?labelColor=333333" alt="Claude Code·Codex와 함께" />
  <a href="https://github.com/minjund/hoochi/stargazers"><img src="https://img.shields.io/github/stars/minjund/hoochi?labelColor=333333&color=3fa34d&logo=github" alt="GitHub 별" /></a>
</p>

<p align="center">
  <a href="#이런-걸-잡아요">이런 걸 잡아요</a> · <a href="#설치">설치</a> · <a href="#1분-만에-확인하기">1분 만에 확인하기</a> · <a href="#어떻게-돌아가나요">어떻게 돌아가나요</a> · <a href="#자주-묻는-것">자주 묻는 것</a> · <a href="https://github.com/minjund/hoochi/releases">릴리스</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <b>한국어</b> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">中文</a>
</p>

<p align="center">
  <img src="assets/why.png" width="920" alt="밝은 화면과 어두운 화면의 hoochi 창: 안 도는 훅과 그 이유, 그리고 그중 하나를 열어 거친 확인 단계와 출력을 본 모습" />
</p>

```sh
claude plugin install hoochi --marketplace minjund/hoochi
```

---

훅을 넣었는데 아무 일도 안 일어나요. 그 순간이 아예 안 왔을까요? 프로젝트 규칙에 가려졌을까요? 도구 이름을
`Edit` 대신 `edit`로 썼을까요? 설치가 안 돼서 명령이 127로 끝났을까요? Claude Code는 말해 주지 않아요.
**후치는 말해 줘요.**

후치는 훅마다 에이전트와 같은 순서로 따져요. 켜져 있나, 그 AI가 연결돼 있나, 그 순간이 오나, 지금 채팅에
닿나, 도구 조건이 맞나, 그 순간에 말이 모델에 닿나, 마지막 실행은 어떻게 끝났나. 처음 걸린 곳이 답이고,
한 문장으로 보여 줘요.

## 이런 걸 잡아요

| 안 도는 이유 | 후치가 하는 말 |
|---|---|
| 프로젝트나 터미널에 그 순간 규칙이 따로 있어서, 모든 곳 규칙이 거기선 가려짐 | 어느 곳이 이기는지, 그리고 **…에도 같이 넣기** |
| 도구 이름의 대소문자가 다름, `Edit\|Write`처럼 한 이름으로 씀, 다른 AI의 이름을 씀 (Codex는 파일 고치기를 모두 `apply_patch`라고 불러요) | *도구 이름은 대소문자까지 같아야 해요: "edit" → "Edit"* |
| 매처가 실제로 온 도구 어느 것과도 안 맞음 | 그 매처와 실제로 온 도구 |
| 모델이 듣지 못하는 순간(대화 끝, 압축 전)에 넣은 말 | *여기선 명령만 돌아요* |
| 명령을 못 찾음, 시간 초과, 실패 | 어떻게 끝났는지와 출력 |
| 플러그인 훅이 조용히 실패하거나 시간 초과로 끊김 | Claude Code가 직접 남긴 실행 기록을 읽어서 |
| 가끔만 끊기는 훅 (직접 돌리면 멀쩡함) | 최근 7일 몇 번, 대화 몇 곳, 날마다 막대, 지난 24시간 |
| 훅 탓인지 Claude Code·이 컴퓨터 탓인지 모름 | *같은 순간(UserPromptSubmit)에 도는 다른 훅 3개는 같은 기간 실패 0번이에요. 이 훅의 문제예요* |
| 아직은 돌지만 한도에 거의 닿음 | *느릴 때 한도 20초 중 17.7초까지 걸려요. 언젠가 시간 초과로 끊겨요* |
| Codex 훅이 연결 안 됨 | 연결 버튼 하나 |
| 팀·엔터프라이즈 계정이라 플러그인에 오지 않는 순간 | 어느 순간인지, 흐리게 |

라이프 사이클 화면은 안 도는 훅부터 보여 줘요. 실패한 것이 먼저예요. 하나를 누르면 거친 단계가 모두 보여요.
옆 탭에서 "린트 훅 왜 안 돌아?", "뭐가 고장났어?"라고 물어도 돼요. 규칙마다 지금 상태를 붙여 답하고, 그 자리에서
끄고, 고치고, 지울 수 있어요.

## 할 수 있는 것

- **왜 안 도는지, 단계별로** — 후치로 넣은 규칙도, 설정 파일과 플러그인에 원래 있던 훅도.
- **실행마다 기록** — 명령이 어떻게 끝났는지, 얼마나 걸렸는지, 실패했을 때 무엇을 출력했는지.
- **아이콘 숫자 = 안 도는 훅 수** — 접혀 있어도 빨간 숫자로 보여요. 다 잘 돌면 숫자가 없어요.
- **진단 복사** — 확인한 것, 최근 7일, 최근 실패를 글로 복사해요. 플러그인 원래 저장소의 Claude Code에 붙여 고쳐 달라고 하거나, 남의 플러그인이면 만든 사람에게 보내요.
- **본 자리에서 고치기** — 스위치, 팝업에서 고치기, 아니면 말로: "테스트는 pnpm으로", "이거 Codex에도 넣어 줘".
- **모든 순간을 한눈에** — 에이전트가 일하는 흐름을 그림 한 장으로. 방금 지나간 순간이 빛나요.
- **모든 곳 · 프로젝트 · 터미널** — 가장 좁은 곳이 이기고, 그럴 때 화면이 알려 줘요.
- **채팅하는 곳을 따라가요** — 치고 있는 터미널과 그 프로젝트로 창이 알아서 바뀌어요.
- **/context 실시간** — 얼마나 찼는지, 자동 압축까지 얼마 남았는지 그림 안에서.
- **스킬 켜고 끄기** — 안 쓰는 스킬은 꺼서 기억 공간을 아껴요.
- **버튼 하나로 업데이트** — 열린 대화까지 알아서 새 판으로 바뀌어요.
- **가볍고 조용해요** — 네이티브 앱(Electron 아님), 쉴 때는 CPU를 거의 안 써요. 4개 언어, 밝게·어둡게.

## 설치

> **hookwich를 쓰고 있었다면** 이름이 hoochi(후치)로 바뀌었어요. 새 플러그인을 설치한 뒤 옛 플러그인을 지우세요: `claude plugin install hoochi --marketplace minjund/hoochi`, 그다음 `claude plugin uninstall hookwich@hookwich`. 새 플러그인으로 처음 대화를 열면 넣어 둔 것이 `~/.hookwich`에서 `~/.hoochi`로 옮겨지고, 창이 Codex 훅도 새 앱으로 다시 이어요.

**1. 플러그인** — 터미널에서

```sh
claude plugin install hoochi --marketplace minjund/hoochi
```

또는 Claude Code 안에서

```
/plugin marketplace add minjund/hoochi
/plugin install hoochi@hoochi
```

**2. 창**은 Claude Code 대화를 처음 시작할 때 저절로 받아져요(macOS 11 이상, 애플 실리콘·인텔). 직접 설치하려면:

```sh
mkdir -p ~/.hoochi && cd ~/.hoochi
curl -fsSLO https://github.com/minjund/hoochi/releases/latest/download/Hoochi-macos-arm64.zip
curl -fsSL https://github.com/minjund/hoochi/releases/latest/download/Hoochi-macos-arm64.zip.sha256 | shasum -a 256 -c
ditto -x -k Hoochi-macos-arm64.zip . && open Hoochi.app
```

**3. Codex(선택)** — 창의 Codex 탭에서 **Codex 연결하기**를 누르고, Codex에서 `/hooks`를 한 번 입력해
hoochi 훅을 신뢰해 주세요.

**새 판 받기:** 창 위쪽의 **업데이트하기**를 누르세요. 손으로 하려면 `claude plugin update hoochi@hoochi`예요.
이미 열린 대화는 몇 초 안에 스스로 `/reload-plugins`를 해서 바뀌어요(0.1.16부터. 그보다 예전 판에서 올릴 때만
열린 대화마다 한 번 직접 치세요). hoochi를 설치하기 전에 열어 둔 대화에는 hoochi가 없으니, 그 대화는 새로
시작하세요(`claude --continue`로 이어 갈 수 있어요).

## 1분 만에 확인하기

1. Claude Code 대화를 열어요. 오른쪽 아래에 🥪 거품이 뜨면 눌러요.
2. **라이프 사이클** 화면이 안 도는 훅부터 보여 줘요. 비어 있으면 모든 훅이 모든 확인을 통과한 거예요.
3. 한 줄을 누르면 거친 단계가 모두 보여요. 막힌 단계는 빨갛게, 출력도 함께 보여 줘요.
4. 그 자리에서 고치거나(스위치, 고치기, **…에도 같이 넣기**), **말로 넣기** 탭에서 말로 고쳐요.

훅을 넣을 때도 말로 하면 돼요: "답을 마칠 때 `npm test` 돌려서 실패할 때만 알려 줘". 그림에서 순간을 누르고
**명령** → `npm test` → **실패할 때만** → **저장**으로 넣어도 돼요.

`/hoochi`로 창을 보이거나 숨겨요. `×`는 거품으로 접고, 거품을 오른쪽 클릭하면 메뉴 막대로 숨겨요.

## 어떻게 돌아가나요

<p align="center">
  <img src="assets/how-it-works.ko.svg" width="920" alt="hoochi가 돌아가는 방식: 에이전트가 순간마다 ~/.hoochi의 내가 넣은 것을 읽고, 일어난 일을 기록하면 창이 그걸 보여 줘요" />
</p>

- 파일은 모두 `~/.hoochi`에 있어요: `config.json`(넣은 것), `activity-*.json`(방금 일어난 일), `places.json`(본 프로젝트·터미널),
  `parked.json`(꺼 둔 훅), `once-*.json`(대화마다 한 번인 칸이 어느 대화에서 돌았는지), `context/`(터미널별 /context). hoochi가 남의 설정 파일을 바꿀 때는 먼저 `~/.hoochi/backups/`에 백업해요.
- 훅이 어땠는지: 플러그인과 Codex 훅이 넣은 것의 실행마다 결과를 남겨요(`activity-*.json`의 `runs`). 다른 곳에서 설정된
  훅은 Claude Code가 대화마다 남기는 실행 기록(`~/.claude/projects/*/*.jsonl`, 최근 3일 중 가장 최근 40개)을 창이 읽기만 해요.

## 자주 묻는 것

**안전한가요?** 넣은 명령은 그 순간이 올 때마다 내 컴퓨터에서, 나와 같은 권한으로 돌아요. 직접 돌려도
괜찮은 명령만 넣으세요. 명령은 30초가 지나면 멈춰요.

**에이전트가 느려지나요?** 말과 스킬은 바로 들어가요. 명령은 그 명령이 도는 만큼 걸려요.

**열 때 macOS가 경고해요.** 앱은 임시 서명은 했지만 애플 공증은 받지 않았어요. 플러그인처럼 `curl`로 받으면
그냥 열려요. 브라우저로 받았다면 `Hoochi.app`을 오른쪽 클릭해서 **열기**를 한 번 고르세요.

**원래 있던 훅을 바꾸나요?** 내가 끄거나 다시 켤 때만 바꾸고, 늘 백업을 남겨요. Codex 훅은 Codex의 `/hooks`와
똑같이 제자리에서 꺼요.

**스킬이 많다는데 목록엔 왜 적어요?** 스킬 창은 여기서 켜고 끌 수 있는 것만 보여 줘요. claude.ai에서 동기화된
스킬은 claude.ai에서 켜고 끄고, 플러그인 스킬은 플러그인째로만 꺼져서 플러그인 한 줄로 나와요.

**후치가 만들지 않은 훅도 보이나요?** 네. Claude Code 훅은 Claude Code가 대화마다 직접 남긴 기록에서 실행이
어떻게 끝났는지 읽어요. Codex는 훅을 실행한 결과를 남기지 않아서, 다른 곳에서 설정된 Codex 훅은 설정까지만
확인할 수 있어요.

**윈도우·리눅스는요?** 아직이에요. 지금은 창이 macOS 전용이에요.

## 개발자용

```sh
git clone https://github.com/minjund/hoochi && cd hoochi
cd app && npm install
npm run tauri dev                                         # 창 실행
npm run tauri build -- --target universal-apple-darwin    # Hoochi.app 만들기
npm test                                                  # 창의 상태 기계 테스트
cd src-tauri && cargo test                                # 창(Rust) 테스트
cd ../.. && claude plugin test plugin                     # 플러그인 테스트
```

- `plugin/` — Claude Code 쪽이에요(`classic.*` 훅, `prompt.submit`·`prompt.edit`, `/context` 기록을 쓰는 TypeScript 모드).
- `app/` — 창이에요. Tauri(Rust) + React + 무료 [affectUI](https://www.affectui.com) 컴포넌트, 그리고 Codex 훅 실행기
  (`hoochi hook codex <Event>`)가 들어 있어요. 창의 상태(저장, 업데이트, 알림, 따라가기)는 `app/src/lib/machines.ts`에
  적혀 있어요. 에이전트용 안내는 [AGENTS.md](AGENTS.md)에 있어요.

Node 23.6+, Rust, Xcode 명령줄 도구가 필요해요.

## 라이선스

[MIT](LICENSE)
