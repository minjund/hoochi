<p align="center"><img src="assets/icon.png" width="112" alt="hookwich icon"></p>

<h1 align="center">hookwich</h1>

<p align="center"><b>The hook sandwich for Claude Code.</b><br>
Put text, commands or skills before or after any moment of Claude Code's lifecycle,<br>
from a little window that floats in the corner of your screen.</p>

<p align="center"><a href="README.ko.md">한국어</a></p>

---

Claude Code runs in a loop: a session starts, you send a prompt, it calls tools, it stops.
Hooks let you step in at each of those moments, but writing them means editing JSON and shell scripts.

hookwich draws that loop as a stack of sandwiches. Each stage is the filling; the slot before it
and the slot after it are the bread. Click `+` on a slot and put something in:

| Put in | What happens |
|---|---|
| **Text** | Handed to the model at that moment. *"Answer in English."* before every prompt. |
| **Command** | Runs in the session's folder; its output goes to the model — always, or only when it fails. `npm test` after the turn, only on failure, and Claude keeps fixing until it passes. |
| **Skill** | Asks the model to use one of your installed skills. `code-review` after the turn. |

Turn items on and off, limit tool slots to certain tools (`Bash, Edit`), or mark an item **Once**
so it switches itself off after it runs.

<p align="center"><img src="assets/screenshot.png" width="460" alt="The hookwich panel and its bubble"></p>

## The window

- Floats above everything, folded into a 🥪 bubble in the bottom-right corner.
- Click to unfold, drag to move it anywhere.
- `–` folds it back, `×` hides it to the menu bar; click the menu bar icon to bring it back.
- The slot that just fired lights up, and the last few things hookwich put in are listed at the bottom.

## Install

**1. The plugin** — at the Claude Code prompt (answer `y` to add the marketplace, then pick a scope):

```
/plugin install hookwich --marketplace minjund/hookwich
```

From a shell: `claude plugin install hookwich --marketplace minjund/hookwich`

**2. The window app (macOS)** — the plugin downloads it from the latest
[release](https://github.com/minjund/hookwich/releases) the first time a session starts, checks its
SHA-256, and opens it. You can also build it yourself (below).

Then `/hookwich` shows or hides the window (`/hookwich show`, `/hookwich hide`).

## How it works

```
  ┌───────────────┐   writes config.json    ┌────────────────────────┐
  │ hookwich app  │ ──────────────────────▶ │ ~/.hookwich/           │
  │ (Tauri)       │ ◀────────────────────── │  config.json           │
  └───────────────┘   reads activity.json   │  activity.json         │
          ▲            control.json ─────▶  │  control.json          │
          │ show/hide                       └───────────┬────────────┘
          │                                             │ read on every hook event
          │                                 ┌───────────▼────────────┐
          └──────────── /hookwich ───────── │ hookwich plugin        │
                                            │ (Claude Code mod)      │
                                            └────────────────────────┘
```

- **plugin/** — a Claude Code mod. It hooks every lifecycle event (`classic.*`), lets your existing
  settings hooks run first, then adds the enabled items to the event's answer. On `Stop` and
  `SubagentStop` it asks Claude to keep going once, never twice in the same turn.
- **app/** — the window: Tauri (Rust) + React + [affectUI](https://www.affectui.com) free components.
  It only edits the config; it never talks to Claude directly.

Events where the model can't hear anything (session end, notifications, compaction…) accept
commands only, for their side effects.

## Build from source

Requires Node 20+, Rust (stable) and Xcode command line tools.

```sh
cd app
npm install
npm run tauri dev        # run the window
npm run tauri build      # build Hookwich.app
```

Plugin tests: `claude plugin test plugin`.

## Safety

Command items run shell commands on your machine every time their event fires — the same power as a
settings hook. Only put in commands you'd run yourself. A command gets 30 seconds, then it is stopped.

## Credits

UI components from [affectUI](https://www.affectui.com) (free items, MIT) and icons from
[Hugeicons Free](https://hugeicons.com) (MIT). The bubble and lifecycle components were written with Codex.

## License

MIT
