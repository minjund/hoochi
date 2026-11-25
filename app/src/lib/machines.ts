/**
 * The window's small state machines, written out: which states each flow can be in and what
 * each event moves it to. They are pure (timers and writes are passed in), so
 * `npm test` (app/tests/machines.test.ts) checks every transition without a window.
 * App.tsx holds the current state and puts it on the page as data-* attributes
 * (data-view, data-save, data-update, data-follow, data-notice) for tests and agents to read.
 */

// ---------- Saving your edits ----------

/**
 * saved   → nothing of yours waits; what is on disk may replace what is shown
 * waiting → an edit waits out the short delay before it is written
 * writing → being written
 * failed  → the write failed; the edit is kept on screen (the disk does not replace it) until a
 *           retry or the next edit writes it
 */
export type SaveStatus = 'saved' | 'waiting' | 'writing' | 'failed'

export type Timers = {
  set(run: () => void, ms: number): number
  clear(id: number | undefined): void
}

const windowTimers: Timers = {
  set: (run, ms) => window.setTimeout(run, ms),
  clear: id => window.clearTimeout(id),
}

export type Saver<T> = {
  /** Shows `value` as yours and writes it after the delay; a newer save replaces a waiting one. */
  save(value: T): void
  /** Writes the kept edit again after a failure. */
  retry(): void
  /**
   * What the disk holds now (as text). True when it should replace what is shown: nothing of
   * yours waits to be written, and it is not what was last read or written.
   */
  fromDisk(text: string): boolean
  status(): SaveStatus
}

export function createSaver<T>(o: {
  write(value: T): Promise<void>
  /** the text `fromDisk` compares against, for a value written */
  key(value: T): string
  delay: number
  onStatus(status: SaveStatus, error?: string): void
  timers?: Timers
}): Saver<T> {
  const timers = o.timers ?? windowTimers
  let status: SaveStatus = 'saved'
  let pending: { value: T } | null = null // yours, not written yet
  let known = ''
  let timer: number | undefined
  let gen = 0 // bumps on every save, so a finished write knows whether a newer edit came
  let writing = false

  const set = (next: SaveStatus, error?: string) => {
    status = next
    o.onStatus(next, error)
  }

  const flush = () => {
    timers.clear(timer)
    timer = undefined
    // One write at a time, so an older write can never land after a newer one.
    if (writing || !pending) return
    const mine = gen
    const { value } = pending
    writing = true
    set('writing')
    o.write(value).then(
      () => {
        writing = false
        known = o.key(value)
        if (mine === gen) {
          pending = null
          set('saved')
        } else if (timer === undefined) flush() // a newer edit's delay ran out while this wrote
      },
      (err: unknown) => {
        writing = false
        if (mine === gen) set('failed', String(err))
        else if (timer === undefined) flush()
      },
    )
  }

  return {
    save(value) {
      pending = { value }
      gen += 1
      timers.clear(timer)
      timer = timers.set(flush, o.delay)
      set('waiting')
    },
    retry() {
      if (status === 'failed') flush()
    },
    fromDisk(text) {
      if (pending || text === known) return false
      known = text
      return true
    },
    status: () => status,
  }
}

// ---------- Updating hoochi ----------

export type UpdateInfo = { current: string; latest: string | null; available: boolean }

/**
 * unknown    → not looked yet (or the look failed)
 * current    → this is the newest
 * available  → a newer one is out; `error` says why the last try did not work
 * installing → the Update button was pressed
 * reopening  → installed; this window quits and the new one opens
 */
export type UpdateFlow =
  | { step: 'unknown' }
  | { step: 'current'; info: UpdateInfo }
  | { step: 'available'; info: UpdateInfo; error?: string }
  | { step: 'installing'; info: UpdateInfo }
  | { step: 'reopening'; info: UpdateInfo }

export type UpdateEvent =
  | { type: 'checked'; info: UpdateInfo }
  | { type: 'install' }
  | { type: 'installed' }
  /** the update failed, or the window did not reopen in time */
  | { type: 'failed'; error: string }

/** How long "reopening" may last before the window says it did not reopen. */
export const REOPEN_MS = 20_000

export function updateFlow(state: UpdateFlow, event: UpdateEvent): UpdateFlow {
  switch (event.type) {
    case 'checked': {
      // A look that comes back mid-update changes nothing.
      if (state.step === 'installing' || state.step === 'reopening') return state
      const { info } = event
      if (!info.available || !info.latest) return { step: 'current', info }
      // The reason it failed is kept only while it is still about the same version.
      const error = state.step === 'available' && state.info.latest === info.latest ? state.error : undefined
      return error ? { step: 'available', info, error } : { step: 'available', info }
    }
    case 'install':
      return state.step === 'available' ? { step: 'installing', info: state.info } : state
    case 'installed':
      return state.step === 'installing' ? { step: 'reopening', info: state.info } : state
    case 'failed':
      return state.step === 'installing' || state.step === 'reopening'
        ? { step: 'available', info: state.info, error: event.error }
        : state
  }
}

/** "0.1.16" is at least "0.1.9": numbers compared part by part. */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = a.split('.').map(n => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++)
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return true
}

/**
 * The first plugin that reloads the chats already open once a newer hoochi is installed.
 * Updating from an older one, those chats still run code without it: /reload-plugins by hand, once.
 */
export const AUTO_RELOAD_FROM = '0.1.16'

/**
 * What the note after an update says about the plugin. `renamed`: updated from a Hookwich window,
 * so the plugin changed name too, and the chats open run the old one, which cannot reload itself.
 */
export function pluginNote(updated: { from: string; plugin: boolean; renamed?: boolean }): 'auto' | 'once' | 'by-hand' {
  if (!updated.plugin) return 'by-hand'
  if (updated.renamed) return 'once'
  return versionAtLeast(updated.from, AUTO_RELOAD_FROM) ? 'auto' : 'once'
}

// ---------- The notice under the buttons ----------

/**
 * One notice at a time. `undo` puts back the whole config as it was before an action, so it ends
 * as soon as anything else changes the config (an undo then would throw that change away).
 * `error` says what did not work and has nothing to undo.
 */
export type Notice<T> =
  | { kind: 'undo'; message: string; before: T; near: 'controls' | 'list' }
  | { kind: 'error'; message: string }
  /** something done that has no undo of its own, or nothing to do: said, then gone */
  | { kind: 'info'; message: string; near?: 'controls' | 'list' }

export const NOTICE_MS = { undo: 12_000, error: 10_000, info: 8_000 } as const

/** After any other change to the config: an undo would no longer be right. */
export function afterChange<T>(notice: Notice<T> | null): Notice<T> | null {
  return notice?.kind === 'undo' ? null : notice
}

/** Where the notice shows: inside an open popup (so it is not hidden behind it), else in place. */
export function noticePlace<T>(
  notice: Notice<T> | null,
  modal: string | null,
): 'modal' | 'controls' | 'list' | null {
  if (!notice) return null
  if (modal) return 'modal'
  return notice.kind === 'undo' ? notice.near : notice.kind === 'info' ? (notice.near ?? 'controls') : 'controls'
}

// ---------- Asking before a change to many items ----------

/**
 * none   → nothing waits for a yes
 * asking → deleting many items at once (a project's items or all of them) waits for a yes;
 *          nothing is done yet. Copying does not ask: the send sheet shows what it will do first,
 *          and an undo follows.
 *
 * Yes runs it once and ends the ask. No, Esc, closing the popup, another ask, a scope change or
 * any change to the config ends it unrun: what it would do was worked out on the config as it was.
 */
export type Ask = {
  /** what will happen, in a sentence that names how many and where */
  message: string
  /** the yes button's label */
  yes: string
  /** deleting: the yes button is red */
  danger: boolean
  /** shown under the scope buttons, or inside the "what you put in" popup */
  near: 'controls' | 'modal'
  run(): void
}

export type AskEvent = { kind: 'ask'; ask: Ask } | { kind: 'yes' } | { kind: 'no' } | { kind: 'changed' }

/** The ask after `event`, and what to run now (only on a yes to an open ask). */
export function askFlow(state: Ask | null, event: AskEvent): { state: Ask | null; run?: () => void } {
  if (event.kind === 'ask') return { state: event.ask }
  if (event.kind === 'yes' && state) return { state: null, run: state.run }
  return { state: null }
}

// ---------- Following where you chat ----------

/**
 * on     → follows the chat you type in
 * paused → a moment is open; follows again when you go back to the workflow
 * held   → you moved the window yourself (another place, AI or project); follows again once you
 *          chat somewhere.
 * busy   → input reached more than one place within BUSY_MS (agents run in several terminals at
 *          once: a tool that types into terminals looks to Claude Code like you typing). The window
 *          stays where it is; it follows again at the next input that comes alone.
 * There is no switch: the window always follows, in the background.
 */
export type FollowState = 'on' | 'paused' | 'held' | 'busy'

export function followState(editing: boolean, held = false, busy = false): FollowState {
  return editing ? 'paused' : held ? 'held' : busy ? 'busy' : 'on'
}

/** How close together inputs in two places must come to count as several places at once. */
export const BUSY_MS = 20_000

/** One input the window saw: where you (or a tool typing for you) chatted, and when. */
export type Input = { terminal: string; at: number }

/** The inputs seen, with `next` added once; only those within BUSY_MS of the newest are kept. */
export function noteInput(seen: readonly Input[], next: Input): Input[] {
  if (seen.some(i => i.terminal === next.terminal && i.at === next.at)) return [...seen]
  const all = [...seen, next]
  const newest = Math.max(...all.map(i => i.at))
  return all.filter(i => newest - i.at <= BUSY_MS)
}

/** The places that got input within BUSY_MS of the newest input. Two or more: busy. */
export function busyPlaces(seen: readonly Input[]): string[] {
  if (seen.length === 0) return []
  const newest = Math.max(...seen.map(i => i.at))
  return [...new Set(seen.filter(i => newest - i.at <= BUSY_MS).map(i => i.terminal))]
}
