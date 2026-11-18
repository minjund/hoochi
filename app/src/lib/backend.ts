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
    from,
    scope: from === 'project' ? 'project' : 'global',
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
  })
  return [
    chat('claude', 'a1', '/Users/me/Projects/shop'),
    chat('codex', 'b2', '/Users/me/Projects/shop'),
    chat('claude', 'c3', '/Users/me/Projects/notes'),
    chat('codex', 'd4', '/Users/me/Projects/api'),
    chat('claude', 'e5', '/Users/me'),
  ]
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

export async function hideWindow(): Promise<void> {
  if (inApp) await invoke('hide_window')
}

export async function quitApp(): Promise<void> {
  if (inApp) await invoke('quit')
}

export const newId = () => Math.random().toString(36).slice(2, 10)
