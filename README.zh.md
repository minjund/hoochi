<p align="center"><img src="assets/icon.png" width="112" alt="hookwich 图标"></p>

<h1 align="center">hookwich</h1>

<p align="center"><b>在 Claude Code 工作的那一刻，告诉它你想要什么。</b><br>
屏幕角落的小窗口会用一张图展示 Claude 工作的每个时刻。<br>
点一个时刻，选择要在那时加入的话、命令或技能就行。</p>

<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <b>中文</b></p>

---

## 有什么用？

Claude Code 工作时，同样的时刻会一次次出现：对话开始、你发送消息、Claude 使用工具（运行命令、修改文件）、
Claude 回答完毕……

用 hookwich，不用写代码，就能在这些时刻加上你想要的内容。

| 加入 | 会发生什么 | 例子 |
|---|---|---|
| **文字** | Claude 会在那一刻读到。 | 每次发消息时：“请用英文回答。” |
| **命令** | 在你的电脑上运行。结果可以总是交给 Claude，或只在失败时交给它。 | 回答结束时运行 `npm test`，只在失败时 → Claude 会一直修到测试通过。 |
| **技能** | 让 Claude 使用你已安装的某个技能。 | 回答结束时用 `code-review`。 |

每一项都可以开关；选 **只一次** 的话，运行一次后会自动关闭。
在使用工具的时刻，还可以指定只对哪些工具生效。

<p align="center"><img src="assets/screenshot.png" alt="四种语言的 hookwich 窗口"></p>

## 在哪里生效？

你加入的内容会放在下面三处之一：

- **所有地方**：所有对话。
- **这个项目**：只在该项目文件夹中打开的对话。
- **这个终端**：只在那个终端窗口或标签页中，即使在里面重新启动 Claude Code 或 Codex 也一样。

每个时刻都由最近的一处决定：这个终端 → 这个项目 → 所有地方。
关闭的项目也会占位，所以可以只在某个项目里让“所有地方”的项目安静下来。
项目和终端的设置只保存在你的电脑上，不会放进项目里。

标签页下方的按钮可以在不同地方之间复制设置。不会覆盖，已有的会跳过；刚复制的可以用 **撤销** 还原。
有 **用“所有地方”的设置来设定**、**用项目的设置来设定**（在终端中）、**应用到所有项目**、**应用到“所有地方”**。
只显示在当前位置能用的按钮。

**这个终端** 始终指你现在正在聊天的终端：hookwich 会看你在哪里输入并自动切换，不需要从列表里选终端。
窗口顶部会显示你正在聊天的地方（文件夹、AI，同一文件夹有多个对话时还有编号），每个终端颜色不同（气泡上也有圆点）。
换到另一个终端时会提示你。

把鼠标停在某个时刻上，就能看到里面有什么（你加入的、已有的钩子）。

跟随你聊天的地方时，项目文件夹里的终端会先打开 **这个项目**，不在项目里的终端会先打开 **所有地方**。

已有的钩子也会显示。Claude Code 设置、插件（包括靠钩子运行的技能）、Codex 的 `hooks.json` 里的钩子，
会在每个时刻左上角显示为 **灰色数字**，打开方框就能看到名字。黑色数字是用 hookwich 加入的。
每个已有的钩子都有开关。Claude Code 设置里的钩子关闭时会被移到一旁（`~/.hookwich/parked.json`），打开时再放回去。
Codex 的钩子和 `/hooks` 一样在原处关闭，所以信任保持不变。插件的钩子只能随整个插件开关，所以会先询问。
每次修改前都会在 `~/.hookwich/backups/` 留下备份。

## Claude Code 和 Codex

窗口里两者各有一个标签页。Codex 有自己的流程图（请求模型前、使用工具前、回答结束时等）。
要使用 Codex 标签页，请按一次 **连接 Codex**：hookwich 只会在 `~/.codex/hooks.json` 末尾加入自己的项目，
原有的钩子保持不变，并在旁边保存备份。然后在 Codex 中输入一次 `/hooks`，信任 hookwich 的钩子。
按 **断开连接** 即可移除。

## 窗口

- 它以右下角的小 🥪 气泡浮在其他窗口之上，可以拖到任何地方。
- 点气泡就会展开 Claude 工作流程图。它参照官方
  [Claude Code 钩子生命周期图](https://code.claude.com/docs/en/hooks#hook-lifecycle)绘制。
- 点任意方框即可添加内容。方框上的数字表示已开启的项数。
- 刚刚发生的时刻会亮起来，你能看到 Claude 正在做什么。
- 底部的 **我加入的** 会列出最近加入的 3 项，每项都有开关；更多时可点 **查看全部**，按位置查看完整列表，逐个开关或点一下去编辑。
- **跟随我正在聊天的地方**（默认开启）：窗口会自动切换到你最后输入的 AI（Claude Code 或 Codex）、项目和终端。
  自己选择标签页或终端时会关闭。
- 没有固定顺序的时刻（发送通知、设置变化、切换模型等）集中在图下方的 **随时** 区域。
- `–` 收成气泡，`×` 隐藏；隐藏后它会留在屏幕顶部的菜单栏。
- 语言：English、한국어、日本語、中文。默认跟随电脑语言，可在窗口顶部切换。
- 浅色·深色：顶部按钮可在跟随电脑设置、浅色、深色之间切换。

## 安装

**1. 插件**：在终端中

```sh
claude plugin install hookwich --marketplace minjund/hookwich
```

或在 Claude Code 中

```
/plugin marketplace add minjund/hookwich
/plugin install hookwich@hookwich
```

然后重新开始一个 Claude Code 对话。

**2. 窗口（macOS 11 及以上，Apple 芯片和 Intel 都可以）**：第一次开始 Claude Code 对话时，插件会从
[最新发布](https://github.com/minjund/hookwich/releases/latest)下载窗口，用 SHA-256 确认文件可信后打开。
输入 `/hookwich` 即可显示或隐藏窗口。窗口始终与插件版本一致：插件更新后，下一次对话时窗口也会换成新版（同样会校验）。

要手动安装窗口：

```sh
mkdir -p ~/.hookwich && cd ~/.hookwich
curl -fsSLO https://github.com/minjund/hookwich/releases/latest/download/Hookwich-macos-arm64.zip
curl -fsSL https://github.com/minjund/hookwich/releases/latest/download/Hookwich-macos-arm64.zip.sha256 | shasum -a 256 -c
ditto -x -k Hookwich-macos-arm64.zip . && open Hookwich.app
```

这个应用没有经过 Apple 公证。像上面这样用 `curl` 下载可以直接打开；如果用浏览器下载 zip，macOS 第一次可能会阻止打开，
这时右键点 `Hookwich.app`，选择 **打开**。

**3. Codex（可选）**：在窗口的 Codex 标签页按 **连接 Codex**，然后在 Codex 中输入一次 `/hooks`，信任 hookwich 的钩子。

## 安全吗？

你加入的命令会在每次对应时刻到来时，以和你相同的权限在你的电脑上运行。
只加入你自己也愿意运行的命令。命令超过 30 秒会被停止。

## 许可证

MIT
