/** What a slot puts in: words, a shell command's output, or a skill to use. */
export type ItemKind = 'text' | 'command' | 'skill'

/** One thing sandwiched into the lifecycle, as ~/.hookwich/config.json holds it. */
export type Item = {
  id: string
  /** The Claude Code hook event it goes into: PreToolUse, Stop, SessionStart, ... */
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
}

export type Config = { version: 1; items: Item[] }

/** One time hookwich put something in, for the window's feed. */
export type Fired = { event: string; at: number; kind: ItemKind; label: string; tool: string }

/** What the window reads to light up the lifecycle: ~/.hookwich/activity.json */
export type Activity = {
  lastEvent: string
  lastAt: number
  counts: Record<string, number>
  recent: Fired[]
}

declare module 'claude-code' {
  interface PluginState {
    hookwich: { activity: Shaped<Activity> }
  }
}
