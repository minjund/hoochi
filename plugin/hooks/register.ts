import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  Activity,
  AgentConfig,
  Config,
  ContextRow,
  ContextSnapshot,
  SkillGroup,
  Fired,
  Item,
  Place,
  Scope,
} from '../types'

// hookwich: put text, commands or skills before or after any Claude Code hook
// event. The window edits ~/.hookwich/config.json (everywhere / per project /
// per terminal); this module reads it on every event and puts the enabled items
// of the narrowest scope in. It writes activity-claude.json for the window to
// light up, places.json so the window knows the projects and terminals, and
// control.json to show or hide the window, and context/<terminal>.json with what /context
// shows for that terminal's chat.

const APP_NAME = 'Hookwich.app'
/** The window app this plugin goes with: the release of the same version. Bump with plugin.json. */
export const APP_VERSION = '0.1.14'
const RELEASE = `https://github.com/minjund/hookwich/releases/download/v${APP_VERSION}`
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

/**
 * Whether a person is at this session's prompt. A `claude -p` run or an SDK script in the same
 * terminal is not "where you chat": it neither moves the window nor writes over that chat's /context.
 */
let interactive = true

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
      ...(typeof o.added === 'number' ? { added: o.added } : {}),
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

/** Why the window app could not be opened or updated, for the status line. */
type AppTrouble = 'not-mac' | 'download' | 'checksum' | 'unzip' | 'update'

const TROUBLE: Record<AppTrouble, string> = {
  'not-mac': 'hookwich: the window app is macOS only',
  download: 'hookwich: could not download the window app (offline, or no release yet) — see the README',
  checksum: 'hookwich: the downloaded window app did not match its checksum, so it was not opened',
  unzip: 'hookwich: could not unpack the window app',
  update: `hookwich: could not update the window app to ${APP_VERSION}; the one you have is still running`,
}

const isTrouble = (v: string): v is AppTrouble => v in TROUBLE

/** "0.1.10" > "0.1.9" */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(n => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

async function appVersion($: EngineInterface, path: string): Promise<string | undefined> {
  const plist = `${path}/Contents/Info.plist`
  const r = await $.process
    .run(['/usr/bin/plutil', '-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist])
    .catch(() => undefined)
  const version = r?.exitCode === 0 ? r.stdout.trim() : ''
  return /^\d+(\.\d+)*$/.test(version) ? version : undefined
}

/**
 * Downloads this plugin's version of the app, checks its SHA-256 and signature, and puts it at
 * ~/.hookwich/Hookwich.app, stopping a running older copy first. Returns its path, or why not.
 */
async function installApp($: EngineInterface, dir: string, old?: string): Promise<string | AppTrouble> {
  const run = (argv: string[], timeoutMs?: number) =>
    $.process.run(argv, timeoutMs ? { timeoutMs } : undefined)
  const arch = (await run(['/usr/bin/uname', '-m'])).stdout.trim() === 'arm64' ? 'arm64' : 'x64'
  const name = `Hookwich-macos-${arch}.zip`
  const zip = `${dir}/${name}`
  const got = await run(['/usr/bin/curl', '-fsSL', '-o', zip, `${RELEASE}/${name}`], 120_000)
  const sums = await run(['/usr/bin/curl', '-fsSL', `${RELEASE}/${name}.sha256`], 30_000)
  if (got.exitCode !== 0 || sums.exitCode !== 0) return 'download'
  const want = sums.stdout.trim().split(/\s+/)[0] ?? ''
  const have = (await run(['/usr/bin/shasum', '-a', '256', zip])).stdout.trim().split(/\s+/)[0]
  if (want === '' || want !== have) return 'checksum'

  // Unpack beside, check, then swap: a failed update leaves the old app as it was.
  const fresh = `${dir}/.update`
  await run(['/bin/rm', '-rf', fresh])
  if ((await run(['/usr/bin/ditto', '-x', '-k', zip, fresh])).exitCode !== 0) return 'unzip'
  const verified = await run(['/usr/bin/codesign', '--verify', '--deep', '--strict', `${fresh}/${APP_NAME}`])
  if (verified.exitCode !== 0) return 'unzip'
  if (old !== undefined) await run(['/usr/bin/pkill', '-f', `${old}/Contents/MacOS/hookwich`])
  const target = `${dir}/${APP_NAME}`
  await run(['/bin/rm', '-rf', `${dir}/.old-${APP_NAME}`])
  if (await $.fs.exists(target).catch(() => false)) await run(['/bin/mv', target, `${dir}/.old-${APP_NAME}`])
  if ((await run(['/bin/mv', `${fresh}/${APP_NAME}`, target])).exitCode !== 0) return 'unzip'
  await run(['/bin/rm', '-rf', fresh, `${dir}/.old-${APP_NAME}`, zip])
  return target
}

/**
 * Opens the window app if it is not up: installs it the first time, and updates it when it is
 * older than this plugin. One at a time per session.
 */
let opening: Promise<AppTrouble | undefined> | undefined
function ensureApp($: EngineInterface, dir: string): Promise<AppTrouble | undefined> {
  opening ??= (async () => {
    try {
      const os = (await $.process.run(['/usr/bin/uname', '-s']).catch(() => undefined))?.stdout.trim()
      if (os !== 'Darwin') return 'not-mac' as const
      const found = await appPath($, dir)
      let path: string | AppTrouble
      if (found === undefined) {
        path = await installApp($, dir).catch(() => 'download' as const)
      } else {
        const version = await appVersion($, found)
        // An unreadable version is left alone, so a quirk can't redownload on every chat.
        const outdated = version !== undefined && newer(APP_VERSION, version)
        path = outdated ? await installApp($, dir, found).catch(() => 'update' as const) : found
        if (outdated && isTrouble(path)) {
          // Keep using the old one rather than leave the person without a window.
          await $.process.run(['/usr/bin/open', '-g', found]).catch(() => undefined)
          return 'update'
        }
      }
      if (isTrouble(path)) return path
      await $.process.run(['/usr/bin/open', '-g', path]).catch(() => undefined)
      return undefined
    } finally {
      opening = undefined
    }
  })()
  return opening
}

/** Says why the window is missing, or clears an earlier message once it is there. */
function showTrouble($: EngineInterface, trouble: AppTrouble | undefined) {
  $.ui.status(trouble === undefined ? undefined : TROUBLE[trouble])
}

async function sendControl($: EngineInterface, dir: string, cmd: 'show' | 'hide' | 'toggle') {
  await $.fs.write(`${dir}/control.json`, JSON.stringify({ cmd, at: await $.clock.now() }))
}

type Chat = NonNullable<Activity['lastChat']>

function newestChat(a: Chat | undefined, b: Chat | undefined): Chat | undefined {
  if (!a) return b
  if (!b) return a
  return b.at > a.at ? b : a
}

async function chatOnDisk($: EngineInterface, path: string): Promise<Chat | undefined> {
  try {
    const chat = (JSON.parse((await readText($, path)) ?? '{}') as Loose).lastChat as Chat | undefined
    return chat && typeof chat.at === 'number' && chat.place ? chat : undefined
  } catch {
    return undefined
  }
}

/**
 * You started typing here: if the last chat the window knows of is another terminal (a Claude
 * Code or a Codex one), this one becomes "where you are chatting" right away, before you send.
 * At most one check a second, and nothing is written while it already points here.
 */
let lastTypingCheck = -Infinity
export async function noteTyping($: EngineInterface): Promise<boolean> {
  const now = await $.clock.now()
  if (now - lastTypingCheck < 1000) return false
  lastTypingCheck = now
  const dir = `${await home($)}/.hookwich`
  const place = await placeOf($)
  const known = newestChat(
    await chatOnDisk($, `${dir}/activity-claude.json`),
    await chatOnDisk($, `${dir}/activity-codex.json`),
  )
  if (known?.place.terminal === place.terminal) return false
  const seen: Activity = { ...(await read($, activity)), lastChat: { at: now, place } }
  await update($, activity, () => seen)
  await $.fs.write(`${dir}/activity-claude.json`, JSON.stringify(seen))
  return true
}

/** The file name a terminal's context snapshot goes in; the window builds the same one. */
export function contextFile(terminal: string): string {
  return `${terminal.replace(/[^A-Za-z0-9._-]/g, '_')}.json`
}

type Breakdown = NonNullable<Awaited<ReturnType<EngineInterface['session']['usage']>>['context']['breakdown']>

/** /context's figures in the small shape the window draws. */
export function contextSnapshot(b: Breakdown, place: Place, at: number): ContextSnapshot {
  const rows: ContextRow[] = b.categories
    .filter(c => c.tokens > 0 || c.kind === 'free')
    .map(c => ({ name: c.name, tokens: Math.round(c.tokens), kind: c.kind }))
  const servers = new Map<string, { server: string; tools: number; tokens: number }>()
  // Only the schemas loaded now take room; deferred ones wait outside the window.
  for (const tool of b.mcpTools.filter(t => t.isLoaded)) {
    const s = servers.get(tool.serverName) ?? { server: tool.serverName, tools: 0, tokens: 0 }
    s.tools += 1
    s.tokens += tool.tokens
    servers.set(tool.serverName, s)
  }
  const byTokens = <T extends { tokens: number }>(list: T[]) =>
    [...list].sort((x, y) => y.tokens - x.tokens).slice(0, 8)
  const groups = new Map<string, SkillGroup>()
  for (const skill of b.skills?.skillFrontmatter ?? []) {
    const kind: SkillGroup['kind'] = skill.pluginName
      ? 'plugin'
      : skill.source === 'userSettings'
        ? 'user'
        : skill.source === 'projectSettings'
          ? 'project'
          : skill.source === 'built-in'
            ? 'builtin'
            : skill.source === 'syncedSkills'
              ? 'synced'
              : 'other'
    // a plugin by name; an unknown source by its own word, so it can still be told apart
    const name = kind === 'plugin' ? (skill.pluginName ?? '') : kind === 'other' ? String(skill.source) : ''
    const g = groups.get(`${kind}:${name}`) ?? { kind, name, skills: 0, tokens: 0 }
    g.skills += 1
    g.tokens += skill.tokens
    groups.set(`${kind}:${name}`, g)
  }
  return {
    v: 1,
    at,
    place,
    model: b.model,
    used: Math.round(b.totalTokens),
    max: b.rawMaxTokens,
    percent: b.percentage,
    ...(b.isAutoCompactEnabled && b.autoCompactThreshold ? { compactAt: b.autoCompactThreshold } : {}),
    rows,
    memory: byTokens(b.memoryFiles.map(m => ({ path: m.path, tokens: m.tokens }))),
    mcp: byTokens([...servers.values()]),
    ...(b.skills ? { skills: { count: b.skills.includedSkills, tokens: b.skills.tokens } } : {}),
    ...(groups.size > 0 ? { skillGroups: byTokens([...groups.values()]) } : {}),
    ...(b.agents.length > 0
      ? { agents: byTokens(b.agents.map(a => ({ name: a.agentType, source: a.source, tokens: a.tokens }))) }
      : {}),
  }
}

/**
 * Writes what /context would show for this chat, for the window to draw live. After every turn,
 * and at most every CONTEXT_MS while tools run, counted locally (no token-count requests).
 */
const CONTEXT_MS = 2000
let lastContext = -Infinity
let contextDir: Promise<string> | undefined
export async function noteContext($: EngineInterface, force = false): Promise<boolean> {
  const now = await $.clock.now()
  if (!interactive) return false
  if (!force && now - lastContext < CONTEXT_MS) return false
  lastContext = now
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (!b) return false
  contextDir ??= (async () => {
    const dir = `${await home($)}/.hookwich/context`
    await $.process.run(['/bin/mkdir', '-p', dir])
    return dir
  })()
  const dir = await contextDir.catch(err => {
    contextDir = undefined
    throw err
  })
  const place = await placeOf($)
  await $.fs.write(`${dir}/${contextFile(place.terminal)}`, JSON.stringify(contextSnapshot(b, place, now)))
  return true
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
      fired.push({ event, at, kind: item.kind, label: labelOf(item), tool, scope, id: item.id })
      ranIds.add(item.id)
      if (out !== undefined && canInject) parts.push(out)
    } else if (canInject) {
      const words = item.kind === 'skill' ? skillText(item.skill) : item.text
      if (words.trim() === '') continue
      parts.push(words)
      fired.push({ event, at, kind: item.kind, label: labelOf(item), tool, scope, id: item.id })
      ranIds.add(item.id)
    }
  }

  const spent = new Set(items.filter(i => i.once && ranIds.has(i.id)).map(i => i.id))
  if (spent.size > 0 && chosen) {
    const next2 = spend(config, chosen.scope, chosen.key, spent)
    await $.fs.write(`${dir}/config.json`, JSON.stringify(next2, null, 2)).catch(() => undefined)
  }

  if (HERE.has(event) && interactive) await notePlace($, dir, place).catch(() => undefined)

  if (!QUIET.has(event) || fired.length > 0) {
    const before0 = await read($, activity)
    // Other Claude Code chats write this file too: keep the newest "where you last chatted",
    // so a chat working in the background never takes it back from the one you are typing in.
    const mine = HERE.has(event) && interactive ? { at, place } : before0.lastChat
    const seen: Activity = {
      lastEvent: event,
      lastAt: at,
      counts: { ...before0.counts, [event]: (before0.counts[event] ?? 0) + 1 },
      recent: [...before0.recent, ...fired].slice(-40),
      place,
      lastChat: newestChat(mine, await chatOnDisk($, `${dir}/activity-claude.json`)),
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
    interactive = e.isInteractive !== false
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
    if (interactive)
      void placeOf($)
        .then(place => notePlace($, dir, place))
        .catch(() => undefined)
    void ensureApp($, dir).then(trouble => showTrouble($, trouble))
    void noteContext($, true).catch(() => undefined)

    return started
  })

  // /context, live: after each turn (and a compaction), and while tools run.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('context')) await noteContext($, true).catch(() => undefined)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    void noteContext($).catch(() => undefined)
    return result
  })

  on('command.run', { command: 'hookwich' }, async ($, e) => {
    const dir = `${await home($)}/.hookwich`
    const word = (typeof e.args === 'string' ? e.args : '').trim()
    const cmd = word === 'show' || word === 'hide' ? word : 'toggle'
    const trouble = await ensureApp($, dir)
    showTrouble($, trouble)
    await sendControl($, dir, cmd)

    return { text: trouble === undefined ? `hookwich: ${cmd}` : `${TROUBLE[trouble]}.` }
  })

  // Typing in the prompt box: "where you are chatting" moves here at the first key, not on send.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    // At most one quick check a second (two small reads); typing never waits on more.
    await noteTyping($).catch(() => undefined)
    return box
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
