/** What a slot puts in: words, a shell command's output, or a skill to use. */
export type ItemKind = 'text' | 'command' | 'skill'

/** One thing put into a moment, as ~/.hookwich/config.json holds it. */
export type Item = {
  id: string
  /** The hook event it goes into: PreToolUse, Stop, SessionStart, ... */
  event: string
  kind: ItemKind
  /** kind "text": the words handed to the model */
  text: string
  /** kind "command": a shell command run in the session's folder */
  command: string
  /** kind "command": put its output in always, or only when it fails */
  mode: 'always' | 'onFail'
  /** kind "skill": the skill's name */
  skill: string
  /** tool events only: comma-separated tool names; empty means every tool */
  tools: string
  enabled: boolean
  /** runs once, then switches itself off */
  once: boolean
  /** when it was put in (ms), to list the newest first */
  added?: number
}

/**
 * One agent's items at three scopes. For a moment, the narrowest scope that has
 * any item for it wins: this terminal, else this project, else everywhere.
 */
export type AgentConfig = {
  global: Item[]
  /** keyed by the project's folder (its git top-level when it has one) */
  projects: Record<string, Item[]>
  /** keyed by the terminal's id (see Place.terminal) */
  terminals: Record<string, Item[]>
}

export type Config = { version: 2; claude: AgentConfig; codex: AgentConfig }

export type Scope = 'global' | 'project' | 'terminal'

/** Where a session runs: its project folder and its terminal. */
export type Place = {
  project: string
  /** e.g. "whitebox:terminal:abc", "iterm:w0t1p0:…", "session:<id>" */
  terminal: string
  /** a short human label for the terminal */
  terminalLabel: string
}

/** One time hookwich put something in, for the window's feed. */
export type Fired = {
  event: string
  at: number
  kind: ItemKind
  label: string
  tool: string
  scope: Scope
  /** the item that was put in, so the window can tell when it has since been deleted */
  id?: string
}

/** What the window reads to light up the lifecycle: ~/.hookwich/activity-<agent>.json */
export type Activity = {
  lastEvent: string
  lastAt: number
  counts: Record<string, number>
  recent: Fired[]
  /** where the last event happened, so the window can open on it */
  place?: Place
  /** when and where you last opened or typed a chat, so the window can follow you */
  lastChat?: { at: number; place: Place }
}

/** One row of the breakdown, as /context lists it. */
export type ContextRow = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

/**
 * What /context shows for one terminal's chat, kept fresh while it works:
 * ~/.hookwich/context/<terminal file>.json, read by the window.
 */
export type ContextSnapshot = {
  v: 1
  at: number
  place: Place
  model: string
  /** tokens in use and the window measured against, as /context counts them */
  used: number
  max: number
  percent: number
  /** the token count at which auto-compaction runs, when it is on */
  compactAt?: number
  rows: ContextRow[]
  /** the biggest memory files, MCP servers and the skill listing, as /context lists them */
  memory: { path: string; tokens: number }[]
  mcp: { server: string; tools: number; tokens: number }[]
  skills?: { count: number; tokens: number }
}

declare module 'claude-code' {
  interface PluginState {
    hookwich: { activity: Shaped<Activity> }
  }
}
