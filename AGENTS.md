# hoochi: notes for agents

- `plugin/` is the Claude Code plugin (a mod: `hooks/register.ts`). It writes what the window reads under `~/.hoochi/`.
- `app/` is the window: React in `app/src`, Tauri (Rust) in `app/src-tauri`.
- The main moments (chat start/end, prompt, before/after a tool, Stop, StopFailure, SubagentStart/Stop, Pre/PostCompact, PostModelSwitch) are served from Claude Code's own events (`prompt.submit`, `tool.call`, `turn.complete`, `agent.spawn`, `session.start`/`end`/`compact`), listed in `NATIVE` in `register.ts`. After changing model has no event of its own: the plugin compares the model at each prompt and puts its words in with the next one. On Team and Enterprise accounts the built-in `sec-default` plugin passes every `classic.*` event on beneath a person's plugins, so the classic hook only serves the moments in `CLASSIC_ONLY`, and hoochi does not hook the native ones so nothing goes in twice.
- Where the classic hooks never arrive (two answers in a row with no `classic.MessageDisplay`), the plugin writes `~/.hoochi/classic-claude.json` as `blocked`, and the window dims the `CLASSIC_ONLY` moments (kept in `app/src/lib/lifecycle.ts` too; `app/tests/reach.test.ts` checks the two lists match).
- hoochi was called hookwich before 0.1.28. The plugin moves `~/.hookwich` to `~/.hoochi` once (`moveOldFolder`) and shows a toast while `hookwich@hookwich` is still installed. The window points Codex hooks that run another copy at itself (`codex::repoint`), and still counts the entries and the plugin under the old name as its own. An old Hookwich window's Update button downloads `Hookwich-macos-<arch>.zip`, so every release also ships the same window zipped as `Hookwich.app` under that name; opened from `~/.hookwich/Hookwich.app`, the window moves the folder and itself to `~/.hoochi/Hoochi.app`, installs the hoochi plugin, removes the hookwich one and opens again (`app/src-tauri/src/rename.rs`). Chats opened before that keep the old plugin until they reload, so the old names stay as links: `~/.hookwich` → `~/.hoochi` (the plugin's move and the window both leave it; a `~/.hookwich` an old chat wrote again with records only is replaced by it) and `~/.hoochi/Hookwich.app` → `Hoochi.app` (the old plugin opens this window instead of downloading its own).

## The window's states

The window's flows are written out as pure functions in `app/src/lib/machines.ts`. Each one lists its states and what moves it from one to the next.

| Flow | States | On the page |
| --- | --- | --- |
| Saving your edits (`createSaver`) | saved, waiting, writing, failed | `.hw-panel[data-save]` |
| Updating hoochi (`updateFlow`) | unknown, current, available (+error), installing, reopening | `.hw-panel[data-update]` |
| The notice (`Notice`) | undo, error | `[data-notice]` |
| Asking before deleting many items (`askFlow`): a place's items or all of them | none, asking | `.hw-confirm[data-asking]` (`delete`) |
| Following where you chat (`followState`), always on with no switch | on, paused, held, busy (input reached two or more terminals within 20 s: a tool typing into terminals looks like you typing, so the window stays put; `noteInput` / `busyPlaces`); the tab goes to "this project" or "everywhere" | `[data-follow]` |
| Which screen | bubble, picture, editor | `[data-view]` |

The picture view shows the main moments as one-line cards (`MomentList` in `components/hoochi/moment-list.tsx`: chat start, your message, before/after a tool, answer ends, chat ends), then "Other moments you put something in" (only those with items here), then one button that opens `MomentPicker` ("When should it go in?": search, the common ones, "See all"); picking one opens it in the editor. The moments not in use stay out of sight. The full lifecycle picture is behind "See it as a flow" in the footer. While nothing at all is put in, `FirstSteps` offers a few ready-made items (dismissed for good once used or skipped, in localStorage `hoochi.firstStepsDone`). Each item in the editor ends with a one-sentence preview of what it will do (`t.preview`). Copying goes one way, out: "Send all of this place" at the top and "Put in other places too" on each saved item open the same sheet (what, then where). What a broader place puts in at a moment this place has its own items for does not reach here (the narrowest place wins), so the card says so and offers "Add here too" (`hiddenHere` in `app/src/lib/copy.ts`). A card says "Just used" only when one of the items it shows ran (by item id in `activity.recent`), never because the moment ran somewhere else.
| The popup (`Modal` in App.tsx) | mine, skills, send, none | `.hw-panel[data-modal]` |
| An item being edited (`ItemCard` in slot-editor.tsx) | saved, unsaved (Save writes it) | `.hw-item[data-unsaved]` |

Rules these flows keep:

- One write at a time.
- A failed save stays on screen: the file on disk does not replace it until a retry writes it.
- An undo ends as soon as anything else changes the config.
- Deleting many items waits for a yes; any change to the config, the place or the popup ends the ask unrun. Copying does not ask: the send sheet (`components/hoochi/send-sheet.tsx`) shows what will happen in one sentence before you put it in, and an undo follows.
- Only one popup is open at a time, and a notice shows inside it.

To add a state, change `machines.ts` first and add its case to `app/tests/machines.test.ts`.

## Checks

```sh
cd app && npm test && npx tsc -b && npx eslint src/App.tsx src/lib src/components/hoochi tests
cd app/src-tauri && cargo test
claude plugin test plugin && claude plugin validate plugin
```

`components/ui` is a vendored copy of affectUI and has lint errors of its own, so lint only the paths above.

The browser demo runs without Tauri and keeps everything in localStorage:

- `npx vite build`, then `python3 -m http.server <port> -d dist`
- Open `/?demo&panel&lang=ko`.
- Add flags as needed: `&update`, `&select=SessionStart`, `&agent=codex`, `&scope=project`, `&blocked` (classic hooks blocked, as on a Team account).
