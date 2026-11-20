// The Claude Code hook lifecycle as hookwich draws it. Every hook event is a
// slot: put text, commands or skills into it and the plugin hands them over
// when that event fires. The diagram's layout follows the official hooks
// lifecycle figure: https://code.claude.com/docs/en/hooks#hook-lifecycle

export type ItemKind = 'text' | 'command' | 'skill' | 'rules'

/** One row of a "rules" item: in this situation, use this skill. */
export type SkillRule = { when: string; skill: string }

/** One thing put into a slot. Mirrors plugin/types/index.d.ts. */
export type Item = {
  id: string
  event: string
  kind: ItemKind
  text: string
  command: string
  mode: 'always' | 'onFail'
  skill: string
  /** kind "rules": which skill to use when (older configs have none) */
  rules?: SkillRule[]
  tools: string
  enabled: boolean
  /** once per chat: a new chat or /clear runs it again */
  once: boolean
  /** when it was put in (ms), to list the newest first */
  added?: number
}

/** One agent's items at three scopes; the narrowest scope with items for a moment wins. */
export type AgentConfig = {
  global: Item[]
  projects: Record<string, Item[]>
  terminals: Record<string, Item[]>
}

export type Config = { version: 2; claude: AgentConfig; codex: AgentConfig }

export type Scope = 'global' | 'project' | 'terminal'

/** Where a session runs. */
export type Place = { project: string; terminal: string; terminalLabel: string }

/** Projects and terminals hookwich has seen, from ~/.hookwich/places.json. */
export type Places = {
  /** `git` is set by the app: whether the folder is a git project */
  projects: Record<string, { lastSeen: number; git?: boolean }>
  terminals: Record<string, { label: string; cwd: string; agent: string; lastSeen: number }>
}

export type Fired = {
  event: string
  at: number
  kind: ItemKind
  label: string
  tool: string
  scope?: Scope
  /** the item that was put in (older records have none) */
  id?: string
}

export type Activity = {
  lastEvent: string
  lastAt: number
  counts: Record<string, number>
  recent: Fired[]
  place?: Place
  /** when and where you last opened or typed a chat */
  lastChat?: { at: number; place: Place }
}

export type Slot = {
  /** the hook event name */
  event: string
  /** can words reach the model here? If not, only commands run (side effects). */
  canInject: boolean
  /** tool events take a tool filter */
  hasTools: boolean
}

// Plain-language names and explanations live in i18n.ts.
const slot = (event: string, canInject: boolean, _hint: string, hasTools = false): Slot => ({
  event,
  canInject,
  hasTools,
})

/** Which coding agent a moment belongs to. */
export type Agent = 'claude' | 'codex'

/** Every Claude Code hook event, in the order of the official lifecycle figure. */
export const CLAUDE_SLOTS: Slot[] = [
  slot('Setup', true, 'During first-run setup (opt-in).'),
  slot('SessionStart', true, 'Given to the model when a session starts, resumes, clears or compacts.'),
  slot('UserPromptSubmit', true, 'Sent with every prompt you submit, before the model sees it.'),
  slot('UserPromptExpansion', true, 'When a slash command expands into a prompt.'),
  slot('PreToolUse', true, 'Attached to each tool call before it runs.', true),
  slot('PermissionRequest', false, 'When a permission prompt appears. Commands only.'),
  slot('PermissionDenied', false, 'When auto mode denies a tool call. Commands only.'),
  slot('Elicitation', false, 'When an MCP server asks for input. Commands only.'),
  slot('ElicitationResult', false, 'When the MCP input comes back. Commands only.'),
  slot('PostToolUse', true, 'Attached to each tool result.', true),
  slot('PostToolUseFailure', true, 'Attached when a tool call fails.', true),
  slot('PostToolBatch', true, 'After a batch of tool calls finishes.'),
  slot('SubagentStart', true, 'Given to a subagent when it starts.'),
  slot('SubagentStop', true, 'When a subagent is about to finish: it keeps going once with this.'),
  slot('TaskCreated', false, 'When a task is created. Commands only.'),
  slot('TaskCompleted', false, 'When a task completes. Commands only.'),
  slot('Stop', true, 'When Claude is about to end its turn: it keeps going once with this.'),
  slot('StopFailure', false, 'When a turn ends in an API error. Commands only.'),
  slot('TeammateIdle', false, 'When a teammate goes idle. Commands only.'),
  slot('PreCompact', false, 'Before the conversation is compacted. Commands only.'),
  slot('PostCompact', false, 'After compaction. Commands only (Session start fires too).'),
  slot('SessionEnd', false, 'When the session ends. Commands only: the model is gone.'),
  slot('Notification', false, 'When Claude Code sends a notification. Commands only.'),
  slot('ConfigChange', false, 'When settings change. Commands only.'),
  slot('PreModelSwitch', false, 'Before the model changes. Commands only.'),
  slot('PostModelSwitch', true, 'After the model changes.'),
  slot('WorktreeCreate', false, 'When a worktree is created. Commands only.'),
  slot('WorktreeRemove', false, 'When a worktree is removed. Commands only.'),
  slot('CwdChanged', false, 'When the working folder changes. Commands only.'),
  slot('FileChanged', false, 'When a watched file changes. Commands only.'),
  slot('DirectoryAdded', false, 'When a folder is added to the session. Commands only.'),
  slot('InstructionsLoaded', false, 'When CLAUDE.md files load. Commands only.'),
  slot('MessageDisplay', false, 'When a message is shown. Commands only.'),
]

/** Every Codex hook event (https://learn.chatgpt.com/docs/hooks), in lifecycle order. */
export const CODEX_SLOTS: Slot[] = [
  slot('SessionStart', true, ''),
  slot('UserPromptSubmit', true, ''),
  slot('PreModelRequest', false, ''),
  slot('PostModelRequest', false, ''),
  slot('PreToolUse', true, '', true),
  slot('PermissionRequest', false, '', true),
  slot('PostToolUse', true, '', true),
  slot('SubagentStart', true, ''),
  slot('SubagentStop', true, ''),
  slot('Stop', true, ''),
  slot('PreCompact', false, ''),
  slot('PostCompact', false, ''),
  slot('Interrupt', false, ''),
  slot('SessionEnd', false, ''),
]

export const SLOTS: Record<Agent, Slot[]> = { claude: CLAUDE_SLOTS, codex: CODEX_SLOTS }

/**
 * Claude's moments the plugin can serve only from their classic hook (CLASSIC_ONLY in
 * plugin/hooks/register.ts): where an organization's policy plugin (sec-default) passes the
 * classic hooks by, they never run, and the window dims them.
 */
export const CLASSIC_ONLY: ReadonlySet<string> = new Set([
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
])

/** Whether the classic hooks reach hookwich on this computer, as the plugin last found. */
export type ClassicReach = 'open' | 'blocked' | 'unknown'

/** The moments that cannot run here: none unless the plugin found the classic hooks blocked. */
export function unreachable(agent: Agent, reach: ClassicReach): ReadonlySet<string> {
  return agent === 'claude' && reach === 'blocked' ? CLASSIC_ONLY : new Set()
}

/** Kept for code that only knows Claude's moments. */
export const ALL_SLOTS = CLAUDE_SLOTS

export const slotOf = (event: string, agent: Agent = 'claude'): Slot | undefined =>
  SLOTS[agent].find(s => s.event === event)

/** The rows of a "rules" item that say both when and which skill; the plugin passes only these. */
export function fullRules(rules: readonly SkillRule[] = []): SkillRule[] {
  return rules
    .map(r => ({ when: r.when.replace(/\s+/g, ' ').trim(), skill: r.skill.trim() }))
    .filter(r => r.when !== '' && r.skill !== '')
}

/** Whether an item puts anything in: not left empty. */
export function itemFilled(item: Item): boolean {
  if (item.kind === 'text') return item.text.trim() !== ''
  if (item.kind === 'command') return item.command.trim() !== ''
  if (item.kind === 'rules') return fullRules(item.rules).length > 0
  return item.skill !== ''
}

/** A short label for an item, for chips and the feed. */
export function itemLabel(item: Item): string {
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
  return one.length > 40 ? `${one.slice(0, 39)}…` : one || '(empty)'
}

export const emptyAgent = (): AgentConfig => ({ global: [], projects: {}, terminals: {} })

/** The list a scope holds (empty when it has none yet). */
export function listOf(agent: AgentConfig, scope: Scope, key: string): Item[] {
  if (scope === 'global') return agent.global
  if (scope === 'project') return agent.projects[key] ?? []
  return agent.terminals[key] ?? []
}

/** The same config with one scope's list replaced. */
export function withList(config: Config, who: Agent, scope: Scope, key: string, list: Item[]): Config {
  const a = config[who]
  const next: AgentConfig =
    scope === 'global'
      ? { ...a, global: list }
      : scope === 'project'
        ? { ...a, projects: { ...a.projects, [key]: list } }
        : { ...a, terminals: { ...a.terminals, [key]: list } }
  return { ...config, [who]: next }
}

/** Which scope decides a moment at a place: the narrowest one that has any item for it. */
export function decidingScope(agent: AgentConfig, event: string, place: Place): Scope | undefined {
  if ((agent.terminals[place.terminal] ?? []).some(i => i.event === event)) return 'terminal'
  if ((agent.projects[place.project] ?? []).some(i => i.event === event)) return 'project'
  if (agent.global.some(i => i.event === event)) return 'global'
  return undefined
}

/** Two items that do the same thing at the same moment, whatever their ids or on/off state. */
export const sameItem = (a: Item, b: Item) =>
  a.event === b.event &&
  a.kind === b.kind &&
  a.text.trim() === b.text.trim() &&
  a.command.trim() === b.command.trim() &&
  a.skill === b.skill &&
  JSON.stringify(fullRules(a.rules)) === JSON.stringify(fullRules(b.rules)) &&
  a.mode === b.mode &&
  a.tools.trim() === b.tools.trim()

/**
 * Copies `source` into `target` without overwriting: items already there are skipped, the rest
 * are added as new copies. Returns the new list and how many were added.
 */
export function mergeItems(target: Item[], source: Item[], makeId: () => string) {
  const list = [...target]
  let added = 0
  for (const item of source) {
    if (list.some(i => sameItem(i, item))) continue
    list.push({ ...item, id: makeId(), added: Date.now() })
    added += 1
  }
  return { list, added }
}
