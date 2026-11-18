// The Claude Code hook lifecycle as hookwich draws it. Every hook event is a
// slot: put text, commands or skills into it and the plugin hands them over
// when that event fires. The diagram's layout follows the official hooks
// lifecycle figure: https://code.claude.com/docs/en/hooks#hook-lifecycle

export type ItemKind = 'text' | 'command' | 'skill'

/** One thing put into a slot. Mirrors plugin/types/index.d.ts. */
export type Item = {
  id: string
  event: string
  kind: ItemKind
  text: string
  command: string
  mode: 'always' | 'onFail'
  skill: string
  tools: string
  enabled: boolean
  once: boolean
}

export type Config = { version: 1; items: Item[] }

export type Fired = { event: string; at: number; kind: ItemKind; label: string; tool: string }

export type Activity = {
  lastEvent: string
  lastAt: number
  counts: Record<string, number>
  recent: Fired[]
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

/** Every hook event, in the order of the official lifecycle figure. */
export const ALL_SLOTS: Slot[] = [
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

export const slotOf = (event: string): Slot | undefined => ALL_SLOTS.find(s => s.event === event)

/** A short label for an item, for chips and the feed. */
export function itemLabel(item: Item): string {
  const raw =
    item.kind === 'text' ? item.text : item.kind === 'command' ? `$ ${item.command}` : `/${item.skill}`
  const one = raw.replace(/\s+/g, ' ').trim()
  return one.length > 40 ? `${one.slice(0, 39)}…` : one || '(empty)'
}
