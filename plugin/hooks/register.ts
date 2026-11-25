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
  ItemRun,
  Place,
  Run,
  Scope,
  Seen,
  SkillRule,
} from '../types'

// hoochi: put text, commands or skills before or after any Claude Code hook
// event. The window edits ~/.hoochi/config.json (everywhere / per project /
// per terminal); this module reads it on every event and puts the enabled items
// of the narrowest scope in. It writes activity-claude.json for the window to
// light up, places.json so the window knows the projects and terminals, and
// control.json to show or hide the window, and context/<terminal>.json with what /context
// shows for that terminal's chat.

const APP_NAME = 'Hoochi.app'
/** The window app this plugin goes with: the release of the same version. Bump with plugin.json. */
export const APP_VERSION = '0.1.47'
const RELEASE = `https://github.com/minjund/hoochi/releases/download/v${APP_VERSION}`
const MAX_OUTPUT = 4000
/** How much of a failed command's output the window keeps, to say why it failed. */
const RUN_OUTPUT = 600
/** Items whose runs are kept; the ones run longest ago go first. */
const RUNS_KEPT = 200
/** Tools kept per moment, newest first, to tell why a tool filter never matched. */
const TOOLS_KEPT = 6
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

/** A chat opened or a message sent: the window learns this project and terminal. */
const HERE: ReadonlySet<string> = new Set(['SessionStart', 'UserPromptSubmit'])

/**
 * Where a prompt or a key came from: only your own Enter or keys (in the terminal, or through
 * Remote Control) mean "you are chatting here". A notification, another session's message, a
 * scheduled run or a terminal app's request to this chat reach UserPromptSubmit too, and must not
 * pull the window away from the terminal you are typing in.
 */
export function byYou(origin: unknown): boolean {
  const kind = (origin as { kind?: unknown } | undefined)?.kind
  return kind === 'composer' || kind === 'bridge'
}

/**
 * Whether a person is at this session's prompt. A `claude -p` run or an SDK script in the same
 * terminal is not "where you chat": it neither moves the window nor writes over that chat's /context.
 */
let interactive = true

const activity = atom({ plugin: 'hoochi', key: 'activity' } as const, emptyActivity(), {
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
    const kind = o.kind === 'command' || o.kind === 'skill' || o.kind === 'rules' ? o.kind : 'text'
    if (str('id') === '' || str('event') === '') continue
    items.push({
      id: str('id'),
      event: str('event'),
      kind,
      text: str('text'),
      command: str('command'),
      mode: o.mode === 'onFail' ? 'onFail' : 'always',
      skill: str('skill'),
      rules: parseRules(o.rules),
      tools: str('tools'),
      enabled: o.enabled !== false,
      once: o.once === true,
      ...(typeof o.added === 'number' ? { added: o.added } : {}),
    })
  }
  return items
}

function parseRules(list: unknown): SkillRule[] {
  if (!Array.isArray(list)) return []
  return list.flatMap(v => {
    const o = (v && typeof v === 'object' ? v : {}) as Loose
    const when = typeof o.when === 'string' ? o.when : ''
    const skill = typeof o.skill === 'string' ? o.skill : ''
    return when === '' && skill === '' ? [] : [{ when, skill }]
  })
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

/** Whether an item puts anything in: an empty one (no words, command, skill or full rule row) does not. */
export function filled(i: Item): boolean {
  if (i.kind === 'command') return i.command.trim() !== ''
  if (i.kind === 'skill') return i.skill.trim() !== ''
  if (i.kind === 'rules') return fullRules(i.rules).length > 0
  return i.text.trim() !== ''
}

/**
 * The items for one moment: the narrowest scope with any item for it wins
 * (this terminal, else this project, else everywhere). A switched-off item still
 * claims its scope, so an "off" item can silence a wider one; an empty one does
 * not, so a narrower place with nothing set for the moment follows the wider one.
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
    const here = (list ?? []).filter(i => i.event === event && filled(i))
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

/** The rows of a "rules" item that say both when and which skill. */
export function fullRules(rules: readonly SkillRule[]): SkillRule[] {
  return rules
    .map(r => ({ when: r.when.replace(/\s+/g, ' ').trim(), skill: r.skill.trim() }))
    .filter(r => r.when !== '' && r.skill !== '')
}

/** What the model reads for a "rules" item; empty when no row is filled in. */
export function rulesText(rules: readonly SkillRule[]): string {
  const rows = fullRules(rules)
  if (rows.length === 0) return ''
  return [
    'When the task matches one of these, call that skill with the Skill tool before you go on:',
    ...rows.map(r => `- ${r.when} → "${r.skill}"`),
  ].join('\n')
}

function labelOf(item: Item): string {
  const raw =
    item.kind === 'text'
      ? item.text
      : item.kind === 'command'
        ? `$ ${item.command}`
        : item.kind === 'rules'
          ? fullRules(item.rules)
              .map(r => `/${r.skill}`)
              .join(' ')
          : `/${item.skill}`
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
async function notePlace($: EngineInterface, dir: string, place: Place, session = '') {
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
    [place.terminal]: {
      label: place.terminalLabel,
      cwd: place.project,
      agent: 'claude',
      lastSeen: now,
      // The chat there now, so the window can find what Claude Code recorded of its hooks.
      ...(session ? { session } : {}),
    },
  }
  await $.fs
    .write(`${dir}/places.json`, JSON.stringify({ projects, terminals }, null, 2))
    .catch(() => undefined)
}

/** The first of what a failed command printed: its errors first. */
export function failOutput(stdout: string, stderr: string): string {
  const t = [stderr, stdout].map(s => s.trim()).filter(Boolean).join('\n')
  return t.length > RUN_OUTPUT ? `${t.slice(0, RUN_OUTPUT)}…` : t
}

/** Runs a command item: what goes to the model (none when its output should not go in), and how it ended. */
async function runCommand($: EngineInterface, item: Item, cwd: string): Promise<{ text?: string; run: Run }> {
  const at = await $.clock.now()
  try {
    const r = await $.process.run(['/bin/sh', '-c', item.command], {
      cwd: cwd || undefined,
      timeoutMs: COMMAND_TIMEOUT_MS,
      env: await $.process.hookEnv(),
    })
    const ms = (await $.clock.now()) - at
    const run: Run = { at, exit: r.exitCode, ms, ...(r.exitCode !== 0 ? { out: failOutput(r.stdout, r.stderr) } : {}) }
    if (item.mode === 'onFail' && r.exitCode === 0) return { run }
    const out = clip([r.stdout, r.stderr].filter(Boolean).join('\n'))
    return { text: `$ ${item.command} (exit ${r.exitCode})${out ? `\n${out}` : ''}`, run }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    const ms = (await $.clock.now()) - at
    return { text: `$ ${item.command} (did not finish: ${why})`, run: { at, ms, error: why } }
  }
}

/** Whether a run went wrong: a command that did not end with 0, or did not finish. */
export const failed = (r: Run) => r.error !== undefined || (r.exit !== undefined && r.exit !== 0)

/** The runs with these added, keeping the items run most lately. */
export function noteRuns(
  runs: Record<string, ItemRun> | undefined,
  done: readonly { id: string; run: Run }[],
): Record<string, ItemRun> {
  const out: Record<string, ItemRun> = { ...runs }
  for (const { id, run } of done) {
    const had = out[id]
    const bad = failed(run)
    out[id] = {
      runs: (had?.runs ?? 0) + 1,
      fails: (had?.fails ?? 0) + (bad ? 1 : 0),
      last: run,
      ...(bad ? { fail: run } : had?.fail ? { fail: had.fail } : {}),
    }
  }
  const ids = Object.keys(out)
  if (ids.length <= RUNS_KEPT) return out
  const at = (id: string) => out[id]?.last.at ?? 0
  const keep = new Set(ids.sort((a, b) => at(b) - at(a)).slice(0, RUNS_KEPT))
  return Object.fromEntries(Object.entries(out).filter(([id]) => keep.has(id)))
}

/** The moments seen with this one added: when it came, and its tool first among the latest. */
export function noteSeen(seen: Record<string, Seen> | undefined, event: string, tool: string, at: number): Record<string, Seen> {
  const had = seen?.[event]?.tools ?? []
  const tools = tool ? [tool, ...had.filter(t => t !== tool)].slice(0, TOOLS_KEPT) : had
  return { ...seen, [event]: { at, tools } }
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
  'not-mac': 'hoochi: the window app is macOS only',
  download: 'hoochi: could not download the window app (offline, or no release yet) — see the README',
  checksum: 'hoochi: the downloaded window app did not match its checksum, so it was not opened',
  unzip: 'hoochi: could not unpack the window app',
  update: `hoochi: could not update the window app to ${APP_VERSION}; the one you have is still running`,
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
 * ~/.hoochi/Hoochi.app, stopping a running older copy first. Returns its path, or why not.
 */
async function installApp($: EngineInterface, dir: string, old?: string): Promise<string | AppTrouble> {
  const run = (argv: string[], timeoutMs?: number) =>
    $.process.run(argv, timeoutMs ? { timeoutMs } : undefined)
  const arch = (await run(['/usr/bin/uname', '-m'])).stdout.trim() === 'arm64' ? 'arm64' : 'x64'
  const name = `Hoochi-macos-${arch}.zip`
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
  if (old !== undefined) await run(['/usr/bin/pkill', '-f', `${old}/Contents/MacOS/hoochi`])
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
  return (await activityOnDisk($, path)).lastChat
}

/** What the file holds now: other chats write it too. */
async function activityOnDisk($: EngineInterface, path: string): Promise<Pick<Activity, 'lastChat' | 'runs' | 'seen'>> {
  try {
    const o = JSON.parse((await readText($, path)) ?? '{}') as Loose
    const chat = o.lastChat as Chat | undefined
    const map = <T>(v: unknown) => (v && typeof v === 'object' ? (v as Record<string, T>) : undefined)
    return {
      lastChat: chat && typeof chat.at === 'number' && chat.place ? chat : undefined,
      runs: map<ItemRun>(o.runs),
      seen: map<Seen>(o.seen),
    }
  } catch {
    return {}
  }
}

/** Two chats' records of the same things: for each one, the record of what happened last. */
export function newerOf<T>(
  a: Record<string, T> | undefined,
  b: Record<string, T> | undefined,
  at: (v: T) => number,
): Record<string, T> {
  const out: Record<string, T> = { ...a }
  for (const [k, v] of Object.entries(b ?? {})) {
    const had = out[k]
    if (had === undefined || (at(v) ?? 0) > (at(had) ?? 0)) out[k] = v
  }
  return out
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
  const dir = `${await home($)}/.hoochi`
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

/** You sent a message here (your own Enter): this terminal is where you are chatting. */
export async function noteSent($: EngineInterface): Promise<void> {
  const dir = `${await home($)}/.hoochi`
  const [now, place] = await Promise.all([$.clock.now(), placeOf($)])
  const seen: Activity = { ...(await read($, activity)), lastChat: { at: now, place } }
  await update($, activity, () => seen)
  await $.fs.write(`${dir}/activity-claude.json`, JSON.stringify(seen))
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
  const skillList: NonNullable<ContextSnapshot['skillList']> = []
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
    skillList.push({
      name: skill.name,
      kind,
      ...(kind === 'plugin' ? { plugin: name } : {}),
      tokens: Math.round(skill.tokens),
    })
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
    ...(skillList.length > 0 ? { skillList: skillList.sort((x, y) => y.tokens - x.tokens) } : {}),
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
    const dir = `${await home($)}/.hoochi/context`
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

/** Claude Code's record of the plugins installed, and hoochi's entry in it. */
const INSTALLED = '.claude/plugins/installed_plugins.json'
const PLUGIN_KEY = 'hoochi@hoochi'
const RELOAD_CHECK_MS = 10_000

/** The newest hoochi Claude Code has installed; none when the record cannot be read. */
export function installedVersion(record: string | undefined): string | undefined {
  try {
    const plugins = (JSON.parse(record ?? '') as Loose).plugins as Loose | undefined
    const entries = plugins?.[PLUGIN_KEY]
    return (Array.isArray(entries) ? entries : [])
      .map(entry => (entry as Loose | null)?.version)
      .filter((v): v is string => typeof v === 'string' && /^\d+(\.\d+)*$/.test(v))
      .reduce<string | undefined>((best, v) => (best === undefined || newer(v, best) ? v : best), undefined)
  } catch {
    return undefined
  }
}

/** hoochi was called hookwich before 0.1.28: its folder, window and plugin went by that name. */
const OLD_DIR = '.hookwich'
export const OLD_PLUGIN_KEY = 'hookwich@hookwich'

/**
 * Moves the folder kept under the old name (~/.hookwich) to ~/.hoochi, once: what you put in,
 * the places and the records come along. The old window is stopped and its app left out, since
 * this plugin installs the new one, and ~/.hookwich is left as a link here. Nothing happens once
 * ~/.hoochi exists.
 */
export async function moveOldFolder($: EngineInterface): Promise<boolean> {
  const h = await home($)
  const old = `${h}/${OLD_DIR}`
  const dir = `${h}/.hoochi`
  const there = (p: string) => $.fs.exists(p).catch(() => false)
  if (!(await there(old)) || (await there(dir))) return false
  const run = (argv: string[]) => $.process.run(argv).catch(() => undefined)
  await run(['/usr/bin/pkill', '-f', `${old}/Hookwich.app/Contents/MacOS/hookwich`])
  if ((await run(['/bin/mv', old, dir]))?.exitCode !== 0) return false
  await run(['/bin/rm', '-rf', `${dir}/Hookwich.app`, `${dir}/.update`])
  // Chats still on the old plugin read ~/.hookwich until they reload: keep it pointing here.
  await run(['/bin/ln', '-s', dir, old])
  return true
}

/** Whether the plugin under the old name is still installed (it would open its own window). */
export function oldPluginInstalled(record: string | undefined): boolean {
  try {
    const plugins = (JSON.parse(record ?? '') as Loose).plugins as Loose | undefined
    return plugins?.[OLD_PLUGIN_KEY] !== undefined
  } catch {
    return false
  }
}

/** The version this chat last reloaded for; kept across the reload, so one that did not take is not tried again. */
const reloaded = atom({ plugin: 'hoochi', key: 'reloaded' } as const, '')

/**
 * A newer hoochi was installed (the window's Update button, or `claude plugin update`) while
 * this chat runs the old one: it runs /reload-plugins once, which Claude Code holds until the chat
 * is idle, so the new version applies here without starting Claude Code again.
 */
export async function reloadIfUpdated($: EngineInterface): Promise<boolean> {
  if (!interactive) return false
  const version = installedVersion(await readText($, `${await home($)}/${INSTALLED}`))
  if (version === undefined || !newer(version, APP_VERSION)) return false
  if ((await read($, reloaded)) === version) return false
  await update($, reloaded, () => version)
  $.ui.toast(`hoochi ${version}: reloading plugins so this chat uses it`)
  await $.command.run({ command: 'reload-plugins' })
  return true
}

/**
 * The "once" items each chat has already run, by its session id: a chat runs each one once, and
 * a new one (a new chat, or /clear) runs it again. Compacting or resuming keeps the session id.
 */
export type OnceLog = Record<string, { at: number; ids: string[] }>

/** A chat untouched this long is forgotten, so the file stays small. */
const ONCE_KEEP_MS = 30 * 24 * 60 * 60 * 1000

export function parseOnce(raw: string | undefined): OnceLog {
  let data: unknown
  try {
    data = JSON.parse(raw ?? '{}')
  } catch {
    return {}
  }
  const out: OnceLog = {}
  if (!data || typeof data !== 'object') return out
  for (const [session, v] of Object.entries(data as Loose)) {
    const o = (v && typeof v === 'object' ? v : {}) as Loose
    const ids = Array.isArray(o.ids) ? o.ids.filter((id): id is string => typeof id === 'string') : []
    out[session] = { at: typeof o.at === 'number' ? o.at : 0, ids }
  }
  return out
}

/** The log with `ids` run in `session` now, and chats gone quiet for a month dropped. */
export function noteOnce(log: OnceLog, session: string, ids: readonly string[], now: number): OnceLog {
  const out: OnceLog = {}
  for (const [s, v] of Object.entries(log)) if (now - v.at < ONCE_KEEP_MS) out[s] = v
  const had = out[session]?.ids ?? []
  out[session] = { at: now, ids: [...new Set([...had, ...ids])] }
  return out
}

/**
 * The moments hoochi serves from Claude Code's own events (prompt.submit, tool.call,
 * turn.complete, agent.spawn, session.start/end/compact) rather than the settings hooks'
 * classic ones. An organization's policy plugin (sec-default, on Team and Enterprise plans)
 * passes every classic event on beneath a person's plugins, so these would never reach hoochi
 * there. hoochi does not hook their classic events, so nothing goes in twice where both arrive.
 *
 * After changing model has no native event of its own: hoochi sees the model differ from the
 * last prompt's and puts its words in with the next prompt, where the classic hook's words would
 * have reached the model too.
 */
export const NATIVE: ReadonlySet<string> = new Set([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PostModelSwitch',
])

/**
 * The moments the window offers that have no native event: served by their classic hook alone,
 * so they work where the classic hooks reach hoochi (not under sec-default). The window keeps
 * the same list (CLASSIC_ONLY in app/src/lib/lifecycle.ts) to dim them where they cannot run.
 */
export const CLASSIC_ONLY = [
  'Setup',
  'InstructionsLoaded',
  'PreModelSwitch',
  'PostToolBatch',
  'PermissionRequest',
  'PermissionDenied',
  'Notification',
  'ConfigChange',
  'CwdChanged',
  'FileChanged',
  'DirectoryAdded',
  'Elicitation',
  'ElicitationResult',
  'MessageDisplay',
  'TaskCreated',
  'TaskCompleted',
  'TeammateIdle',
  'WorktreeCreate',
  'WorktreeRemove',
] as const

/** What one moment needs to know besides its name. */
type Moment = {
  tool: string
  /** this chat's session id, which "once per chat" goes by */
  session: string
  /** where its commands run; the project when not given */
  cwd?: string
  /** Stop's second pass: Claude already kept going once */
  secondPass?: boolean
  /** a chat opened here (not compacted): it becomes "where you last chatted" */
  opened?: boolean
  /** false where nothing can reach the model: commands still run, words are left out */
  speak?: boolean
}

/** Runs the enabled items for this moment and records it; returns what goes to the model. */
async function gather($: EngineInterface, event: string, m: Moment): Promise<string[]> {
  const dir = `${await home($)}/.hoochi`
  const config = await readConfig($, dir)
  const place = await placeOf($)
  const chosen = pick(config.claude, event, place)
  const { tool, session } = m
  const oncePath = `${dir}/once-claude.json`
  const wanted = (chosen?.items ?? []).filter(
    i => i.enabled && (!TOOL_EVENTS.has(event) || toolMatches(i.tools, tool)),
  )
  // A "once" item this chat already ran stays out until the next chat.
  const done = wanted.some(i => i.once) ? new Set(parseOnce(await readText($, oncePath))[session]?.ids) : new Set()
  const items = wanted.filter(i => !(i.once && done.has(i.id)))
  const scope: Scope = chosen?.scope ?? 'global'

  const at = await $.clock.now()
  const fired: Fired[] = []
  const ranIds = new Set<string>()
  const runs: { id: string; run: Run }[] = []
  const parts: string[] = []
  const canInject = INJECTABLE.has(event) && m.speak !== false
  const isSecondPass = m.secondPass === true
  const cwd = m.cwd || place.project

  for (const item of items) {
    if (isSecondPass) break
    if (item.kind === 'command') {
      const { text, run } = await runCommand($, item, cwd)
      fired.push({ event, at, kind: item.kind, label: labelOf(item), tool, scope, id: item.id })
      runs.push({ id: item.id, run })
      ranIds.add(item.id)
      if (text !== undefined && canInject) parts.push(text)
    } else if (canInject) {
      const words =
        item.kind === 'skill' ? skillText(item.skill) : item.kind === 'rules' ? rulesText(item.rules) : item.text
      if (words.trim() === '') continue
      parts.push(words)
      fired.push({ event, at, kind: item.kind, label: labelOf(item), tool, scope, id: item.id })
      runs.push({ id: item.id, run: { at } })
      ranIds.add(item.id)
    }
  }

  const spent = items.filter(i => i.once && ranIds.has(i.id)).map(i => i.id)
  if (spent.length > 0) {
    // Read again just before writing: other chats note theirs in the same file.
    const log = noteOnce(parseOnce(await readText($, oncePath)), session, spent, at)
    await $.fs.write(oncePath, JSON.stringify(log)).catch(() => undefined)
  }

  if (HERE.has(event) && interactive) await notePlace($, dir, place, session).catch(() => undefined)

  if (!QUIET.has(event) || fired.length > 0) {
    const before0 = await read($, activity)
    const disk = await activityOnDisk($, `${dir}/activity-claude.json`)
    const runsNow = newerOf(before0.runs, disk.runs, r => r.last?.at ?? 0)
    // Other Claude Code chats write this file too: keep the newest "where you last chatted",
    // so a chat working in the background never takes it back from the one you are typing in.
    // A chat opened here (not one compacting on its own); a message is counted by prompt.submit.
    const mine = m.opened === true && interactive ? { at, place } : before0.lastChat
    const seen: Activity = {
      lastEvent: event,
      lastAt: at,
      counts: { ...before0.counts, [event]: (before0.counts[event] ?? 0) + 1 },
      recent: [...before0.recent, ...fired].slice(-40),
      // Each item's runs and each moment, as whichever chat saw them last.
      runs: runs.length > 0 ? noteRuns(runsNow, runs) : runsNow,
      seen: noteSeen(newerOf(before0.seen, disk.seen, v => v.at ?? 0), event, tool, at),
      place,
      lastChat: newestChat(mine, disk.lastChat),
    }
    await update($, activity, () => seen)
    await $.fs.write(`${dir}/activity-claude.json`, JSON.stringify(seen)).catch(() => undefined)
  }

  return parts
}

/** A classic settings hook's moment: its items go into its answer. */
async function sandwich($: EngineInterface, event: string, e: unknown, result: unknown): Promise<unknown> {
  const o = (e ?? {}) as Loose
  const parts = await gather($, event, {
    tool: toolOf(e),
    session: typeof o.session_id === 'string' ? o.session_id : '',
    cwd: typeof o.cwd === 'string' ? o.cwd : undefined,
    secondPass: CONTINUES.has(event) && o.stop_hook_active === true,
    opened: event === 'SessionStart' && o.source !== 'compact',
  })
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

/** This chat's session id, from the engine; empty when it cannot say. */
async function sessionId($: EngineInterface): Promise<string> {
  return $.session.id().catch(() => '')
}

/** The chat whose chat-start moment already ran: a reload runs session.start again, not it. */
const startedChat = atom({ plugin: 'hoochi', key: 'started' } as const, '')

/** What the chat-start moment said, waiting for the first prompt to carry it to the model. */
let startWords: string[] = []
/** A new chat began without a session.start (/clear): its chat-start moment runs at the next prompt. */
let startOwed = false
/** hoochi made Claude keep going after a turn: that turn's end does not ask again. */
let keptGoing = false

/** Runs a moment and gives back the one block it says, if any; never throws. */
async function say($: EngineInterface, event: string, m: Moment): Promise<string | undefined> {
  try {
    const parts = await gather($, event, m)
    return parts.length > 0 ? parts.join('\n\n') : undefined
  } catch {
    return undefined
  }
}

/** A prompt hoochi itself sent to keep Claude going. */
function fromHoochi(origin: unknown): boolean {
  const o = origin as { kind?: unknown; name?: unknown } | undefined
  return o?.kind === 'plugin' && o.name === 'hoochi'
}

/**
 * Whether the classic hooks reach hoochi on this computer: `~/.hoochi/classic-claude.json`,
 * read by the window to dim the moments in CLASSIC_ONLY where they cannot run.
 */
export type ClassicReach = { reach: 'open' | 'blocked'; at: number }

/** Answered turns with no classic event at all before hoochi calls the classic hooks blocked. */
export const QUIET_TURNS = 2

/** A classic event reached hoochi in this process. */
let classicSeen = false
/** Answered turns in a row with no classic event; MessageDisplay comes with every answer. */
let quietTurns = 0
/** What this process last wrote, so it writes only a change. */
let reachWritten: ClassicReach['reach'] | undefined

/** Notes whether classic events reach hoochi, when that differs from what the file says. */
async function noteReach($: EngineInterface, reach: ClassicReach['reach']): Promise<void> {
  if (reachWritten === reach) return
  reachWritten = reach
  const path = `${await home($)}/.hoochi/classic-claude.json`
  let had: unknown
  try {
    had = JSON.parse((await readText($, path)) ?? '{}')
  } catch {
    had = {}
  }
  if ((had as Partial<ClassicReach>).reach === reach) return
  const body: ClassicReach = { reach, at: await $.clock.now() }
  await $.fs.write(path, JSON.stringify(body))
}

/** The main loop's model when the last prompt went in; undefined until hoochi first asks. */
let lastModel: string | undefined

/** The main loop's model, or undefined when the engine cannot say. */
async function modelNow($: EngineInterface): Promise<string | undefined> {
  const m = await $.session.model().catch(() => '')
  return m === '' ? undefined : m
}

/** A classic settings hook's moment, for the moments in CLASSIC_ONLY. */
async function classicMoment(
  $: EngineInterface,
  e: object,
  next: ((e: never) => Promise<unknown>) & { readonly event: string },
): Promise<never> {
  const event = next.event.slice('classic.'.length)
  const result = (await next(e as never)) as never
  classicSeen = true
  quietTurns = 0
  if (interactive) void noteReach($, 'open').catch(() => undefined)
  try {
    return (await sandwich($, event, e, result)) as never
  } catch {
    // hoochi never breaks a hook: on any trouble, the answer stays as it was
    return result
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive !== false
    const started = await next(e)
    await $.command.register({
      name: 'hoochi',
      description: 'Show or hide the hoochi window (show | hide | toggle)',
    })
    await moveOldFolder($).catch(() => false)
    if (interactive && oldPluginInstalled(await readText($, `${await home($)}/${INSTALLED}`)))
      $.ui.toast(`hookwich is now hoochi: remove the old plugin with  claude plugin uninstall ${OLD_PLUGIN_KEY}`)
    const dir = `${await home($)}/.hoochi`
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
    lastModel = await modelNow($)
    // Once per chat: a reload or a worker respawn runs session.start again.
    const session = await sessionId($)
    if ((await read($, startedChat)) !== session) {
      await update($, startedChat, () => session)
      const words = await say($, 'SessionStart', { tool: '', session, opened: true })
      startWords = words === undefined ? [] : [words]
    }
    // A reload stops this timer, and the new version's session.start starts its own.
    if (interactive) $.clock.every(RELOAD_CHECK_MS, () => void reloadIfUpdated($).catch(() => undefined))

    return started
  })

  // /context, live: after each turn (and a compaction), and while tools run.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('context')) await noteContext($, true).catch(() => undefined)
    return result
  })

  // Before and after a tool: PreToolUse's commands run first; what both say follows the result.
  on('tool.call', async ($, e, next) => {
    const tool = typeof e.tool === 'string' ? e.tool : ''
    const session = await sessionId($)
    const before = await say($, 'PreToolUse', { tool, session })
    const result = await next(e)
    void noteContext($).catch(() => undefined)
    if ('deny' in result && result.deny !== undefined) return result
    const after = await say($, result.isError ? 'PostToolUseFailure' : 'PostToolUse', { tool, session })
    const words = [before, after].filter((w): w is string => w !== undefined)
    return words.length === 0 ? result : { ...result, context: [...(result.context ?? []), ...words] }
  })

  // The end of a turn: Stop (main) or SubagentStop. Stop's words make Claude keep going, once.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'error' && e.agentId === undefined) {
      // An API error ended the turn: nothing reaches the model, so only commands run.
      await say($, 'StopFailure', { tool: '', session: await sessionId($), speak: false })
      return result
    }
    if (e.reason !== 'answer') return result
    // Every answer shown comes with classic MessageDisplay events: none at all, twice running,
    // means an organization's policy plugin passes the classic hooks by.
    if (interactive && e.agentId === undefined && !classicSeen && e.answer.trim() !== '') {
      quietTurns += 1
      if (quietTurns >= QUIET_TURNS) void noteReach($, 'blocked').catch(() => undefined)
    }
    const session = await sessionId($)
    if (e.agentId !== undefined) {
      // A subagent's turn is over: nothing more reaches it, so only commands run.
      await say($, 'SubagentStop', { tool: '', session, speak: false })
      return result
    }
    const second = keptGoing
    keptGoing = false
    const words = await say($, 'Stop', { tool: '', session, secondPass: second })
    if (words !== undefined) {
      keptGoing = true
      void $.prompt.submit({ text: words }).catch(() => {
        keptGoing = false
      })
    }
    return result
  })

  // Before and after compacting (commands only). A compacted chat forgets what chat start said:
  // it goes in again with the next prompt.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const session = await sessionId($)
    // A compaction worked out ahead of time is not the chat being compacted yet.
    const now = e.trigger !== 'precompute'
    if (now) await say($, 'PreCompact', { tool: '', session, speak: false })
    const result = await next(e)
    if (now && !('skip' in result && result.skip !== undefined))
      await say($, 'PostCompact', { tool: '', session, speak: false })
    const words = await say($, 'SessionStart', { tool: '', session })
    if (words !== undefined) startWords = [words]
    return result
  })

  // A subagent starts: what goes in follows the task it was given.
  on('agent.spawn', async ($, e, next) => {
    const words = await say($, 'SubagentStart', { tool: '', session: await sessionId($) })
    return next(words === undefined ? e : { ...e, prompt: `${e.prompt}\n\n${words}` })
  })

  on('session.end', async ($, e, next) => {
    await say($, 'SessionEnd', { tool: '', session: await sessionId($), speak: false })
    // After /clear the same process goes on with a new chat and no session.start.
    if (e.reason === 'clear') startOwed = true
    startWords = []
    return next(e)
  })

  on('command.run', { command: 'hoochi' }, async ($, e) => {
    const dir = `${await home($)}/.hoochi`
    const word = (typeof e.args === 'string' ? e.args : '').trim()
    const cmd = word === 'show' || word === 'hide' ? word : 'toggle'
    const trouble = await ensureApp($, dir)
    showTrouble($, trouble)
    await sendControl($, dir, cmd)

    return { text: trouble === undefined ? `hoochi: ${cmd}` : `${TROUBLE[trouble]}.` }
  })

  // Typing in the prompt box: "where you are chatting" moves here at the first key, not on send.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    // At most one quick check a second (two small reads); typing never waits on more.
    if (interactive && byYou(e.origin)) await noteTyping($).catch(() => undefined)
    return box
  })

  on('prompt.submit', async ($, e, next) => {
    const words: string[] = []
    // Engine notices and hoochi's own "keep going" are not your prompt.
    if (e.isMeta !== true && !fromHoochi(e.origin)) {
      const session = await sessionId($)
      if (startOwed) {
        startOwed = false
        await update($, startedChat, () => session)
        const fresh = await say($, 'SessionStart', { tool: '', session, opened: true })
        if (fresh !== undefined) startWords = [fresh]
      }
      words.push(...startWords)
      startWords = []
      // The model changed since the last prompt (/model, the picker, a fallback): say so now.
      const model = await modelNow($)
      if (model !== undefined) {
        const switched = lastModel !== undefined && model !== lastModel
        lastModel = model
        if (switched) {
          const after = await say($, 'PostModelSwitch', { tool: '', session })
          if (after !== undefined) words.push(after)
        }
      }
      const typed = await say($, 'UserPromptSubmit', { tool: '', session })
      if (typed !== undefined) words.push(typed)
      if (e.command) {
        const expanded = await say($, 'UserPromptExpansion', { tool: '', session })
        if (expanded !== undefined) words.push(expanded)
      }
    }
    const entered = await next(words.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...words] })
    if (interactive && byYou(e.origin) && !('drop' in entered)) void noteSent($).catch(() => undefined)
    return entered
  })

  // Only the moments with no native event, each named (on() takes a literal): hooking every classic
  // event would round-trip each one, and where sec-default passes them by, each says so.
  on('classic.Setup', classicMoment)
  on('classic.InstructionsLoaded', classicMoment)
  on('classic.PreModelSwitch', classicMoment)
  on('classic.PostToolBatch', classicMoment)
  on('classic.PermissionRequest', classicMoment)
  on('classic.PermissionDenied', classicMoment)
  on('classic.Notification', classicMoment)
  on('classic.ConfigChange', classicMoment)
  on('classic.CwdChanged', classicMoment)
  on('classic.FileChanged', classicMoment)
  on('classic.DirectoryAdded', classicMoment)
  on('classic.Elicitation', classicMoment)
  on('classic.ElicitationResult', classicMoment)
  on('classic.MessageDisplay', classicMoment)
  on('classic.TaskCreated', classicMoment)
  on('classic.TaskCompleted', classicMoment)
  on('classic.TeammateIdle', classicMoment)
  on('classic.WorktreeCreate', classicMoment)
  on('classic.WorktreeRemove', classicMoment)
}
