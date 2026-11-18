// The window's one door to the machine. Inside Tauri it calls the Rust
// commands; in a plain browser (npm run dev) it keeps everything in
// localStorage so the UI can be worked on without the app.

import { invoke, isTauri } from '@tauri-apps/api/core'

import type { Activity, Config, Item } from './lifecycle'

export type Skill = { name: string; description: string }

export const EMPTY_ACTIVITY: Activity = { lastEvent: '', lastAt: 0, counts: {}, recent: [] }

const inApp = isTauri()

/** In a browser, `?demo` fills the store with an example and `?panel` starts unfolded. */
export const browserFlags = {
  demo: !inApp && location.search.includes('demo'),
  panel: !inApp && location.search.includes('panel'),
  select: inApp ? null : new URLSearchParams(location.search).get('select'),
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
  localStorage.setItem(
    'hookwich.config',
    JSON.stringify({
      version: 1,
      items: [
        item('a', 'UserPromptSubmit', 'text', { text: 'Answer in English, and keep it short.' }),
        item('b', 'PreToolUse', 'text', {
          text: 'Explain any destructive command before running it.',
          tools: 'Bash',
        }),
        item('c', 'Stop', 'command', { command: 'npm test', mode: 'onFail' }),
        item('d', 'Stop', 'skill', { skill: 'code-review', enabled: false }),
        item('e', 'SessionEnd', 'command', { command: 'date >> ~/.hookwich/sessions.log' }),
      ],
    }),
  )
  localStorage.setItem(
    'hookwich.activity',
    JSON.stringify({
      lastEvent: 'PreToolUse',
      lastAt: now + 60_000,
      counts: { SessionStart: 1, UserPromptSubmit: 6, PreToolUse: 23, PostToolUse: 22, Stop: 5 },
      recent: [
        {
          event: 'UserPromptSubmit',
          at: now - 9000,
          kind: 'text',
          label: 'Answer in English, and keep it short.',
          tool: '',
        },
        { event: 'Stop', at: now - 4000, kind: 'command', label: '$ npm test', tool: '' },
        {
          event: 'PreToolUse',
          at: now - 1000,
          kind: 'text',
          label: 'Explain any destructive command before running it.',
          tool: 'Bash',
        },
      ],
    }),
  )
}

export function parseConfig(text: string): Config {
  try {
    const data = JSON.parse(text) as { items?: unknown }
    return { version: 1, items: Array.isArray(data.items) ? (data.items as Item[]) : [] }
  } catch {
    return { version: 1, items: [] }
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
    }
  } catch {
    return EMPTY_ACTIVITY
  }
}

export async function readState(): Promise<{ config: string; activity: string }> {
  if (inApp) return invoke('read_state')
  return {
    config: localStorage.getItem('hookwich.config') ?? '{"version":1,"items":[]}',
    activity: localStorage.getItem('hookwich.activity') ?? '{}',
  }
}

export async function writeConfig(config: Config): Promise<string> {
  const text = `${JSON.stringify(config, null, 2)}\n`
  if (inApp) await invoke('write_config', { text })
  else localStorage.setItem('hookwich.config', text)
  return text
}

export async function listSkills(): Promise<Skill[]> {
  if (inApp) return invoke('list_skills')
  return [
    { name: 'code-review', description: 'Review the current diff for correctness bugs' },
    { name: 'simplify', description: 'Review changed code for reuse and simplification' },
  ]
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
