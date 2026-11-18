import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Config, Fired, Item } from '../types'

// hookwich: sandwich text, commands or skills before or after any Claude Code
// hook event. The window edits ~/.hookwich/config.json; this module reads it on
// every event and puts the enabled items in. It writes activity.json for the
// window to light up, and control.json to show or hide it.

const APP_NAME = 'Hookwich.app'
const RELEASE = 'https://github.com/minjund/hookwich/releases/latest/download'
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

/** Too frequent to be worth a file write each. */
const QUIET: ReadonlySet<string> = new Set(['MessageDisplay', 'FileChanged'])

const activity = atom({ plugin: 'hookwich', key: 'activity' } as const, emptyActivity(), {
  shape: 'activity-1',
})

type Loose = Record<string, unknown>

function emptyActivity(): Activity {
  return { lastEvent: '', lastAt: 0, counts: {}, recent: [] }
}

/** Reads the config the window writes, keeping only well-formed items. */
export function parseConfig(raw: string): Config {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { version: 1, items: [] }
  }
  const list = data && typeof data === 'object' ? (data as Loose).items : undefined
  if (!Array.isArray(list)) return { version: 1, items: [] }
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
    })
  }
  return { version: 1, items }
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

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return (await $.fs.read(path)) as string
  } catch {
    return undefined
  }
}

async function readConfig($: EngineInterface, dir: string): Promise<Config> {
  const raw = await readText($, `${dir}/config.json`)
  return raw === undefined ? { version: 1, items: [] } : parseConfig(raw)
}

async function writeActivity($: EngineInterface, dir: string, next: Activity) {
  try {
    await $.fs.write(`${dir}/activity.json`, JSON.stringify(next))
  } catch {
    // the window just won't light up
  }
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

/** Fetches the app from the latest release, checking its SHA-256. */
async function installApp($: EngineInterface, dir: string): Promise<string | undefined> {
  const arch = (await $.process.run(['uname', '-m'])).stdout.trim() === 'arm64' ? 'arm64' : 'x64'
  const zip = `${dir}/Hookwich-macos-${arch}.zip`
  const url = `${RELEASE}/Hookwich-macos-${arch}.zip`
  const got = await $.process.run(['curl', '-fsSL', '-o', zip, url], { timeoutMs: 120_000 })
  const sums = await $.process.run(['curl', '-fsSL', `${url}.sha256`], { timeoutMs: 30_000 })
  if (got.exitCode !== 0 || sums.exitCode !== 0) return undefined
  const want = sums.stdout.trim().split(/\s+/)[0] ?? ''
  const have = (await $.process.run(['shasum', '-a', '256', zip])).stdout.trim().split(/\s+/)[0]
  if (want === '' || want !== have) return undefined
  const unzip = await $.process.run(['ditto', '-x', '-k', zip, dir])
  if (unzip.exitCode !== 0) return undefined
  return appPath($, dir)
}

/** Opens the window app if it is not up; installs it the first time. */
async function ensureApp($: EngineInterface, dir: string): Promise<boolean> {
  const os = (await $.process.run(['uname', '-s']).catch(() => undefined))?.stdout.trim()
  if (os !== 'Darwin') return false
  const path = (await appPath($, dir)) ?? (await installApp($, dir).catch(() => undefined))
  if (path === undefined) return false
  await $.process.run(['open', '-g', path]).catch(() => undefined)
  return true
}

async function sendControl($: EngineInterface, dir: string, cmd: 'show' | 'hide' | 'toggle') {
  await $.fs.write(`${dir}/control.json`, JSON.stringify({ cmd, at: await $.clock.now() }))
}

/** Puts the enabled items for this event into its answer. */
async function sandwich($: EngineInterface, event: string, e: unknown, result: unknown): Promise<unknown> {
  const dir = `${await home($)}/.hookwich`
  const config = await readConfig($, dir)
  const tool = toolOf(e)
  const items = config.items.filter(
    i => i.enabled && i.event === event && (!TOOL_EVENTS.has(event) || toolMatches(i.tools, tool)),
  )

  const at = await $.clock.now()
  const fired: Fired[] = []
  const ranIds = new Set<string>()
  const parts: string[] = []
  const canInject = INJECTABLE.has(event)
  const isSecondPass = CONTINUES.has(event) && (e as Loose).stop_hook_active === true
  const cwd = typeof (e as Loose).cwd === 'string' ? ((e as Loose).cwd as string) : ''

  for (const item of items) {
    if (isSecondPass) break
    if (item.kind === 'command') {
      const out = await runCommand($, item, cwd)
      fired.push({ event, at, kind: item.kind, label: labelOf(item), tool })
      ranIds.add(item.id)
      if (out !== undefined && canInject) parts.push(out)
    } else if (canInject) {
      const words = item.kind === 'skill' ? skillText(item.skill) : item.text
      if (words.trim() === '') continue
      parts.push(words)
      fired.push({ event, at, kind: item.kind, label: labelOf(item), tool })
      ranIds.add(item.id)
    }
  }

  // A "once" item switches itself off after it ran.
  const spent = items.filter(i => i.once && ranIds.has(i.id))
  if (spent.length > 0) {
    const ids = new Set(spent.map(i => i.id))
    const next2 = { ...config, items: config.items.map(i => (ids.has(i.id) ? { ...i, enabled: false } : i)) }
    await $.fs.write(`${dir}/config.json`, JSON.stringify(next2, null, 2)).catch(() => undefined)
  }

  const before0 = await read($, activity)
  const seen: Activity = {
    lastEvent: event,
    lastAt: at,
    counts: { ...before0.counts, [event]: (before0.counts[event] ?? 0) + 1 },
    recent: [...before0.recent, ...fired].slice(-40),
  }
  await update($, activity, () => seen)
  await writeActivity($, dir, seen)

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
    const started = await next(e)
    await $.command.register({
      name: 'hookwich',
      description: 'Show or hide the hookwich window (show | hide | toggle)',
    })
    const dir = `${await home($)}/.hookwich`
    if (!(await $.fs.exists(`${dir}/config.json`).catch(() => false))) {
      await $.fs.write(`${dir}/config.json`, JSON.stringify({ version: 1, items: [] }, null, 2))
    }
    void ensureApp($, dir).then(ok => {
      if (!ok) $.ui.status('hookwich: window app not installed — see the README')
    })

    return started
  })

  on('command.run', { command: 'hookwich' }, async ($, e) => {
    const dir = `${await home($)}/.hookwich`
    const word = (typeof e.args === 'string' ? e.args : '').trim()
    const cmd = word === 'show' || word === 'hide' ? word : 'toggle'
    const ok = await ensureApp($, dir)
    await sendControl($, dir, cmd)

    return {
      text: ok ? `hookwich: ${cmd}` : 'hookwich: the window app is not installed yet — see the README.',
    }
  })

  on('classic.*', async ($, e, next) => {
    const event = next.event.slice('classic.'.length)
    const result = await next(e)
    if (QUIET.has(event)) return result
    try {
      return (await sandwich($, event, e, result)) as typeof result
    } catch {
      // hookwich never breaks a hook: on any trouble, the answer stays as it was
      return result
    }
  })
}
