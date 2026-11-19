// The window's one door to the machine. Inside Tauri it calls the Rust
// commands; in a plain browser (npm run dev) it keeps everything in
// localStorage so the UI can be worked on without the app.

import { invoke, isTauri } from '@tauri-apps/api/core'

import { emptyAgent, type Activity, type AgentConfig, type Config, type Item, type Places } from './lifecycle'

export type Skill = { name: string; description: string }

export type CodexStatus = { installed: boolean; connected: boolean; path: string }

export type Snapshot = { config: Config; claude: Activity; codex: Activity; places: Places }

export const EMPTY_ACTIVITY: Activity = { lastEvent: '', lastAt: 0, counts: {}, recent: [] }

const inApp = isTauri()

/** In a browser, `?demo` fills the store with an example and `?panel` starts unfolded. */
export const browserFlags = {
  demo: !inApp && location.search.includes('demo'),
  panel: !inApp && location.search.includes('panel'),
  select: inApp ? null : new URLSearchParams(location.search).get('select'),
  agent: inApp ? null : new URLSearchParams(location.search).get('agent'),
  /** `?chat=codex`: the demo's last chat was typed in Codex, in another terminal */
  chat: inApp ? null : new URLSearchParams(location.search).get('chat'),
  /** `?scope=project|terminal`: open on that tab */
  scope: inApp ? null : new URLSearchParams(location.search).get('scope'),
}

if (browserFlags.demo) {
  const item = (id: string, event: string, kind: string, extra: object) => ({
    id,
    event,
    kind,
    text: '',
    command: '',
    mode: 'always',
    skill: '',
    tools: '',
    enabled: true,
    once: false,
    ...extra,
  })
  const now = Date.now()
  const place = {
    project: '/Users/me/Projects/shop',
    terminal: 'whitebox:terminal:a1',
    terminalLabel: 'Whitebox a1',
  }
  localStorage.setItem(
    'hookwich.config',
    JSON.stringify({
      version: 2,
      claude: {
        global: [
          item('a', 'UserPromptSubmit', 'text', { text: 'Answer in English, and keep it short.' }),
          item('b', 'PreToolUse', 'text', {
            text: 'Explain any destructive command before running it.',
            tools: 'Bash',
          }),
          item('e', 'SessionEnd', 'command', { command: 'date >> ~/.hookwich/sessions.log' }),
        ],
        projects: {
          [place.project]: [
            item('c', 'Stop', 'command', { command: 'npm test', mode: 'onFail' }),
            item('d', 'Stop', 'skill', { skill: 'code-review', enabled: false }),
          ],
        },
        terminals: {
          [place.terminal]: [item('f', 'UserPromptSubmit', 'text', { text: '한국어로 답해 줘.' })],
        },
      },
      codex: {
        global: [item('g', 'Stop', 'command', { command: 'cargo test', mode: 'onFail' })],
        projects: {},
        terminals: {},
      },
    }),
  )
  const other = {
    project: '/Users/me/Projects/blog',
    terminal: 'iterm:w0t1p0',
    terminalLabel: 'iTerm w0t1p0',
  }
  const codexLast = browserFlags.chat === 'codex'
  // `?chat=home`: the last chat was typed in a terminal outside any project folder
  const home = { project: '/Users/me', terminal: 'whitebox:terminal:e5', terminalLabel: 'Whitebox e5' }
  const homeLast = browserFlags.chat === 'home'
  const activity = (lastEvent: string, lastChat: object) =>
    JSON.stringify({
      lastEvent,
      lastAt: now + 60_000,
      counts: { SessionStart: 1, UserPromptSubmit: 6, PreToolUse: 23, PostToolUse: 22, Stop: 5 },
      recent: [
        {
          event: 'UserPromptSubmit',
          at: now - 9000,
          kind: 'text',
          label: '한국어로 답해 줘.',
          tool: '',
          scope: 'terminal',
        },
        {
          event: 'Stop',
          at: now - 3 * 3_600_000,
          kind: 'text',
          label: 'Answer in Korean.',
          tool: '',
          scope: 'global',
        },
        { event: 'Stop', at: now - 4000, kind: 'command', label: '$ npm test', tool: '', scope: 'project' },
      ],
      place,
      lastChat,
    })
  localStorage.setItem(
    'hookwich.activity.claude',
    activity(
      'PreToolUse',
      homeLast ? { at: now - 1000, place: home } : { at: codexLast ? now - 60_000 : now - 9000, place },
    ),
  )
  localStorage.setItem(
    'hookwich.activity.codex',
    activity('PreModelRequest', { at: codexLast ? now - 2000 : now - 120_000, place: other }),
  )
  localStorage.setItem(
    'hookwich.places',
    JSON.stringify({
      projects: {
        [place.project]: { lastSeen: now, git: true },
        '/Users/me/Projects/blog': { lastSeen: now - 3600_000, git: true },
        '/Users/me': { lastSeen: now - 1000, git: false },
      },
      terminals: {
        [place.terminal]: { label: 'Whitebox a1', cwd: place.project, agent: 'claude', lastSeen: now },
        'iterm:w0t1p0': {
          label: 'iTerm w0t1p0',
          cwd: '/Users/me/Projects/blog',
          agent: 'codex',
          lastSeen: now - 60_000,
        },
      },
    }),
  )
}

function parseAgent(raw: unknown): AgentConfig {
  if (!raw || typeof raw !== 'object') return emptyAgent()
  const o = raw as Partial<AgentConfig>
  return {
    global: Array.isArray(o.global) ? o.global : [],
    projects: o.projects && typeof o.projects === 'object' ? o.projects : {},
    terminals: o.terminals && typeof o.terminals === 'object' ? o.terminals : {},
  }
}

/** Version 2; a version 1 file becomes Claude's "everywhere" list. */
export function parseConfig(text: string): Config {
  try {
    const data = JSON.parse(text) as { version?: number; items?: Item[]; claude?: unknown; codex?: unknown }
    if (data.version === 2)
      return { version: 2, claude: parseAgent(data.claude), codex: parseAgent(data.codex) }
    return {
      version: 2,
      claude: { ...emptyAgent(), global: Array.isArray(data.items) ? data.items : [] },
      codex: emptyAgent(),
    }
  } catch {
    return { version: 2, claude: emptyAgent(), codex: emptyAgent() }
  }
}

export function parseActivity(text: string): Activity {
  try {
    const a = JSON.parse(text) as Partial<Activity>
    return {
      lastEvent: typeof a.lastEvent === 'string' ? a.lastEvent : '',
      lastAt: typeof a.lastAt === 'number' ? a.lastAt : 0,
      counts: a.counts && typeof a.counts === 'object' ? a.counts : {},
      recent: Array.isArray(a.recent) ? a.recent : [],
      place: a.place,
      lastChat: a.lastChat && typeof a.lastChat.at === 'number' && a.lastChat.place ? a.lastChat : undefined,
    }
  } catch {
    return EMPTY_ACTIVITY
  }
}

function parsePlaces(text: string): Places {
  try {
    const p = JSON.parse(text) as Partial<Places>
    return { projects: p.projects ?? {}, terminals: p.terminals ?? {} }
  } catch {
    return { projects: {}, terminals: {} }
  }
}

type RawSnapshot = { config: string; activityClaude: string; activityCodex: string; places: string }

export async function readState(): Promise<Snapshot> {
  const raw: RawSnapshot = inApp
    ? await invoke('read_state')
    : {
        config: localStorage.getItem('hookwich.config') ?? '{}',
        activityClaude: localStorage.getItem('hookwich.activity.claude') ?? '{}',
        activityCodex: localStorage.getItem('hookwich.activity.codex') ?? '{}',
        places: localStorage.getItem('hookwich.places') ?? '{}',
      }
  return {
    config: parseConfig(raw.config),
    claude: parseActivity(raw.activityClaude),
    codex: parseActivity(raw.activityCodex),
    places: parsePlaces(raw.places),
  }
}

export async function writeConfig(config: Config): Promise<void> {
  const text = `${JSON.stringify(config, null, 2)}\n`
  if (inApp) await invoke('write_config', { text })
  else localStorage.setItem('hookwich.config', text)
}

export async function listSkills(): Promise<Skill[]> {
  if (inApp) return invoke('list_skills')
  return [
    { name: 'code-review', description: 'Review the current diff for correctness bugs' },
    { name: 'simplify', description: 'Review changed code for reuse and simplification' },
  ]
}

/** A Claude Code or Codex chat open in a terminal right now. */
export type Running = {
  agent: 'claude' | 'codex'
  pid: number
  terminal: string
  terminalLabel: string
  cwd: string
  project: string
  /** the folder is in a git project */
  hasProject: boolean
  /** when the chat started (ms) */
  started?: number
  /** Claude Code only: false when hookwich is not running in that chat (opened before it was installed) */
  hookwich?: boolean | null
}

/** A hook set up outside hookwich: in Claude Code's settings, a plugin, or Codex's hooks.json. */
export type ExistingHook = {
  event: string
  matcher: string
  kind: string
  /** who runs it: an app, "skill: <name>", a plugin, a script */
  name: string
  detail: string
  /** "settings" | "project" | "managed" | "plugin:<name>" */
  from: string
  scope: 'global' | 'project'
  id: string
  /** switched off (it stays listed so it can be put back) */
  off: boolean
  /** how it is switched: moved out of a Claude settings file, the whole plugin, or Codex's own switch */
  toggle: 'park' | 'plugin' | 'codex'
  /** for plugin hooks: "name@marketplace" */
  plugin: string
  /** what it runs in full: the command, the address or the prompt */
  body?: string
  /** its time limit in seconds, when it sets one */
  timeout?: number | null
  /** a line about it: the skill's description, or the first comment of its script */
  about?: string
  /** the file it is written in (a settings file, a plugin's folder, Codex's hooks.json) */
  file?: string
  /** the app that put it there, when that can be told (it runs from the app, or the app serves its address) */
  origin?: { name: string; path: string } | null
}
export type ExistingHooks = Record<'claude' | 'codex', ExistingHook[]>

export async function existingHooks(project: string): Promise<ExistingHooks> {
  if (inApp) return invoke('existing_hooks', { project })
  if (!browserFlags.demo) return { claude: [], codex: [] }
  const hook = (event: string, name: string, from: string, matcher = ''): ExistingHook => ({
    id: `${event}-${name}`,
    off: localStorage.getItem(`hookwich.demo.off.${event}-${name}`) === '1',
    toggle: from.startsWith('plugin:') ? 'plugin' : 'park',
    plugin: from.startsWith('plugin:') ? `${from.slice(7)}@demo` : '',
    event,
    matcher,
    kind: 'command',
    name,
    detail: `${name} hook`,
    body: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${name.replace('skill: ', '')}.mjs" ${event}`,
    timeout: event === 'SessionStart' ? 30 : null,
    about: name.startsWith('skill:') ? 'Keeps your notes in step at the start of a chat.' : '',
    from,
    scope: from === 'project' ? 'project' : 'global',
    file: from.startsWith('plugin:') ? `~/.claude/plugins/cache/demo/${from.slice(7)}/1.0.0` : '~/.claude/settings.json',
    origin: name === 'Desk Pet' ? { name: 'Desk Pet', path: '/Applications/Desk Pet.app' } : null,
  })
  const inProject = (list: ExistingHook[]) => list.filter(h => project !== '' || h.scope === 'global')
  return {
    claude: inProject([
      hook('SessionStart', 'skill: notes', 'plugin:team-tools', 'startup'),
      hook('UserPromptSubmit', 'skill: helper', 'plugin:helper'),
      hook('PreToolUse', 'Desk Pet', 'settings'),
      hook('PreToolUse', 'termapp', 'settings', 'AskUserQuestion'),
      hook('Stop', 'memory', 'plugin:memory'),
      hook('Stop', 'lint', 'project'),
    ]),
    codex: [hook('Stop', 'ChatBridge', 'settings'), hook('PreToolUse', 'termapp', 'settings')],
  }
}

export async function runningChats(): Promise<Running[]> {
  if (inApp) return invoke('running_chats')
  if (!browserFlags.demo) return []
  const chat = (agent: Running['agent'], id: string, project: string): Running => ({
    agent,
    pid: 1,
    terminal: `whitebox:terminal:${id}`,
    terminalLabel: `Whitebox ${id}`,
    cwd: project,
    project,
    hasProject: project !== '/Users/me',
    started: 1_795_000_000_000,
    hookwich: agent === 'claude' ? true : null,
  })
  return [
    chat('claude', 'a1', '/Users/me/Projects/shop'),
    chat('codex', 'b2', '/Users/me/Projects/shop'),
    // `?unhooked`: one Claude Code chat opened before hookwich was installed
    { ...chat('claude', 'c3', '/Users/me/Projects/notes'), hookwich: !location.search.includes('unhooked') },
    chat('codex', 'd4', '/Users/me/Projects/api'),
    chat('claude', 'e5', '/Users/me'),
  ]
}

/** One row of the /context breakdown. */
export type ContextRow = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

/** What /context shows for one terminal's Claude Code chat: ~/.hookwich/context/<terminal>.json */
export type ContextSnapshot = {
  at: number
  model: string
  used: number
  max: number
  percent: number
  compactAt?: number
  rows: ContextRow[]
  memory: { path: string; tokens: number }[]
  mcp: { server: string; tools: number; tokens: number }[]
  skills?: { count: number; tokens: number }
  skillGroups: SkillGroup[]
  /** every listed skill, biggest first */
  skillList: { name: string; kind: SkillGroup['kind']; plugin?: string; tokens: number }[]
  agents: { name: string; source: string; tokens: number }[]
}

/** Where listed skills come from: a plugin (by name), your own, the project's, built in. */
export type SkillGroup = {
  kind: 'plugin' | 'user' | 'project' | 'builtin' | 'synced' | 'other'
  name: string
  skills: number
  tokens: number
}

function parseContext(v: unknown): ContextSnapshot | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<ContextSnapshot>
  if (typeof o.used !== 'number' || typeof o.max !== 'number' || !Array.isArray(o.rows)) return null
  return {
    at: typeof o.at === 'number' ? o.at : 0,
    model: typeof o.model === 'string' ? o.model : '',
    used: o.used,
    max: o.max,
    percent: typeof o.percent === 'number' ? o.percent : Math.round((o.used / Math.max(o.max, 1)) * 100),
    compactAt: typeof o.compactAt === 'number' ? o.compactAt : undefined,
    rows: o.rows.filter(r => r && typeof r.name === 'string' && typeof r.tokens === 'number'),
    memory: Array.isArray(o.memory) ? o.memory : [],
    mcp: Array.isArray(o.mcp) ? o.mcp : [],
    skills: o.skills,
    skillGroups: Array.isArray(o.skillGroups) ? o.skillGroups : [],
    skillList: Array.isArray(o.skillList) ? o.skillList : [],
    agents: Array.isArray(o.agents) ? o.agents : [],
  }
}

/** /context for a terminal, as its chat last wrote it; null before the plugin wrote any. */
export async function contextUsage(terminal: string): Promise<ContextSnapshot | null> {
  if (inApp) return parseContext(await invoke('context_usage', { terminal }))
  if (!browserFlags.demo) return null
  const used = 61_400
  return {
    at: Date.now() - 3000,
    model: 'claude-opus-5-5',
    used,
    max: 200_000,
    percent: 31,
    compactAt: 167_000,
    rows: [
      { name: 'System prompt', tokens: 3100, kind: 'used' },
      { name: 'System tools', tokens: 14_800, kind: 'used' },
      { name: 'MCP tools', tokens: 6200, kind: 'used' },
      { name: 'Memory files', tokens: 2300, kind: 'used' },
      { name: 'Skills', tokens: 1900, kind: 'used' },
      { name: 'Messages', tokens: 33_100, kind: 'used' },
      { name: 'Free space', tokens: 105_600, kind: 'free' },
      { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
      { name: 'MCP tools (deferred)', tokens: 48_200, kind: 'deferred' },
    ],
    memory: [
      { path: '~/.claude/CLAUDE.md', tokens: 1400 },
      { path: '~/Projects/shop/CLAUDE.md', tokens: 900 },
    ],
    mcp: [
      { server: 'docs', tools: 2, tokens: 3900 },
      { server: 'browser', tools: 6, tokens: 2300 },
    ],
    skills: { count: 18, tokens: 1900 },
    skillGroups: [
      { kind: 'plugin', name: 'review-kit', skills: 9, tokens: 1100 },
      { kind: 'user', name: '', skills: 6, tokens: 520 },
      { kind: 'builtin', name: '', skills: 3, tokens: 280 },
    ],
    agents: [{ name: 'tester', source: 'review-kit', tokens: 300 }],
    skillList: [
      ...Array.from({ length: 9 }, (_, i) => ({
        name: `review-kit:step-${i + 1}`,
        kind: 'plugin' as const,
        plugin: 'review-kit',
        tokens: 160 - i * 10,
      })),
      ...['notes', 'deploy', 'daily', 'draft', 'ideas', 'tidy'].map((name, i) => ({
        name,
        kind: 'user' as const,
        tokens: 120 - i * 10,
      })),
      ...['simplify', 'loop', 'init'].map((name, i) => ({
        name,
        kind: 'builtin' as const,
        tokens: 100 - i * 10,
      })),
    ],
  }
}

/** Skills switched off (skillOverrides "off"), and every plugin with whether it is on. */
export type SkillState = { off: string[]; plugins: { name: string; key: string; on: boolean }[] }

function demoSkillState(): SkillState {
  const off = JSON.parse(localStorage.getItem('hookwich.demo.skillsOff') ?? '[]') as string[]
  const pluginOff = localStorage.getItem('hookwich.demo.pluginOff') === '1'
  return { off, plugins: [{ name: 'review-kit', key: 'review-kit@demo', on: !pluginOff }] }
}

export async function skillState(): Promise<SkillState> {
  if (inApp) return invoke('skill_state')
  return demoSkillState()
}

/** Switches one skill of your own (or a built-in one) off or back on. */
export async function setSkill(name: string, on: boolean): Promise<SkillState> {
  if (inApp) return invoke('set_skill', { name, on })
  const off = new Set(demoSkillState().off)
  if (on) off.delete(name)
  else off.add(name)
  localStorage.setItem('hookwich.demo.skillsOff', JSON.stringify([...off]))
  return demoSkillState()
}

/** Switches a whole plugin off or back on, for its skills. */
export async function setPlugin(key: string, on: boolean): Promise<SkillState> {
  if (inApp) return invoke('set_plugin', { key, on })
  localStorage.setItem('hookwich.demo.pluginOff', on ? '0' : '1')
  return demoSkillState()
}

/** Whether a newer hookwich is out, and what the last update did (told once). */
export type UpdateState = {
  current: string
  latest: string | null
  available: boolean
  updated: { from: string; to: string; plugin: boolean } | null
}

export async function checkUpdate(): Promise<UpdateState> {
  if (inApp) return invoke('check_update')
  // `?update`: the demo has a newer version out; `?updated`: the demo just updated
  const flags = new URLSearchParams(location.search)
  return {
    current: '0.1.11',
    latest: flags.has('update') ? '0.1.12' : '0.1.11',
    available: flags.has('update'),
    updated: flags.has('updated')
      ? { from: '0.1.11', to: '0.1.12', plugin: flags.get('updated') !== 'noplugin' }
      : null,
  }
}

/** Updates the plugin and the window; the window then reopens as the new version. */
export async function applyUpdate(version: string): Promise<{ version: string; plugin: boolean }> {
  if (inApp) return invoke('apply_update', { version })
  await new Promise(r => setTimeout(r, 1200))
  return { version, plugin: true }
}

/** Switches one existing hook off or back on, and returns the fresh list. */
export async function setExistingHook(project: string, id: string, on: boolean): Promise<ExistingHooks> {
  if (inApp) return invoke('set_existing_hook', { project, id, on })
  if (on) localStorage.removeItem(`hookwich.demo.off.${id}`)
  else localStorage.setItem(`hookwich.demo.off.${id}`, '1')
  return existingHooks(project)
}

export async function codexStatus(): Promise<CodexStatus> {
  if (inApp) return invoke('codex_status')
  return {
    installed: true,
    connected: localStorage.getItem('hookwich.codex') === 'on',
    path: '~/.codex/hooks.json',
  }
}

export async function codexConnect(): Promise<CodexStatus> {
  if (inApp) return invoke('codex_connect')
  localStorage.setItem('hookwich.codex', 'on')
  return codexStatus()
}

export async function codexDisconnect(): Promise<CodexStatus> {
  if (inApp) return invoke('codex_disconnect')
  localStorage.removeItem('hookwich.codex')
  return codexStatus()
}

export async function setExpanded(expanded: boolean): Promise<void> {
  if (inApp) await invoke('set_expanded', { expanded })
}

export async function startDrag(): Promise<void> {
  if (inApp) await invoke('start_drag')
}

/** The bubble's right-click menu (native): hide to the menu bar, or quit. */
export async function bubbleMenu(hide: string, quit: string): Promise<void> {
  if (inApp) await invoke('bubble_menu', { hide, quit })
}

export async function hideWindow(): Promise<void> {
  if (inApp) await invoke('hide_window')
}

export async function quitApp(): Promise<void> {
  if (inApp) await invoke('quit')
}

export const newId = () => Math.random().toString(36).slice(2, 10)
