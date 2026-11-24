<p align="center">
  <img src="assets/icon.png" width="112" alt="hoochi" />
</p>

<h1 align="center">hoochi</h1>

<p align="center">
  <b>Why doesn't my hook run?</b><br />
  hoochi checks every hook of Claude Code and Codex the way the agent does, and tells you the first thing that stops it. Then fix it in place, or just say what you want.
</p>

<p align="center">
  <a href="https://github.com/minjund/hoochi/releases/latest"><img src="https://img.shields.io/github/v/release/minjund/hoochi?label=release&labelColor=333333&color=3fa34d" alt="latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3fa34d?labelColor=333333" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/macOS-11%2B%20%C2%B7%20Apple%20silicon%20%26%20Intel-3fa34d?labelColor=333333&logo=apple&logoColor=white" alt="macOS 11 or later, Apple silicon and Intel" />
  <img src="https://img.shields.io/badge/works%20with-Claude%20Code%20%C2%B7%20Codex-3fa34d?labelColor=333333" alt="works with Claude Code and Codex" />
  <a href="https://github.com/minjund/hoochi/stargazers"><img src="https://img.shields.io/github/stars/minjund/hoochi?labelColor=333333&color=3fa34d&logo=github" alt="GitHub stars" /></a>
</p>

<p align="center">
  <a href="#what-it-catches">What it catches</a> · <a href="#install">Install</a> · <a href="#find-out-in-a-minute">In a minute</a> · <a href="#how-it-works">How it works</a> · <a href="#faq">FAQ</a> · <a href="https://github.com/minjund/hoochi/releases">Releases</a>
</p>

<p align="center">
  <b>English</b> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">中文</a>
</p>

<p align="center">
  <img src="assets/why.png" width="920" alt="The hoochi window in light and dark: the hooks not working, each with its reason, and one of them opened with every check it went through and what it printed" />
</p>

```sh
claude plugin install hoochi --marketplace minjund/hoochi
```

---

You put in a hook and nothing happens. Did the moment never come? Did a project rule hide it? Is the tool
name `edit` instead of `Edit`? Did the command end with 127 because it is not installed? Claude Code does not
say. **hoochi does.**

It goes through each hook the way the agent does, in the same order: is it on, is its AI connected, does the
moment come, does it reach the chat you are in, do its tools match what came, can words reach the model
there, and how did its last run end. The first check that fails is the answer, in one sentence.

## What it catches

| Why it doesn't run | What hoochi says |
|---|---|
| A project or terminal has its own rule at that moment, so the one for everywhere is hidden there | Which place wins, and **Put it in … too** |
| The tool name is in the wrong case, written as `Edit\|Write`, or the other AI's name (Codex calls any file edit `apply_patch`) | *Tool names match case too: "edit" should be "Edit"* |
| A matcher that none of the tools that came matches | The matcher and the tools that did come |
| Words at a moment the model never hears (the chat ending, before compacting) | *Only commands run here* |
| The command was not found, timed out, or failed | How it ended, and what it printed |
| A plugin's hook failing quietly, or timing out | Read from what Claude Code itself recorded of each run |
| Codex's hooks not connected | One button to connect them |
| A Team or Enterprise account that never passes a moment to plugins | Which moments, dimmed |

The Lifecycle page opens with the hooks not working, worst first. Press one to see every check it went through.
Or ask in words on the other tab, "why doesn't the lint hook run?" or "what's broken?": the answer lists each
rule with how it is doing, and you can switch it off, fix it or delete it right there.

## What it does

- **Why it doesn't run, check by check.** For the rules you put in with hoochi and the hooks already set up in your settings and plugins.
- **Every run recorded.** How each command ended, how long it took, and what it printed when it failed.
- **Fix it where you see it.** Switch, edit in a popup, or say it: "use pnpm for the tests", "put this in Codex too".
- **Every moment at a glance.** Your agent's whole flow as one picture; the moment that just happened lights up.
- **Everywhere · per project · per terminal.** The narrowest place wins, and the page tells you when it does.
- **Follows where you chat.** The window switches to the terminal you are typing in, and its project.
- **/context, live.** How full the chat is and how far to auto-compact, inside the picture.
- **Skills on and off.** Switch off the skills you never use and save room.
- **One-button updates.** Even chats already open move to the new version by themselves.
- **Light and quiet.** A native app (not Electron) that uses next to no CPU while idle. Four languages, light and dark.

## Install

> **Used hookwich before?** It is now called hoochi. Install the new plugin, then remove the old one: `claude plugin install hoochi --marketplace minjund/hoochi`, then `claude plugin uninstall hookwich@hookwich`. The first chat with the new plugin moves what you put in from `~/.hookwich` to `~/.hoochi`, and the window points the Codex hooks at itself.

**1. The plugin**, in a terminal:

```sh
claude plugin install hoochi --marketplace minjund/hoochi
```

or inside Claude Code:

```
/plugin marketplace add minjund/hoochi
/plugin install hoochi@hoochi
```

**2. The window** downloads itself the first time you start a Claude Code chat (macOS 11 or later, Apple silicon
and Intel). To install it by hand:

```sh
mkdir -p ~/.hoochi && cd ~/.hoochi
curl -fsSLO https://github.com/minjund/hoochi/releases/latest/download/Hoochi-macos-arm64.zip
curl -fsSL https://github.com/minjund/hoochi/releases/latest/download/Hoochi-macos-arm64.zip.sha256 | shasum -a 256 -c
ditto -x -k Hoochi-macos-arm64.zip . && open Hoochi.app
```

**3. Codex (optional).** On the window's Codex tab press **Connect Codex**, then type `/hooks` once in Codex and
trust the hoochi hooks.

**Updating:** press **Update** at the top of the window, or run `claude plugin update hoochi@hoochi`. Chats
already open reload into the new version within seconds (from 0.1.16 on; coming from an older version, type
`/reload-plugins` once in each open chat). A chat opened before hoochi was installed has no hoochi in it: start
it again (`claude --continue` picks the conversation back up).

## Find out in a minute

1. Start a Claude Code chat. When the 🥪 bubble appears at the bottom right, click it.
2. The **Lifecycle** page opens on what is not working. Nothing there? Every hook passed every check.
3. Press a row: every check it went through, the one that stops it in red, and what it printed.
4. Fix it there (switch, edit, **Put it in … too**), or on **Say it in words**.

To add a hook, say it: "run `npm test` when the answer ends, only if it fails". Or press a moment in the picture,
pick **Command**, type `npm test`, choose **Only if it fails** and **Save**.

Type `/hoochi` to show or hide the window. `×` folds it into the bubble; right-click the bubble to hide it in the menu bar.

## How it works

<p align="center">
  <img src="assets/how-it-works.en.svg" width="920" alt="How hoochi works: at each moment the agent reads what you put in from ~/.hoochi and records what happened, and the window shows it" />
</p>

- The files, all in `~/.hoochi`: `config.json` (what you put in), `activity-*.json` (what just happened), `places.json` (projects and
  terminals seen), `parked.json` (hooks switched off), `once-*.json` (once-per-chat items each chat already ran), `context/` (/context per terminal). Any settings file hoochi changes is backed up
  first in `~/.hoochi/backups/`.
- How a hook did: the plugin and the Codex hook record each run of what you put in (`runs` in `activity-*.json`). For hooks
  set up elsewhere, the window reads the run records Claude Code writes in each chat's transcript
  (`~/.claude/projects/*/*.jsonl`, the newest 40 of the last 3 days), and never writes there.

## FAQ

**Is it safe?** A command you put in runs on your computer, with your permissions, each time its moment comes.
Only put in commands you would run yourself. Commands stop after 30 seconds.

**Does it slow the agent down?** Words and skills go in at once. A command takes as long as it runs.

**macOS warns when I open it.** The app is ad-hoc signed but not notarized by Apple. Downloaded with `curl` (as the
plugin does) it just opens. If you downloaded it in a browser, right-click `Hoochi.app` and choose **Open** once.

**Does it change my existing hooks?** Only when you switch one off or back on, and always with a backup. Codex hooks
are switched in place, the same way Codex's `/hooks` does.

**I have lots of skills; why is the list shorter?** The skills popup lists only what can be switched from there.
Skills synced from claude.ai are switched on claude.ai, and a plugin's skills switch only with the whole plugin, so
each plugin is one row.

**Does it see hooks hoochi did not make?** Yes. For Claude Code it reads how their runs ended from Claude Code's
own records of each chat. Codex keeps no record of the hooks it runs, so for Codex hooks set up elsewhere hoochi
can check how they are set up, not how they ran.

**Windows or Linux?** Not yet; the window is macOS only for now.

## For developers

```sh
git clone https://github.com/minjund/hoochi && cd hoochi
cd app && npm install
npm run tauri dev                                         # run the window
npm run tauri build -- --target universal-apple-darwin    # build Hoochi.app
npm test                                                  # the window's state machines
cd src-tauri && cargo test                                # the window (Rust)
cd ../.. && claude plugin test plugin                     # the plugin
```

- `plugin/` is the Claude Code side: a TypeScript mod using `classic.*` hooks, `prompt.submit` and `prompt.edit`,
  and the /context record.
- `app/` is the window: Tauri (Rust) + React + free [affectUI](https://www.affectui.com) components, and the Codex hook
  runner (`hoochi hook codex <Event>`). The window's states (saving, updating, notices, following) are written out
  in `app/src/lib/machines.ts`. Notes for coding agents are in [AGENTS.md](AGENTS.md).

Needs Node 23.6+, Rust and the Xcode command line tools.

## License

[MIT](LICENSE)
