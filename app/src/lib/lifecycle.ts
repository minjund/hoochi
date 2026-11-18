// The Claude Code lifecycle as hookwich draws it: each stage is a sandwich,
// with a slot before it and a slot after it. A slot is one hook event.

export type ItemKind = 'text' | 'command' | 'skill'

/** One thing sandwiched into a slot. Mirrors plugin/types/index.d.ts. */
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
  /** short label shown on the bread */
  label: string
  /** can words reach the model here? If not, only commands run (side effects). */
  canInject: boolean
  /** tool events take a tool filter */
  hasTools: boolean
  /** one line on what happens when something is put here */
  hint: string
}

export type Stage = {
  id: string
  /** the filling */
  name: string
  before: Slot
  after: Slot
}

const slot = (event: string, label: string, canInject: boolean, hint: string, hasTools = false): Slot => ({
  event,
  label,
  canInject,
  hasTools,
  hint,
})

/** The main lifecycle, in the order it happens. */
export const STAGES: Stage[] = [
  {
    id: 'session',
    name: 'Session',
    before: slot(
      'SessionStart',
      'start',
      true,
      'Given to the model when a session starts, resumes, clears or compacts.',
    ),
    after: slot('SessionEnd', 'end', false, 'Runs when the session ends. Commands only: the model is gone.'),
  },
  {
    id: 'prompt',
    name: 'Prompt',
    before: slot('UserPromptSubmit', 'before', true, 'Sent with every prompt you submit.'),
    after: slot('Stop', 'after', true, 'When Claude is about to stop: it keeps going once with this.'),
  },
  {
    id: 'tool',
    name: 'Tool call',
    before: slot('PreToolUse', 'before', true, 'Attached to each tool call before it runs.', true),
    after: slot('PostToolUse', 'after', true, 'Attached to each tool result.', true),
  },
  {
    id: 'subagent',
    name: 'Subagent',
    before: slot('SubagentStart', 'start', true, 'Given to a subagent when it starts.'),
    after: slot(
      'SubagentStop',
      'end',
      true,
      'When a subagent is about to finish: it keeps going once with this.',
    ),
  },
  {
    id: 'compact',
    name: 'Compaction',
    before: slot('PreCompact', 'before', false, 'Runs before the conversation is compacted. Commands only.'),
    after: slot(
      'PostCompact',
      'after',
      false,
      'Runs after compaction. Commands only (Session start also fires).',
    ),
  },
]

/** Every other hook event, for "anywhere you like". */
export const MORE_SLOTS: Slot[] = [
  slot('PostToolUseFailure', 'tool failed', true, 'Attached when a tool call fails.', true),
  slot('PostToolBatch', 'after tool batch', true, 'After a batch of parallel tool calls.'),
  slot(
    'UserPromptExpansion',
    'prompt expanded',
    true,
    'When a slash command or skill expands into a prompt.',
  ),
  slot('Setup', 'setup', true, 'During first-run setup.'),
  slot('PostModelSwitch', 'model switched', true, 'After the model changes.'),
  slot('Notification', 'notification', false, 'When Claude Code sends a notification. Commands only.'),
  slot('PermissionRequest', 'permission asked', false, 'When a permission prompt appears. Commands only.'),
  slot('PermissionDenied', 'permission denied', false, 'When a tool call is denied. Commands only.'),
  slot('StopFailure', 'turn failed', false, 'When a turn ends in an API error. Commands only.'),
  slot('PreModelSwitch', 'before model switch', false, 'Before the model changes. Commands only.'),
  slot('CwdChanged', 'folder changed', false, 'When the working folder changes. Commands only.'),
  slot('FileChanged', 'file changed', false, 'When a watched file changes. Commands only.'),
  slot('InstructionsLoaded', 'instructions loaded', false, 'When CLAUDE.md files load. Commands only.'),
  slot('TaskCreated', 'task created', false, 'When a task is created. Commands only.'),
  slot('TaskCompleted', 'task completed', false, 'When a task completes. Commands only.'),
  slot('TeammateIdle', 'teammate idle', false, 'When a teammate goes idle. Commands only.'),
  slot('WorktreeCreate', 'worktree created', false, 'When a worktree is created. Commands only.'),
  slot('WorktreeRemove', 'worktree removed', false, 'When a worktree is removed. Commands only.'),
]

export const ALL_SLOTS: Slot[] = [...STAGES.flatMap(s => [s.before, s.after]), ...MORE_SLOTS]

export const slotOf = (event: string): Slot | undefined => ALL_SLOTS.find(s => s.event === event)

/** A short label for an item, for chips and the feed. */
export function itemLabel(item: Item): string {
  const raw =
    item.kind === 'text' ? item.text : item.kind === 'command' ? `$ ${item.command}` : `/${item.skill}`
  const one = raw.replace(/\s+/g, ' ').trim()
  return one.length > 40 ? `${one.slice(0, 39)}…` : one || '(empty)'
}
