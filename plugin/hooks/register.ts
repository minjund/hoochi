import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, AgentConfig, Config, Fired, Item, Place, Scope } from '../types'

// hookwich: put text, commands or skills before or after any Claude Code hook
// event. The window edits ~/.hookwich/config.json (everywhere / per project /
// per terminal); this module reads it on every event and puts the enabled items
// of the narrowest scope in. It writes activity-claude.json for the window to
// light up, places.json so the window knows the projects and terminals, and
// control.json to show or hide the window.

const APP_NAME = 'Hookwich.app'
const RELEASE = 'https://github.com/minjund/hookwich/releases/latest/download'
const MAX_OUTPUT = 4000
const COMMAND_TIMEOUT_MS = 30_000

/** Events whose answer reaches the model: text and skills go only here. */
export const INJECTABLE: ReadonlySet<string> = new Set([
  'SessionStart',
  'Setup',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'PostModelSwitch',
  'SubagentStart',
  'Stop',
  'SubagentStop',
])

/** Of those, the ones where putting something in means "keep going once". */
const CONTINUES: ReadonlySet<string> = new Set(['Stop', 'SubagentStop'])

const TOOL_EVENTS: ReadonlySet<string> = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])

/** Too frequent to log each one: recorded only when something was put in. */
const QUIET: ReadonlySet<string> = new Set(['MessageDisplay', 'FileChanged'])

/** You are here: a chat opened or a message typed. The window follows these. */
const HERE: ReadonlySet<string> = new Set(['SessionStart', 'UserPromptSubmit'])

const activity = atom({ plugin: 'hookwich', key: 'activity' } as const, emptyActivity(), {
  shape: 'activity-2',
})

type Loose = Record<string, unknown>

function emptyActivity(): Activity {
  return { lastEvent: '', lastAt: 0, counts: {}, recent: [] }
}

const emptyAgent = (): AgentConfig => ({ global: [], projects: {}, terminals: {} })

function parseItems(list: unknown): Item[] {
  if (!Array.isArray(list)) return []
  const items: Item[] = []
  for (const v of list) {
    if (!v || typeof v !== 'object') continue
    const o = v as Loose
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
    const kind = o.kind === 'command' || o.kind === 'skill' ? o.kind : 'text'
    if (str('id') === '' || str('event') === '') continue
    items.push({
      id: str('id'),
      event: str('event'),
      kind,
      text: str('text'),
      command: str('command'),
      mode: o.mode === 'onFail' ? 'onFail' : 'always',
      skill: str('skill'),
      tools: str('tools'),
      enabled: o.enabled !== false,
      once: o.once === true,
    })
  }
  return items
}

function parseScopes(raw: unknown): Record<string, Item[]> {
  const out: Record<string, Item[]> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, list] of Object.entries(raw as Loose)) out[key] = parseItems(list)
  return out
}

function parseAgent(raw: unknown): AgentConfig {
  if (!raw || typeof raw !== 'object') return emptyAgent()
  const o = raw as Loose
  return {
    global: parseItems(o.global),
    projects: parseScopes(o.projects),
    terminals: parseScopes(o.terminals),
  }
}

/** Reads the config the window writes; a version 1 file becomes Claude's "everywhere" list. */
export function parseConfig(raw: string): Config {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { version: 2, claude: emptyAgent(), codex: emptyAgent() }
  }
  const o = (data && typeof data === 'object' ? data : {}) as Loose
  if (o.version === 2) return { version: 2, claude: parseAgent(o.claude), codex: parseAgent(o.codex) }
  return { version: 2, claude: { ...emptyAgent(), global: parseItems(o.items) }, codex: emptyAgent() }
}

/**
 * The items for one moment: the narrowest scope with any item for it wins
 * (this terminal, else this project, else everywhere). A switched-off item still
 * claims its scope, so an "off" item can silence a wider one.
 */
export function pick(
  agent: AgentConfig,
  event: string,
  place: Place,
): { scope: Scope; key: string; items: Item[] } | undefined {
  const scopes: [Scope, string, Item[] | undefined][] = [
    ['terminal', place.terminal, agent.terminals[place.terminal]],
    ['project', place.project, agent.projects[place.project]],
    ['global', '', agent.global],
  ]
  for (const [scope, key, list] of scopes) {
    const here = (list ?? []).filter(i => i.event === event)
    if (here.length > 0) return { scope, key, items: here }
  }
  return undefined
}

/** Empty filter: every tool. Otherwise the tool must be named in the list. */
export function toolMatches(filter: string, tool: string): boolean {
  const names = filter
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return names.length === 0 || names.includes(tool)
}

function toolOf(e: unknown): string {
  if (!e || typeof e !== 'object') return ''
  const r = e as Loose
  if (typeof r.tool === 'string') return r.tool
  if (typeof r.tool_name === 'string') return r.tool_name
  return ''
}

function clip(text: string): string {
  const t = text.trim()
  return t.length > MAX_OUTPUT ? `${t.slice(0, MAX_OUTPUT)}\n… (cut)` : t
}

/** What the model reads for a skill item. */
export function skillText(skill: string): string {
  return `Use the "${skill}" skill for this (call it with the Skill tool) before you go on.`
}

function labelOf(item: Item): string {
  const raw =
    item.kind === 'text' ? item.text : item.kind === 'command' ? `$ ${item.command}` : `/${item.skill}`
  const one = raw.replace(/\s+/g, ' ').trim()
  return one.length > 60 ? `${one.slice(0, 59)}…` : one
}

async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

/**
 * The terminal this session runs in, by the id the terminal app gives it, so a
 * terminal's items follow it across conversations. Unknown terminals fall back
 * to this conversation.
 */
export async function detectTerminal($: EngineInterface): Promise<{ id: string; label: string }> {
  const short = (v: string) => v.replace(/^.*[:/]/, '').slice(-8)
  const whitebox = await $.env.get('WHITEBOX_SURFACE_ID')
  if (whitebox) return { id: `whitebox:${whitebox}`, label: `Whitebox ${short(whitebox)}` }
  const iterm = await $.env.get('ITERM_SESSION_ID')
  if (iterm) return { id: `iterm:${iterm}`, label: `iTerm ${short(iterm)}` }
  const apple = await $.env.get('TERM_SESSION_ID')
  if (apple) return { id: `terminal:${apple}`, label: `Terminal ${short(apple)}` }
  const tmux = await $.env.get('TMUX_PANE')
  if (tmux) return { id: `tmux:${tmux}`, label: `tmux ${tmux}` }
  const wezterm = await $.env.get('WEZTERM_PANE')
  if (wezterm) return { id: `wezterm:${wezterm}`, label: `WezTerm ${wezterm}` }
  const kitty = await $.env.get('KITTY_WINDOW_ID')
  if (kitty) return { id: `kitty:${kitty}`, label: `kitty ${kitty}` }
  const session = await $.env.get('CLAUDE_CODE_SESSION_ID')
  return { id: `session:${session ?? 'unknown'}`, label: `chat ${short(session ?? '')}` }
}

/** The project: the git top-level of the folder the session started in, else that folder. */
async function detectProject($: EngineInterface): Promise<string> {
  const root = await $.session.root()
  const git = await $.process
    .run(['git', 'rev-parse', '--show-toplevel'], { cwd: root })
    .catch(() => undefined)
  const top = git?.exitCode === 0 ? git.stdout.trim() : ''
  return top || root
}

// Where this session runs does not change while it runs; found once per load.
let placeCache: Promise<Place> | undefined
function placeOf($: EngineInterface): Promise<Place> {
  placeCache ??= (async () => {
    const terminal = await detectTerminal($)
    return { project: await detectProject($), terminal: terminal.id, terminalLabel: terminal.label }
  })()
  return placeCache
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return (await $.fs.read(path)) as string
  } catch {
    return undefined
  }
}

async function readConfig($: EngineInterface, dir: string): Promise<Config> {
  const raw = await readText($, `${dir}/config.json`)
  return raw === undefined ? parseConfig('{}') : parseConfig(raw)
}

/** Remembers this project and terminal for the window's scope picker. */
async function notePlace($: EngineInterface, dir: string, place: Place) {
  let known: Loose = {}
  try {
    known = JSON.parse((await readText($, `${dir}/places.json`)) ?? '{}') as Loose
  } catch {
    known = {}
  }
  const now = await $.clock.now()
  const projects = { ...((known.projects as Loose | undefined) ?? {}), [place.project]: { lastSeen: now } }
  const terminals = {
    ...((known.terminals as Loose | undefined) ?? {}),
    [place.terminal]: { label: place.terminalLabel, cwd: place.project, agent: 'claude', lastSeen: now },
  }
  await $.fs
    .write(`${dir}/places.json`, JSON.stringify({ projects, terminals }, null, 2))
    .catch(() => undefined)
}

/** Runs a command item; undefined when its output should not go in. */
async function runCommand($: EngineInterface, item: Item, cwd: string): Promise<string | undefined> {
  try {
    const r = await $.process.run(['/bin/sh', '-c', item.command], {
      cwd: cwd || undefined,
      timeoutMs: COMMAND_TIMEOUT_MS,
      env: await $.process.hookEnv(),
    })
    if (item.mode === 'onFail' && r.exitCode === 0) return undefined
    const out = clip([r.stdout, r.stderr].filter(Boolean).join('\n'))
    return `$ ${item.command} (exit ${r.exitCode})${out ? `\n${out}` : ''}`
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    return `$ ${item.command} (did not finish: ${why})`
  }
}

async function appPath($: EngineInterface, dir: string): Promise<string | undefined> {
  for (const path of [`${dir}/${APP_NAME}`, `/Applications/${APP_NAME}`]) {
    if (await $.fs.exists(path).catch(() => false)) return path
  }
  return undefined
}

/** Fetches the app from the latest release, checking its SHA-256. */
async function installApp($: EngineInterface, dir: string): Promise<string | undefined> {
  const arch = (await $.process.run(['uname', '-m'])).stdout.trim() === 'arm64' ? 'arm64' : 'x64'
  const zip = `${dir}/Hookwich-macos-${arch}.zip`
  const url = `${RELEASE}/Hookwich-macos-${arch}.zip`
  const got = await $.process.run(['curl', '-fsSL', '-o', zip, url], { timeoutMs: 120_000 })
  const sums = await $.process.run(['curl', '-fsSL', `${url}.sha256`], { timeoutMs: 30_000 })
  if (got.exitCode !== 0 || sums.exitCode !== 0) return undefined
  const want = sums.stdout.trim().split(/\s+/)[0] ?? ''
  const have = (await $.process.run(['shasum', '-a', '256', zip])).stdout.trim().split(/\s+/)[0]
  if (want === '' || want !== have) return undefined
  const unzip = await $.process.run(['ditto', '-x', '-k', zip, dir])
  if (unzip.exitCode !== 0) return undefined
  return appPath($, dir)
}

/** Opens the window app if it is not up; installs it the first time. */
async function ensureApp($: EngineInterface, dir: string): Promise<boolean> {
  const os = (await $.process.run(['uname', '-s']).catch(() => undefined))?.stdout.trim()
  if (os !== 'Darwin') return false
  const path = (await appPath($, dir)) ?? (await installApp($, dir).catch(() => undefined))
  if (path === undefined) return false
  await $.process.run(['open', '-g', path]).catch(() => undefined)
  return true
}

async function sendControl($: EngineInterface, dir: string, cmd: 'show' | 'hide' | 'toggle') {
  await $.fs.write(`${dir}/control.json`, JSON.stringify({ cmd, at: await $.clock.now() }))
}

/** Switches "once" items off in the scope they came from. */
function spend(config: Config, scope: Scope, key: string, ids: Set<string>): Config {
  const off = (list: Item[] = []) => list.map(i => (ids.has(i.id) ? { ...i, enabled: false } : i))
  const claude = { ...config.claude }
  if (scope === 'global') claude.global = off(claude.global)
  if (scope === 'project') claude.projects = { ...claude.projects, [key]: off(claude.projects[key]) }
  if (scope === 'terminal') claude.terminals = { ...claude.terminals, [key]: off(claude.terminals[key]) }
  return { ...config, claude }
}

/** Puts the enabled items for this event into its answer. */
async function sandwich($: EngineInterface, event: string, e: unknown, result: unknown): Promise<unknown> {
  const dir = `${await home($)}/.hookwich`
  const config = await readConfig($, dir)
  const place = await placeOf($)
  const chosen = pick(config.claude, event, place)
  const tool = toolOf(e)
  const items = (chosen?.items ?? []).filter(
    i => i.enabled && (!TOOL_EVENTS.has(event) || toolMatches(i.tools, tool)),
  )
  const scope: Scope = chosen?.scope ?? 'global'

  const at = await $.clock.now()
  const fired: Fired[] = []
  const ranIds = new Set<string>()
  const parts: string[] = []
  const canInject = INJECTABLE.has(event)
  const isSecondPass = CONTINUES.has(event) && (e as Loose).stop_hook_active === true
  const cwd = typeof (e as Loose).cwd === 'string' ? ((e as Loose).cwd as string) : place.project

  for (const item of items) {
    if (isSecondPass) break
    if (item.kind === 'command') {
      const out = await runCommand($, item, cwd)
      fired.push({ event, at, kind: item.kind, label: labelOf(item), tool, scope })
      ranIds.add(item.id)
      if (out !== undefined && canInject) parts.push(out)
    } else if (canInject) {
      const words = item.kind === 'skill' ? skillText(item.skill) : item.text
      if (words.trim() === '') continue
      parts.push(words)
      fired.push({ event, at, kind: item.kind, label: labelOf(item), tool, scope })
      ranIds.add(item.id)
    }
  }

  const spent = new Set(items.filter(i => i.once && ranIds.has(i.id)).map(i => i.id))
  if (spent.size > 0 && chosen) {
    const next2 = spend(config, chosen.scope, chosen.key, spent)
    await $.fs.write(`${dir}/config.json`, JSON.stringify(next2, null, 2)).catch(() => undefined)
  }

  if (HERE.has(event)) await notePlace($, dir, place).catch(() => undefined)

  if (!QUIET.has(event) || fired.length > 0) {
    const before0 = await read($, activity)
    const seen: Activity = {
      lastEvent: event,
      lastAt: at,
      counts: { ...before0.counts, [event]: (before0.counts[event] ?? 0) + 1 },
      recent: [...before0.recent, ...fired].slice(-40),
      place,
      lastChat: HERE.has(event) ? { at, place } : before0.lastChat,
    }
    await update($, activity, () => seen)
    await $.fs.write(`${dir}/activity-claude.json`, JSON.stringify(seen)).catch(() => undefined)
  }

  if (parts.length === 0) return result
  const answer = (result ?? {}) as Loose
  const body = parts.join('\n\n')
  if (CONTINUES.has(event)) {
    if (answer.block) return result
    return { ...answer, block: body }
  }
  const before = Array.isArray(answer.additionalContext) ? answer.additionalContext : []
  return { ...answer, additionalContext: [...before, body] }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'hookwich',
      description: 'Show or hide the hookwich window (show | hide | toggle)',
    })
    const dir = `${await home($)}/.hookwich`
    if (!(await $.fs.exists(`${dir}/config.json`).catch(() => false))) {
      const empty = { global: [], projects: {}, terminals: {} }
      await $.fs.write(
        `${dir}/config.json`,
        JSON.stringify({ version: 2, claude: empty, codex: empty }, null, 2),
      )
    }
    void placeOf($)
      .then(place => notePlace($, dir, place))
      .catch(() => undefined)
    void ensureApp($, dir).then(ok => {
      if (!ok) $.ui.status('hookwich: window app not installed — see the README')
    })

    return started
  })

  on('command.run', { command: 'hookwich' }, async ($, e) => {
    const dir = `${await home($)}/.hookwich`
    const word = (typeof e.args === 'string' ? e.args : '').trim()
    const cmd = word === 'show' || word === 'hide' ? word : 'toggle'
    const ok = await ensureApp($, dir)
    await sendControl($, dir, cmd)

    return {
      text: ok ? `hookwich: ${cmd}` : 'hookwich: the window app is not installed yet — see the README.',
    }
  })

  on('classic.*', async ($, e, next) => {
    const event = next.event.slice('classic.'.length)
    const result = await next(e)
    try {
      return (await sandwich($, event, e, result)) as typeof result
    } catch {
      // hookwich never breaks a hook: on any trouble, the answer stays as it was
      return result
    }
  })
}
