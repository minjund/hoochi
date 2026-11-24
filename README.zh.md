<p align="center">
  <img src="assets/icon.png" width="112" alt="hoochi" />
</p>

<h1 align="center">hoochi</h1>

<p align="center">
  <b>我的钩子为什么不运行？</b><br />
  hoochi 按智能体检查的顺序，逐个检查 Claude Code 和 Codex 的钩子，用一句话告诉你第一个卡住的地方。可以当场修好，也可以直接用话说。
</p>

<p align="center">
  <a href="https://github.com/minjund/hoochi/releases/latest"><img src="https://img.shields.io/github/v/release/minjund/hoochi?label=release&labelColor=333333&color=3fa34d" alt="最新发布" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3fa34d?labelColor=333333" alt="MIT 许可证" /></a>
  <img src="https://img.shields.io/badge/macOS-11%2B%20%C2%B7%20Apple%20silicon%20%26%20Intel-3fa34d?labelColor=333333&logo=apple&logoColor=white" alt="macOS 11 及以上，Apple 芯片与 Intel" />
  <img src="https://img.shields.io/badge/works%20with-Claude%20Code%20%C2%B7%20Codex-3fa34d?labelColor=333333" alt="支持 Claude Code 与 Codex" />
  <a href="https://github.com/minjund/hoochi/stargazers"><img src="https://img.shields.io/github/stars/minjund/hoochi?labelColor=333333&color=3fa34d&logo=github" alt="GitHub 星标" /></a>
</p>

<p align="center">
  <a href="#能发现这些问题">能发现这些问题</a> · <a href="#安装">安装</a> · <a href="#一分钟弄清楚">一分钟弄清楚</a> · <a href="#工作原理">工作原理</a> · <a href="#常见问题">常见问题</a> · <a href="https://github.com/minjund/hoochi/releases">发布</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <b>中文</b>
</p>

<p align="center">
  <img src="assets/why.png" width="920" alt="浅色和深色的 hoochi 窗口：没在运行的钩子和原因，以及打开其中一个后看到的每一步检查和输出" />
</p>

```sh
claude plugin install hoochi --marketplace minjund/hoochi
```

---

加了钩子却什么都没发生。是那个时刻根本没来？被项目规则遮住了？工具名写成了 `edit` 而不是 `Edit`？
命令没装，以 127 结束了？Claude Code 不会告诉你。**hoochi 会。**

hoochi 按智能体的顺序逐个检查每个钩子：是否开启，对应的 AI 是否已连接，时刻是否到来，是否进入当前对话，
工具条件是否符合，这个时刻的话能否传到模型，上一次运行是怎么结束的。第一个没通过的就是答案，用一句话说明。

## 能发现这些问题

| 不运行的原因 | hoochi 说什么 |
|---|---|
| 项目或终端在那个时刻有自己的规则，所以全局规则在那里被遮住 | 哪个位置优先，以及 **也放进 …** |
| 工具名大小写不对、写成 `Edit\|Write` 这样的一个名字、或用了另一个 AI 的叫法（Codex 把所有文件编辑都叫 `apply_patch`） | *工具名连大小写也要一致：“edit”→“Edit”* |
| 匹配器和实际来过的工具一个都不符合 | 那个匹配器和实际来过的工具 |
| 放在模型听不到的时刻（对话结束、压缩前）的话 | *这里只能运行命令* |
| 找不到命令、超时、失败 | 怎么结束的，以及输出 |
| 插件的钩子悄悄失败或超时 | 读取 Claude Code 自己留下的运行记录 |
| Codex 的钩子没有连接 | 一个连接按钮 |
| 团队或企业账号收不到的时刻 | 哪些时刻，变暗显示 |

生命周期页面先显示没在运行的钩子，失败的排在最前。点一下就能看到它经过的每一步检查。
也可以在旁边的标签里问“lint 钩子为什么不运行？”“什么坏了？”。回答会附上每条规则现在的状态，
可以当场关掉、修改或删除。

## 能做什么

- **逐步说明为什么不运行** — 用 hoochi 加入的规则，以及设置文件和插件里原有的钩子。
- **每次运行都有记录** — 命令怎么结束、花了多久、失败时输出了什么。
- **在看到的地方修好** — 开关、在弹窗里修改，或者用话说：“测试改用 pnpm”“这个也放进 Codex”。
- **所有时刻一目了然** — 智能体的整个流程画成一张图，刚发生的时刻会亮起。
- **全局 · 项目 · 终端** — 最窄的位置优先，发生时页面会告诉你。
- **跟着你聊天的地方走** — 窗口会切到你正在输入的终端和它的项目。
- **/context 实时显示** — 对话用了多少、离自动压缩还有多远，就在图里。
- **开关技能** — 关掉不用的技能，省出空间。
- **一键更新** — 已经打开的对话也会自己换到新版本。
- **轻巧安静** — 原生应用（不是 Electron），空闲时几乎不占 CPU。4 种语言，浅色和深色。

## 安装

> **之前用过 hookwich？** 它现在叫 hoochi。先装新插件，再删掉旧的：`claude plugin install hoochi --marketplace minjund/hoochi`，然后 `claude plugin uninstall hookwich@hookwich`。用新插件第一次打开对话时，你加入的内容会从 `~/.hookwich` 移到 `~/.hoochi`，窗口也会把 Codex 钩子重新接到新应用上。

**1. 插件**，在终端里：

```sh
claude plugin install hoochi --marketplace minjund/hoochi
```

或在 Claude Code 里：

```
/plugin marketplace add minjund/hoochi
/plugin install hoochi@hoochi
```

**2. 窗口**会在你第一次开始 Claude Code 对话时自动下载（macOS 11 及以上，Apple 芯片与 Intel）。手动安装：

```sh
mkdir -p ~/.hoochi && cd ~/.hoochi
curl -fsSLO https://github.com/minjund/hoochi/releases/latest/download/Hoochi-macos-arm64.zip
curl -fsSL https://github.com/minjund/hoochi/releases/latest/download/Hoochi-macos-arm64.zip.sha256 | shasum -a 256 -c
ditto -x -k Hoochi-macos-arm64.zip . && open Hoochi.app
```

**3. Codex（可选）** 在窗口的 Codex 标签里按 **连接 Codex**，然后在 Codex 里输入一次 `/hooks`，信任 hoochi 的钩子。

**更新：** 按窗口上方的 **更新**，或运行 `claude plugin update hoochi@hoochi`。已打开的对话几秒内会自己换成新版本
（从 0.1.16 起；从更早的版本升级时，请在每个已打开的对话里手动输入一次 `/reload-plugins`）。安装 hoochi 之前打开的对话里没有 hoochi，
请重新开始那个对话（`claude --continue` 可以接着之前的对话）。

## 一分钟弄清楚

1. 打开一个 Claude Code 对话。右下角出现 🥪 气泡后点它。
2. **生命周期** 页面先显示没在运行的钩子。如果是空的，说明所有钩子都通过了所有检查。
3. 点一行，就能看到它经过的每一步检查。卡住的一步显示为红色，输出也一起显示。
4. 当场修好（开关、修改、**也放进 …**），或者在 **用话放入** 标签里用话修改。

加钩子也可以用话说：“回答结束时运行 `npm test`，只在失败时告诉我”。也可以在图里点一个时刻，
选 **命令** → `npm test` → **只在失败时** → **保存**。

输入 `/hoochi` 显示或隐藏窗口。`×` 折叠成气泡，右键点气泡可以隐藏到菜单栏。

## 工作原理

<p align="center">
  <img src="assets/how-it-works.zh.svg" width="920" alt="hoochi 的工作方式：智能体在每个时刻读取 ~/.hoochi 里你加入的内容并记录发生的事，窗口把它显示出来" />
</p>

- 文件都在 `~/.hoochi`：`config.json`（加入的内容）、`activity-*.json`（刚发生的事）、`places.json`（见过的项目和终端）、
  `parked.json`（关掉的钩子）、`once-*.json`（每次对话一次的项目在哪些对话里运行过）、`context/`（每个终端的 /context）。hoochi 修改其他设置文件前，会先备份到 `~/.hoochi/backups/`。
- 钩子的情况：插件和 Codex 钩子会记录你加入内容的每次运行结果（`activity-*.json` 里的 `runs`）。别处设置的钩子，
  由窗口读取 Claude Code 在每个对话里留下的运行记录（`~/.claude/projects/*/*.jsonl`，最近 3 天中最新的 40 个），只读不写。

## 常见问题

**安全吗？** 加入的命令每到那个时刻就在你的电脑上、以你的权限运行。只放你自己也愿意运行的命令。命令 30 秒后会停止。

**会让智能体变慢吗？** 文字和技能立即加入。命令要花它运行的时间。

**打开时 macOS 有警告。** 应用做了临时签名，但没有经过 Apple 公证。像插件那样用 `curl` 下载就能直接打开。
如果是用浏览器下载的，右键 `Hoochi.app` 选一次 **打开**。

**会改我原有的钩子吗？** 只有在你关掉或重新打开时才会，而且总会先备份。Codex 钩子和 Codex 自己的 `/hooks` 一样在原处切换。

**我有很多技能，为什么列表比较短？** 技能窗口只列出在那里能开关的。从 claude.ai 同步的技能在 claude.ai 上开关，插件的技能只能随整个插件开关，
所以每个插件只占一行。

**能看到不是 hoochi 建的钩子吗？** 能。Claude Code 的钩子，会从 Claude Code 为每个对话留下的记录里读出运行是怎么结束的。
Codex 不会留下钩子的运行结果，所以别处设置的 Codex 钩子只能检查设置，看不到运行情况。

**Windows 和 Linux 呢？** 还没有，现在窗口只支持 macOS。

## 开发者

```sh
git clone https://github.com/minjund/hoochi && cd hoochi
cd app && npm install
npm run tauri dev                                         # 运行窗口
npm run tauri build -- --target universal-apple-darwin    # 构建 Hoochi.app
npm test                                                  # 窗口的状态机测试
cd src-tauri && cargo test                                # 窗口（Rust）测试
cd ../.. && claude plugin test plugin                     # 插件测试
```

- `plugin/` 是 Claude Code 这一侧：用 `classic.*` 钩子、`prompt.submit` 与 `prompt.edit` 和 /context 记录的 TypeScript 模组。
- `app/` 是窗口：Tauri（Rust）+ React + 免费的 [affectUI](https://www.affectui.com) 组件，以及 Codex 钩子运行器（`hoochi hook codex <Event>`）。
  窗口的状态（保存、更新、提示、跟随）写在 `app/src/lib/machines.ts` 里。给编码智能体的说明在 [AGENTS.md](AGENTS.md)。

需要 Node 23.6+、Rust 和 Xcode 命令行工具。

## 许可证

[MIT](LICENSE)
