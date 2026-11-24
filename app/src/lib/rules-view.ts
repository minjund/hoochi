/**
 * The "What you put in" page as data: every rule for both AIs at every place, one row each, with
 * what it means for the chat you are in (it goes in, a narrower place hides it, or it is not about
 * this chat), when it last ran, and what is wrong with it. Rows are filtered and grouped by moment
 * in the order a chat goes through them, Codex's own moments in their place.
 */
import { allTargets, type Target } from './edit.ts'
import { CLAUDE_SLOTS, CODEX_SLOTS, decidingScope, type Activity, type Agent, type Config, type Scope } from './lifecycle.ts'

/** The chat the window follows: its AI, project and terminal. */
export type Chat = { agent: Agent; project: string; terminal: string }

/** in: it goes in at this chat · hidden: a narrower place's rules win · other: not this chat's */
export type Reach = 'in' | 'hidden' | 'other'
export type Problem = 'hidden' | 'codex-off' | 'blocked'

export type Row = Target & {
  /** set only when there is a chat to look from */
  reach?: Reach
  /** for a hidden row: the place whose rules win */
  hiddenBy?: { scope: Scope; key: string }
  /** when it last ran (ms), from what the AI recorded */
  lastRun?: number
  problem?: Problem
}

export type View = {
  /** "chat": only the rules that reach the chat you are in; "all": every rule */
  mode: 'chat' | 'all'
  ai: Agent | 'all'
  /** "" every place, else "global", "project:<path>", "terminal:<key>" */
  place: string
  off: boolean
  problems: boolean
}

export const placeId = (r: { scope: Scope; key: string }) => (r.scope === 'global' ? 'global' : `${r.scope}:${r.key}`)

/** Both AIs' moments in one order: Claude Code's, with each Codex-only one after the moment Codex has before it. */
export function momentOrder(): string[] {
  const order = CLAUDE_SLOTS.map(s => s.event)
  let after = -1
  for (const s of CODEX_SLOTS) {
    const at = order.indexOf(s.event)
    if (at >= 0) after = at
    else order.splice(++after, 0, s.event)
  }
  return order
}

export function rowsOf(
  config: Config,
  o: { chat?: Chat; activity: Record<Agent, Activity>; codexOn: boolean; blocked: ReadonlySet<string> },
): Row[] {
  return allTargets(config).map(t => {
    const ran = o.activity[t.agent].recent.filter(f => f.id === t.item.id).map(f => f.at)
    const row: Row = { ...t, ...(ran.length ? { lastRun: Math.max(...ran) } : {}) }
    if (o.chat) {
      const c = o.chat
      const reaches =
        t.agent === c.agent &&
        (t.scope === 'global' || (t.scope === 'project' && t.key === c.project) || (t.scope === 'terminal' && t.key === c.terminal))
      if (!reaches) row.reach = 'other'
      else {
        const wins = decidingScope(config[t.agent], t.item.event, { project: c.project, terminal: c.terminal, terminalLabel: '' })
        if (wins === t.scope) row.reach = 'in'
        else {
          row.reach = 'hidden'
          if (wins) row.hiddenBy = { scope: wins, key: wins === 'project' ? c.project : wins === 'terminal' ? c.terminal : '' }
        }
      }
    }
    if (row.reach === 'hidden') row.problem = 'hidden'
    else if (t.agent === 'codex' && !o.codexOn) row.problem = 'codex-off'
    else if (t.agent === 'claude' && o.blocked.has(t.item.event)) row.problem = 'blocked'
    return row
  })
}

/** The rows a view shows; `words` is what the search box matches (moment, words, place). */
export function filterRows(rows: readonly Row[], v: View, query: string, words: (r: Row) => string): Row[] {
  const q = query.trim().toLowerCase()
  return rows.filter(
    r =>
      (v.mode === 'all' || r.reach === undefined || r.reach !== 'other') &&
      (v.ai === 'all' || r.agent === v.ai) &&
      (!v.place || placeId(r) === v.place) &&
      (!v.off || !r.item.enabled) &&
      (!v.problems || r.problem !== undefined) &&
      (!q || words(r).toLowerCase().includes(q)),
  )
}

/** Rows by moment, in the order a chat goes through them; within one, as they are listed. */
export function byMoment(rows: readonly Row[]): [string, Row[]][] {
  const order = momentOrder()
  const events = [...new Set(rows.map(r => r.item.event))].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return events.map(e => [e, rows.filter(r => r.item.event === e)])
}

/** The places the rules are in, everywhere first, for the filter chips. */
export function placesOf(rows: readonly Row[]): { scope: Scope; key: string }[] {
  const seen = new Map<string, { scope: Scope; key: string }>()
  for (const r of rows) seen.set(placeId(r), { scope: r.scope, key: r.key })
  const rank: Record<Scope, number> = { global: 0, project: 1, terminal: 2 }
  return [...seen.values()].sort((a, b) => rank[a.scope] - rank[b.scope])
}
