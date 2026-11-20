# hookwich: notes for agents

- `plugin/` is the Claude Code plugin (a mod: `hooks/register.ts`). It writes what the window reads under `~/.hookwich/`.
- `app/` is the window: React in `app/src`, Tauri (Rust) in `app/src-tauri`.
- The main moments (chat start/end, prompt, before/after a tool, Stop, SubagentStop) are served from Claude Code's own events (`prompt.submit`, `tool.call`, `turn.complete`, `session.start`/`end`/`compact`), listed in `NATIVE` in `register.ts`. On Team and Enterprise accounts the built-in `sec-default` plugin passes every `classic.*` event on beneath a person's plugins, so the classic hook only serves the other moments, and skips the native ones so nothing goes in twice.

## The window's states

The window's flows are written out as pure functions in `app/src/lib/machines.ts`. Each one lists its states and what moves it from one to the next.

| Flow | States | On the page |
| --- | --- | --- |
| Saving your edits (`createSaver`) | saved, waiting, writing, failed | `.hw-panel[data-save]` |
| Updating hookwich (`updateFlow`) | unknown, current, available (+error), installing, reopening | `.hw-panel[data-update]` |
| The notice (`Notice`) | undo, error | `[data-notice]` |
| Following where you chat (`followState`), always on with no switch | on, paused, held; the tab goes to "this project" or "everywhere" | `[data-follow]` |
| Which screen | bubble, picture, editor | `[data-view]` |
| The popup (`Modal` in App.tsx) | mine, skills, none | `.hw-panel[data-modal]` |
| An item being edited (`ItemCard` in slot-editor.tsx) | saved, unsaved (Save writes it) | `.hw-item[data-unsaved]` |

Rules these flows keep:

- One write at a time.
- A failed save stays on screen: the file on disk does not replace it until a retry writes it.
- An undo ends as soon as anything else changes the config.
- Only one popup is open at a time, and a notice shows inside it.

To add a state, change `machines.ts` first and add its case to `app/tests/machines.test.ts`.

## Checks

```sh
cd app && npm test && npx tsc -b && npx eslint src/App.tsx src/lib src/components/hookwich tests
cd app/src-tauri && cargo test
claude plugin test plugin && claude plugin validate plugin
```

`components/ui` is a vendored copy of affectUI and has lint errors of its own, so lint only the paths above.

The browser demo runs without Tauri and keeps everything in localStorage:

- `npx vite build`, then `python3 -m http.server <port> -d dist`
- Open `/?demo&panel&lang=ko`.
- Add flags as needed: `&update`, `&select=SessionStart`, `&agent=codex`, `&scope=project`.
