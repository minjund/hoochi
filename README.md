<p align="center"><img src="assets/icon.png" width="112" alt="hookwich icon"></p>

<h1 align="center">hookwich</h1>

<p align="center"><b>Tell Claude Code or Codex what to do at the exact moment you want.</b><br>
A little window in the corner of your screen shows every moment of Claude's work as a picture.<br>
Tap a moment, and add a sentence, a command or a skill there.</p>

<p align="center"><b>English</b> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">中文</a></p>

---

## What is it for?

When Claude Code works, the same moments come around again and again: the chat starts, you send a
message, Claude uses a tool (runs a command, edits a file), Claude finishes its answer…

hookwich lets you attach something to any of those moments, without writing code.

| You add | What happens | Example |
|---|---|---|
| **Words** | Claude reads them at that moment. | Every time you send a message: *"Please answer in English."* |
| **A command** | It runs on your computer. Claude can read the result — always, or only when it fails. | When Claude finishes answering: `npm test`, only if it fails — Claude keeps fixing until the tests pass. |
| **A skill** | Claude is asked to use one of your installed skills. | When Claude finishes answering: `code-review`. |

You can turn each one on or off, pick **Just once** so it switches itself off after one run, and for
tool moments choose which tools it applies to.

<p align="center"><img src="assets/screenshot.png" alt="The hookwich window in four languages"></p>

## Where it applies

Each thing you add lives in one of three places:

- **Everywhere** — every chat.
- **This project** — only chats opened in that project folder.
- **This terminal** — only that terminal window or tab, even after you restart Claude Code or Codex in it.

For each moment, the closest one wins: this terminal, otherwise this project, otherwise everywhere.
A switched-off item still counts, so you can quiet an "everywhere" item in one project.
Project and terminal settings are kept on your computer only, never inside the project.

Buttons under the tabs copy between places without overwriting anything (what is already there is
skipped, and **Undo** takes the last copy back): **Load "Everywhere"**, **Load this project** (in a
terminal), **Apply to all projects** and **Apply to "Everywhere"**.

When the window follows where you chat, a terminal in a project folder opens on **This project**, and
one outside any project opens on **Everywhere**.

Hooks you already have — in Claude Code's settings, in plugins (often a skill run by a hook) or in
Codex's `hooks.json` — show as a **grey number** at the top left of each moment, and by name when
you open it. Black numbers are what you added with hookwich.

## Claude Code and Codex

The window has a tab for each. Codex has its own picture of its moments (before asking the model,
before a tool, when the answer ends…). To use the Codex tab, press **Connect Codex** once: hookwich
adds itself to the end of `~/.codex/hooks.json` (your other hooks stay as they are, and a backup is
saved next to it). Then type `/hooks` in Codex once and trust the hookwich hooks.
**Disconnect** takes them out again.

## The window

- It floats above other windows as a small 🥪 bubble in the bottom-right corner. Drag it anywhere.
- Click the bubble to open the picture of Claude's work. It is drawn after the official
  [Claude Code hooks lifecycle figure](https://code.claude.com/docs/en/hooks#hook-lifecycle).
- Click any box to add something there. A number on a box shows how many things are on.
- The moment that just happened lights up, so you can watch Claude work.
- **Follow where I chat** (on by default): the window switches by itself to the AI (Claude Code or Codex),
  project and terminal you last typed in. Picking a tab or a terminal yourself turns it off.
- Moments that have no fixed place in the order (a notification, a settings change, a model switch…)
  sit together in an **Anytime** band under the picture.
- `–` folds it back into the bubble. `×` hides it; it waits in the menu bar at the top of the screen.
- Languages: English, 한국어, 日本語, 中文. It follows your computer's language; change it at the top.

## Install

**1. The plugin.** Type this in Claude Code, then answer `y` and pick where to install it:

```
/plugin install hookwich --marketplace minjund/hookwich
```

From a terminal instead: `claude plugin install hookwich --marketplace minjund/hookwich`

**2. The window (macOS).** The first time a Claude Code chat starts, the plugin downloads the window
from the [releases page](https://github.com/minjund/hookwich/releases), checks that the file is
genuine, and opens it.

Type `/hookwich` to show or hide the window.

## Is it safe?

A command you add runs on your computer every time its moment comes, with the same rights as you.
Only add commands you would run yourself. A command is stopped after 30 seconds.

## For developers

- `plugin/` — the Claude Code part. At every moment (a "hook event") it lets your existing hooks run
  first, then adds what is switched on. When Claude is about to finish, it asks Claude to keep going
  at most once per answer, so it never loops.
- `app/` — the window: Tauri (Rust) + React + free [affectUI](https://www.affectui.com) components.
- Both share three files in `~/.hookwich/`: `config.json` (what you added), `activity.json` (what just
  happened) and `control.json` (show/hide).

Build it yourself (needs Node 20+, Rust and the Xcode command line tools):

```sh
cd app && npm install
npm run tauri dev      # run the window
npm run tauri build    # make Hookwich.app
claude plugin test plugin   # test the plugin
```

## Credits

The picture of Claude's work is hookwich's own drawing of the layout of the official
[Claude Code hooks lifecycle figure](https://code.claude.com/docs/en/hooks#hook-lifecycle); the
figure's file is not included. UI parts from [affectUI](https://www.affectui.com) (free items, MIT),
icons from [Hugeicons Free](https://hugeicons.com) (MIT). The bubble and the picture were built with
Codex.

## License

MIT
