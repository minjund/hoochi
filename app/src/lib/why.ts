/**
 * "Why doesn't my hook run?" as data. A hoochi rule goes through the same checks the plugin (or
 * the Codex hook) makes before it puts anything in, in that order: is it on, is its AI connected,
 * does the moment come, does it reach the chat in view, do its tools match what came, can words
 * reach the model there, and how did it end the last time. A hook set up outside hoochi goes
 * through the ones that apply to it, with what Claude Code recorded of its runs. The first check
 * that fails is the answer; the screens put each check in words.
 */
import { itemFilled, slotOf, type Activity, type Agent, type Item, type ItemRun, type Run, type Scope, type Seen } from './lifecycle.ts'
import { CLAUDE_TOOL, CODEX_TOOL } from './understand.ts'

/** ok: passed · bad: this is why it does not run · warn: likely trouble · idle: nothing to tell yet */
export type Status = 'ok' | 'bad' | 'warn' | 'idle'

export type Check =
  | { key: 'on' }
  | { key: 'off' }
  /** nothing filled in: it puts nothing in, and does not hide the rules of wider places */
  | { key: 'empty' }
  | { key: 'plugin' }
  /** the plugin has never written anything: it is not installed, or no chat has run since */
  | { key: 'no-plugin' }
  | { key: 'codex-on' }
  | { key: 'codex-off'; installed: boolean }
  /** this account's policy plugin passes the moment's classic hook by */
  | { key: 'blocked' }
  | { key: 'came'; at?: number; tools: string[] }
  | { key: 'not-yet' }
  | { key: 'in' }
  | { key: 'hidden'; by?: { scope: Scope; key: string } }
  | { key: 'other' }
  | { key: 'tools-ok'; match: string }
  /** a name with "|" or ";" in it: hoochi splits on commas only, so it never matches */
  | { key: 'tools-format'; name: string }
  /** the name is another AI's (Codex calls every file edit apply_patch) */
  | { key: 'tools-ai'; name: string; right: string }
  | { key: 'tools-case'; name: string; right: string }
  | { key: 'tools-miss'; want: string[]; came: string[] }
  | { key: 'tools-unknown'; want: string[] }
  /** an outside hook's matcher against the tools that came */
  | { key: 'matcher-ok'; matcher: string }
  | { key: 'matcher-miss'; matcher: string; came: string[] }
  /** words at a moment where nothing reaches the model: only commands run there */
  | { key: 'mute' }
  | { key: 'put-in'; at: number; runs: number }
  | { key: 'ran'; run: Run; runs: number }
  /** "only when it fails": it failed, and Claude was told */
  | { key: 'reported'; run: Run }
  /** the command was not found or could not run (exit 126, 127) */
  | { key: 'not-found'; run: Run }
  | { key: 'exit'; run: Run }
  | { key: 'broken'; run: Run }
  | { key: 'timeout'; run: Run; limitMs?: number }
  | { key: 'cancelled'; run: Run }
  /** an outside hook that ended with 2: it stopped Claude on purpose */
  | { key: 'blocked-on-purpose'; run: Run }
  | { key: 'not-run' }
  /** an outside hook with no run in what Claude Code recorded lately */
  | { key: 'no-record' }
  /** Codex does not record the hooks it runs */
  | { key: 'codex-no-record' }
  | { key: 'failed-before'; run: Run; fails: number; runs: number }
  /** an outside hook's last 7 days, from what Claude Code recorded */
  | { key: 'week'; w: Week }
  /** it keeps failing: at a moment where Claude Code records failures only, it failed in the last 24 hours */
  | { key: 'often'; w: Week; run: Run; limitMs?: number }
  /** the other hooks at the same moment, over the same days: none failed (it is this hook), or all did (Claude Code or this computer) */
  | { key: 'peers'; event: string; others: number; failing: number }
  /** how long its runs took, against its time limit; near: close enough to be cut some day */
  | { key: 'took'; p50?: number; p90?: number; max: number; limitMs: number; timed: number; near: boolean }
  /** Claude Code does not wait for it, and records none of its runs */
  | { key: 'async' }
  /** no failure on record, and Claude Code records no runs that went well at this moment */
  | { key: 'quiet'; event: string }

export type Step = { status: Status; check: Check }

/** off: switched off · stuck: something stops it · failing: it runs and fails · warn · working · waiting: nothing stops it, it has not run yet */
export type Verdict = 'off' | 'stuck' | 'failing' | 'warn' | 'working' | 'waiting'

export type Why = { verdict: Verdict; steps: Step[]; /** the step that says why */ reason?: Step }

const RESULT_KEYS = new Set<Check['key']>(['not-found', 'exit', 'broken', 'timeout', 'cancelled', 'often'])

/** A hook's last 7 days as Claude Code recorded them (HookStat in backend.ts). */
export type Week = {
  /** runs on record, and of them those that went well (only where such runs are recorded) */
  runs: number
  ok: number
  /** ended with another code than 0 or 2, or timed out */
  fails: number
  timeouts: number
  fails24: number
  /** chats it failed in, and chats it has any record in */
  chats: number
  allChats: number
  /** failures on each of the last 7 days, oldest first (the last one is the last 24 hours) */
  days: number[]
  /** runs whose time is known (timeouts and cancels left out), and how long they took in ms */
  timed: number
  p50: number
  p90: number
  max: number
  limitMs?: number | null
  lastFailAt?: number | null
  /** the Claude Code version of the last failure */
  version?: string
  /** whether Claude Code records the runs that went well at this moment */
  recordsOk: boolean
}
export type HookStat = Week & { event: string; command: string }

/** A time limit counts as near once a run took this share of it. */
export const NEAR = 0.7
/** The time limit hoochi gives a command it runs (plugin and Codex hook alike). */
export const COMMAND_LIMIT_MS = 30_000
/** Claude Code's time limit for a command hook that sets none. */
export const defaultLimitMs = (event: string) => (event === 'UserPromptSubmit' ? 30_000 : 600_000)

function verdictOf(steps: Step[], on: boolean): Why {
  if (!on) return { verdict: 'off', steps, reason: steps.find(s => s.check.key === 'off') }
  const bad = steps.find(s => s.status === 'bad')
  if (bad) return { verdict: RESULT_KEYS.has(bad.check.key) ? 'failing' : 'stuck', steps, reason: bad }
  const warn = steps.find(s => s.status === 'warn')
  if (warn) return { verdict: 'warn', steps, reason: warn }
  const done = steps.some(s => s.status === 'ok' && ['ran', 'put-in', 'reported', 'blocked-on-purpose', 'quiet', 'week'].includes(s.check.key))
  return { verdict: done ? 'working' : 'waiting', steps }
}

/** Tool names as hoochi compares them: split on commas, as the plugin and the Codex hook do. */
export const toolNames = (tools: string) =>
  tools
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

/** What a tool filter says against the tools that came at that moment lately. */
export function toolCheck(tools: string, agent: Agent, came: readonly string[]): Step {
  const want = toolNames(tools)
  const odd = want.find(n => /[|;]/.test(n))
  if (odd) return { status: 'bad', check: { key: 'tools-format', name: odd } }
  const other = agent === 'codex' ? CODEX_TOOL : CLAUDE_TOOL
  const foreign = want.find(n => other[n] !== undefined && !came.includes(n))
  if (foreign) return { status: 'bad', check: { key: 'tools-ai', name: foreign, right: other[foreign] } }
  const match = want.find(n => came.includes(n))
  if (match) return { status: 'ok', check: { key: 'tools-ok', match } }
  for (const n of want) {
    const right = came.find(c => c.toLowerCase() === n.toLowerCase())
    if (right) return { status: 'bad', check: { key: 'tools-case', name: n, right } }
  }
  if (came.length === 0) return { status: 'idle', check: { key: 'tools-unknown', want } }
  return { status: 'warn', check: { key: 'tools-miss', want, came: [...came] } }
}

/** Whether a Claude Code matcher matches a tool: "" and "*" match all, else as a whole regex. */
export function matcherMatches(matcher: string, tool: string): boolean {
  const m = matcher.trim()
  if (m === '' || m === '*') return true
  try {
    return new RegExp(`^(?:${m})$`).test(tool)
  } catch {
    return m.split('|').includes(tool)
  }
}

/** How a command run ended, for an item put in with hoochi. */
export function runStep(item: Item, r: ItemRun): Step {
  const run = r.last
  if (item.kind !== 'command') return { status: 'ok', check: { key: 'put-in', at: run.at, runs: r.runs } }
  if (run.error !== undefined)
    return /time/i.test(run.error)
      ? { status: 'bad', check: { key: 'timeout', run } }
      : { status: 'bad', check: { key: 'broken', run } }
  if (run.exit === 126 || run.exit === 127) return { status: 'bad', check: { key: 'not-found', run } }
  if (run.exit !== undefined && run.exit !== 0)
    return item.mode === 'onFail'
      ? { status: 'ok', check: { key: 'reported', run } }
      : { status: 'warn', check: { key: 'exit', run } }
  return { status: 'ok', check: { key: 'ran', run, runs: r.runs } }
}

/** A command that took most of its time limit: it will be cut some day. */
function tookStep(max: number | undefined, limitMs: number, timed: number, p50?: number, p90?: number): Step | undefined {
  if (max === undefined || timed === 0 || max <= 0) return undefined
  const near = max >= limitMs * NEAR
  return { status: near ? 'warn' : 'idle', check: { key: 'took', max, limitMs, timed, near, ...(p50 !== undefined ? { p50 } : {}), ...(p90 !== undefined ? { p90 } : {}) } }
}

export type RuleContext = {
  activity: Activity
  codexOn: boolean
  codexInstalled: boolean
  /** Claude's moments this account never gets */
  blocked: ReadonlySet<string>
  /** from the chat in view: whether it goes in there */
  reach?: 'in' | 'hidden' | 'other'
  hiddenBy?: { scope: Scope; key: string }
  /** when it last ran, from the older records (`recent`), when there is no `runs` entry */
  lastRun?: number
}

/** Why a rule put in with hoochi runs, or does not. */
export function whyRule(agent: Agent, item: Item, o: RuleContext): Why {
  const steps: Step[] = []
  const add = (status: Status, check: Check) => steps.push({ status, check })
  add(item.enabled ? 'ok' : 'bad', item.enabled ? { key: 'on' } : { key: 'off' })
  if (!itemFilled(item)) add('bad', { key: 'empty' })

  if (agent === 'codex')
    add(o.codexOn ? 'ok' : 'bad', o.codexOn ? { key: 'codex-on' } : { key: 'codex-off', installed: o.codexInstalled })
  else add(o.activity.lastAt > 0 ? 'ok' : 'warn', { key: o.activity.lastAt > 0 ? 'plugin' : 'no-plugin' })

  const slot = slotOf(item.event, agent)
  const seen: Seen | undefined = o.activity.seen?.[item.event]
  if (agent === 'claude' && o.blocked.has(item.event)) add('bad', { key: 'blocked' })
  else if (seen) add('ok', { key: 'came', at: seen.at, tools: seen.tools })
  else if ((o.activity.counts[item.event] ?? 0) > 0) add('ok', { key: 'came', tools: [] })
  else add('idle', { key: 'not-yet' })

  if (o.reach === 'in') add('ok', { key: 'in' })
  else if (o.reach === 'hidden') add('bad', { key: 'hidden', by: o.hiddenBy })
  else if (o.reach === 'other') add('idle', { key: 'other' })

  if (slot?.hasTools && item.tools.trim() !== '') steps.push(toolCheck(item.tools, agent, seen?.tools ?? []))
  if (item.kind !== 'command' && slot && !slot.canInject) add('bad', { key: 'mute' })

  const runs = o.activity.runs?.[item.id]
  if (runs) {
    steps.push(runStep(item, runs))
    const last = steps[steps.length - 1].check.key
    if (item.kind === 'command' && last === 'ran') {
      const took = tookStep(runs.last.ms, COMMAND_LIMIT_MS, 1)
      if (took?.status === 'warn') steps.push(took)
    }
    if (runs.fail && runs.fail !== runs.last && last !== 'reported' && item.mode !== 'onFail')
      add('idle', { key: 'failed-before', run: runs.fail, fails: runs.fails, runs: runs.runs })
  } else if (o.lastRun) add('ok', { key: 'put-in', at: o.lastRun, runs: 1 })
  else add('idle', { key: 'not-run' })

  return verdictOf(steps, item.enabled)
}

/** A hook set up outside hoochi, as the steps need it (ExistingHook in backend.ts). */
export type OutsideHook = {
  event: string
  matcher: string
  off: boolean
  command?: string
  status?: string
  /** its time limit in seconds, when it sets one */
  timeout?: number | null
  /** Claude Code does not wait for it */
  async?: boolean
}
/** A run Claude Code recorded (HookRun in backend.ts). */
export type RecordedRun = {
  at: number
  session: string
  event: string
  on: string
  command: string
  result: 'ok' | 'error' | 'blocked' | 'timeout' | 'cancelled'
  exit?: number
  ms?: number
  limitMs?: number
  out?: string
  /** the folder the chat ran in, and its Claude Code version */
  cwd?: string
  version?: string
}

/** The recorded runs of one outside hook, newest first: by its command, or the line it shows while running. */
export function runsOf(hook: OutsideHook, runs: readonly RecordedRun[]): RecordedRun[] {
  const keys = [hook.command, hook.status].filter((k): k is string => !!k && k.trim() !== '')
  if (keys.length === 0) return []
  return runs.filter(r => r.event === hook.event && keys.includes(r.command)).sort((a, b) => b.at - a.at)
}

const asRun = (r: RecordedRun): Run => ({
  at: r.at,
  ...(r.exit !== undefined ? { exit: r.exit } : {}),
  ...(r.ms !== undefined ? { ms: r.ms } : {}),
  ...(r.out ? { out: r.out } : {}),
})

const isFail = (r: RecordedRun) => r.result === 'error' || r.result === 'timeout'

const keysOf = (hook: OutsideHook) => [hook.command, hook.status].filter((k): k is string => !!k && k.trim() !== '')

/** One outside hook's week: the numbers of its command and of the line it shows while running, together. */
export function weekOf(hook: OutsideHook, stats: readonly HookStat[]): Week | undefined {
  const keys = keysOf(hook)
  const mine = stats.filter(s => s.event === hook.event && keys.includes(s.command))
  if (mine.length === 0) return undefined
  const sum = (k: 'runs' | 'ok' | 'fails' | 'timeouts' | 'fails24' | 'chats' | 'allChats' | 'timed') =>
    mine.reduce((n, s) => n + s[k], 0)
  const most = mine.reduce((a, b) => (b.timed > a.timed ? b : a))
  const lastFail = mine.reduce<HookStat | undefined>((a, b) => ((b.lastFailAt ?? 0) > (a?.lastFailAt ?? 0) ? b : a), undefined)
  return {
    runs: sum('runs'),
    ok: sum('ok'),
    fails: sum('fails'),
    timeouts: sum('timeouts'),
    fails24: sum('fails24'),
    chats: sum('chats'),
    allChats: sum('allChats'),
    days: mine[0].days.map((_, i) => mine.reduce((n, s) => n + (s.days[i] ?? 0), 0)),
    timed: sum('timed'),
    p50: most.p50,
    p90: most.p90,
    max: Math.max(...mine.map(s => s.max)),
    limitMs: Math.max(0, ...mine.map(s => s.limitMs ?? 0)) || null,
    lastFailAt: lastFail?.lastFailAt ?? null,
    version: lastFail?.version || undefined,
    recordsOk: mine.some(s => s.recordsOk),
  }
}

/** Its time limit in ms: as it sets it, else as Claude Code recorded it, else Claude Code's default. */
export const limitOf = (hook: OutsideHook, w?: Week) =>
  hook.timeout ? hook.timeout * 1000 : w?.limitMs || defaultLimitMs(hook.event)

/** Why a hook set up outside hoochi runs, or does not. */
export function whyOutside(
  agent: Agent,
  hook: OutsideHook,
  o: {
    activity: Activity
    runs: readonly RecordedRun[]
    /** each hook's last 7 days; without them only the recorded runs are looked at */
    stats?: readonly HookStat[]
    /** the other hooks at the same moment: how many run there, and how many of them failed in the same days */
    peers?: { others: number; failing: number }
  },
): Why {
  const steps: Step[] = []
  const add = (status: Status, check: Check) => steps.push({ status, check })
  add(hook.off ? 'bad' : 'ok', hook.off ? { key: 'off' } : { key: 'on' })

  const seen = o.activity.seen?.[hook.event]
  if (seen) add('ok', { key: 'came', at: seen.at, tools: seen.tools })
  const slot = slotOf(hook.event, agent)
  const m = hook.matcher.trim()
  const mine = agent === 'claude' ? runsOf(hook, o.runs) : []
  if (slot?.hasTools && m !== '' && m !== '*') {
    const came = [...new Set([...(seen?.tools ?? []), ...o.runs.filter(r => r.event === hook.event && r.on).map(r => r.on)])]
    const hit = came.some(t => matcherMatches(m, t)) || mine.length > 0
    if (hit) add('ok', { key: 'matcher-ok', matcher: m })
    else if (came.length > 0) add('warn', { key: 'matcher-miss', matcher: m, came: came.slice(0, 6) })
  }

  const w = agent === 'claude' && o.stats ? weekOf(hook, o.stats) : undefined
  const limitMs = limitOf(hook, w)
  if (agent === 'codex') add('idle', { key: 'codex-no-record' })
  else if (hook.async && !w) add('idle', { key: 'async' })
  else if (o.stats && !w?.recordsOk && !hook.async) {
    // Only failures are on record here: the last recorded run is the last failure, not the last run.
    const lastFail = mine.find(isFail)
    if (w && w.fails24 > 0 && lastFail) add('bad', { key: 'often', w, run: asRun(lastFail), limitMs: lastFail.limitMs ?? limitMs })
    else if (w && w.fails > 0) {
      add('idle', { key: 'week', w })
    } else add('idle', { key: 'quiet', event: hook.event })
  } else if (mine.length === 0) add('idle', { key: 'no-record' })
  else {
    const last = mine[0]
    const run = asRun(last)
    if (last.result === 'ok') add('ok', { key: 'ran', run, runs: mine.length })
    else if (last.result === 'blocked') add('ok', { key: 'blocked-on-purpose', run })
    else if (last.result === 'timeout') add('bad', { key: 'timeout', run, limitMs: last.limitMs })
    else if (last.result === 'cancelled') add('warn', { key: 'cancelled', run })
    else if (last.exit === 126 || last.exit === 127) add('bad', { key: 'not-found', run })
    else add('bad', { key: 'exit', run })
    const fails = mine.filter(isFail)
    if (!isFail(last) && fails.length > 0)
      add('idle', { key: 'failed-before', run: asRun(fails[0]), fails: fails.length, runs: mine.length })
    if (w && w.fails > 0) add('idle', { key: 'week', w })
  }
  if (w && w.timed > 0) {
    const took = tookStep(w.max, limitMs, w.timed, w.p50, w.p90)
    if (took) steps.push(took)
  }
  if (w && w.fails > 0 && o.peers && o.peers.others > 0) {
    const all = o.peers.failing >= o.peers.others
    add(all ? 'warn' : 'idle', { key: 'peers', event: hook.event, ...o.peers })
  }
  return verdictOf(steps, !hook.off)
}

/** The other hooks at an outside hook's moment that run (on, waited for), and how many of them failed in the same 7 days. */
export function peersOf(hook: OutsideHook & { id?: string }, all: readonly (OutsideHook & { id?: string })[], stats: readonly HookStat[]) {
  const others = all.filter(h => h !== hook && h.event === hook.event && !h.off && !h.async && keysOf(h).length > 0)
  return { others: others.length, failing: others.filter(h => (weekOf(h, stats)?.fails ?? 0) > 0).length }
}

/** What a failed run printed: the one that says why, else the last failure. */
export function outputOf(why: Why): string | undefined {
  for (const s of [why.reason, ...why.steps]) {
    const c = s?.check
    if (c && 'run' in c && c.run.out) return c.run.out
  }
  return undefined
}

/** Whether a verdict is trouble: what "not working" collects and the top of the page lists. */
export const isTrouble = (w: Why) => w.verdict === 'stuck' || w.verdict === 'failing'
