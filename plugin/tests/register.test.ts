import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

/** A fake machine: files in a map, commands answered by `commands`. */
function machine(
  on: On,
  files: Record<string, string>,
  commands: Record<string, { exitCode: number; stdout: string }> = {},
  env: Record<string, string> = { WHITEBOX_SURFACE_ID: 'terminal:t1' },
) {
  const fs = new Map(Object.entries(files))
  const ran: string[] = []
  const vars: Record<string, string> = { HOME: '/home/me', ...env }
  on('env.get', (_, e) => ({ value: vars[e.name] }))
  on('session.root', () => ({ value: '/work/app/sub' }))
  on('fs.read', (_, e) => {
    const text = fs.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_, e) => {
    fs.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: fs.has(e.path) }))
  on('process.hookEnv', () => ({ value: {} }))
  on('process.run', (_, e) => {
    const line = e.argv[0] === '/bin/sh' ? (e.argv[2] ?? '') : e.argv.join(' ')
    ran.push(line)
    const r =
      commands[line] ??
      (line === 'git rev-parse --show-toplevel'
        ? { exitCode: 0, stdout: '/work/app\n' }
        : { exitCode: 0, stdout: '' })
    return { value: { ...r, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  let now = 1_000
  on('clock.now', () => ({ value: (now += 10) }))
  return { fs, ran }
}

const CONFIG = '/home/me/.hookwich/config.json'
const ACTIVITY = '/home/me/.hookwich/activity-claude.json'

const item = (over: Record<string, unknown>) => ({
  id: 'i1',
  event: 'UserPromptSubmit',
  kind: 'text',
  text: '',
  command: '',
  mode: 'always',
  skill: '',
  tools: '',
  enabled: true,
  once: false,
  ...over,
})

const config = (...items: Record<string, unknown>[]) => JSON.stringify({ version: 1, items })

test('text before a prompt reaches the model, after the settings hooks', async ($, on) => {
  const { fs } = machine(on, { [CONFIG]: config(item({ text: 'Answer in English.' })) })
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['from settings'] }))

  const r = await $.classic.UserPromptSubmit({ prompt: 'hi' })
  expect(r.additionalContext).toEqual(['from settings', 'Answer in English.'])

  const seen = JSON.parse(fs.get(ACTIVITY) ?? '{}')
  expect(seen.lastEvent).toBe('UserPromptSubmit')
  expect(seen.counts.UserPromptSubmit).toBe(1)
  expect(seen.recent[0].label).toBe('Answer in English.')
})

test('a disabled item and another event put nothing in', async ($, on) => {
  machine(on, {
    [CONFIG]: config(item({ text: 'off', enabled: false }), item({ id: 'i2', event: 'Stop', text: 'later' })),
  })
  on('classic.UserPromptSubmit', () => ({}))

  const r = await $.classic.UserPromptSubmit({ prompt: 'hi' })
  expect(r.additionalContext).toBeUndefined()
})

test('a skill item asks the model to use the skill', async ($, on) => {
  machine(on, { [CONFIG]: config(item({ kind: 'skill', skill: 'code-review' })) })
  on('classic.UserPromptSubmit', () => ({}))

  const r = await $.classic.UserPromptSubmit({ prompt: 'hi' })
  expect(r.additionalContext?.[0]).toContain('"code-review" skill')
})

test('a tool item goes only to the tools named', async ($, on) => {
  machine(on, {
    [CONFIG]: config(item({ event: 'PostToolUse', text: 'Summarise it.', tools: 'Bash, Edit' })),
  })
  on('classic.PostToolUse', () => ({}))
  const base = { tool_input: {}, tool_response: {}, tool_use_id: 't1' }

  expect((await $.classic.PostToolUse({ ...base, tool_name: 'Bash' })).additionalContext).toEqual([
    'Summarise it.',
  ])
  expect((await $.classic.PostToolUse({ ...base, tool_name: 'Read' })).additionalContext).toBeUndefined()
})

test('a failing test command after the turn makes Claude keep going once', async ($, on) => {
  const { ran } = machine(
    on,
    { [CONFIG]: config(item({ event: 'Stop', kind: 'command', command: 'npm test', mode: 'onFail' })) },
    { 'npm test': { exitCode: 1, stdout: '1 failing' } },
  )
  on('classic.Stop', () => ({}))

  const first = await $.classic.Stop({ stop_hook_active: false })
  expect(first.block).toContain('$ npm test (exit 1)')
  expect(first.block).toContain('1 failing')

  // The second stop of the same turn is let through: no loop.
  const second = await $.classic.Stop({ stop_hook_active: true })
  expect(second.block).toBeUndefined()
  expect(ran.filter(l => l === 'npm test').length).toBe(1)
})

test('a passing command set to "only on failure" puts nothing in', async ($, on) => {
  machine(
    on,
    { [CONFIG]: config(item({ event: 'Stop', kind: 'command', command: 'npm test', mode: 'onFail' })) },
    { 'npm test': { exitCode: 0, stdout: 'ok' } },
  )
  on('classic.Stop', () => ({}))

  expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
})

test('a command at an event the model cannot hear still runs', async ($, on) => {
  const { ran } = machine(on, {
    [CONFIG]: config(item({ event: 'SessionEnd', kind: 'command', command: 'echo bye >> log' })),
  })
  on('classic.SessionEnd', () => ({}))

  await $.classic.SessionEnd({ reason: 'other' })
  expect(ran).toContain('echo bye >> log')
})

test('a "once" item switches itself off after it ran', async ($, on) => {
  const { fs } = machine(on, { [CONFIG]: config(item({ text: 'Just this once.', once: true })) })
  on('classic.UserPromptSubmit', () => ({}))

  expect((await $.classic.UserPromptSubmit({ prompt: 'a' })).additionalContext).toEqual(['Just this once.'])
  expect(JSON.parse(fs.get(CONFIG) ?? '{}').claude.global[0].enabled).toBe(false)
  expect((await $.classic.UserPromptSubmit({ prompt: 'b' })).additionalContext).toBeUndefined()
})

test('a broken config never breaks the hook', async ($, on) => {
  machine(on, { [CONFIG]: '{ not json' })
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['from settings'] }))

  expect((await $.classic.UserPromptSubmit({ prompt: 'a' })).additionalContext).toEqual(['from settings'])
})

test('a command on a frequent event still runs, and only then is it logged', async ($, on) => {
  const { fs, ran } = machine(on, {
    [CONFIG]: config(item({ event: 'FileChanged', kind: 'command', command: 'make docs' })),
  })
  on('classic.FileChanged', () => ({}))

  await $.classic.FileChanged({ file_path: '/p/README.md', event: 'change' })
  expect(ran).toContain('make docs')
  expect(JSON.parse(fs.get(ACTIVITY) ?? '{}').lastEvent).toBe('FileChanged')
})

const v2 = (claude: Record<string, unknown>) =>
  JSON.stringify({ version: 2, claude: { global: [], projects: {}, terminals: {}, ...claude }, codex: {} })

test('this terminal beats this project, which beats everywhere', async ($, on) => {
  machine(on, {
    [CONFIG]: v2({
      global: [item({ text: 'global' })],
      projects: { '/work/app': [item({ id: 'p', text: 'project' })] },
      terminals: { 'whitebox:terminal:t1': [item({ id: 't', text: 'terminal' })] },
    }),
  })
  on('classic.UserPromptSubmit', () => ({}))

  expect((await $.classic.UserPromptSubmit({ prompt: 'hi' })).additionalContext).toEqual(['terminal'])
})

test('another terminal of the same project gets the project items', async ($, on) => {
  machine(
    on,
    {
      [CONFIG]: v2({
        global: [item({ text: 'global' })],
        projects: { '/work/app': [item({ id: 'p', text: 'project' })] },
        terminals: { 'whitebox:terminal:t1': [item({ id: 't', text: 'terminal' })] },
      }),
    },
    {},
    { WHITEBOX_SURFACE_ID: 'terminal:t2' },
  )
  on('classic.UserPromptSubmit', () => ({}))

  expect((await $.classic.UserPromptSubmit({ prompt: 'hi' })).additionalContext).toEqual(['project'])
})

test('a switched-off item in the project silences the global one there', async ($, on) => {
  machine(on, {
    [CONFIG]: v2({
      global: [item({ text: 'global' })],
      projects: { '/work/app': [item({ id: 'p', text: 'quiet here', enabled: false })] },
    }),
  })
  on('classic.UserPromptSubmit', () => ({}))

  expect((await $.classic.UserPromptSubmit({ prompt: 'hi' })).additionalContext).toBeUndefined()
})

test('the window learns this project and terminal, and where the last event was', async ($, on) => {
  const { fs } = machine(on, { [CONFIG]: v2({}) })
  on('command.register', () => ({ value: { command: 'hookwich' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.UserPromptSubmit', () => ({}))

  await $.session.start({ cwd: '/work/app/sub', surface: 'terminal', isInteractive: true })
  await $.classic.UserPromptSubmit({ prompt: 'hi' })

  const places = JSON.parse(fs.get('/home/me/.hookwich/places.json') ?? '{}')
  expect(Object.keys(places.projects)).toEqual(['/work/app'])
  expect(places.terminals['whitebox:terminal:t1'].label).toBe('Whitebox t1')
  expect(JSON.parse(fs.get(ACTIVITY) ?? '{}').place.project).toBe('/work/app')
})

test('typing a chat marks where you are, and later moments keep that mark', async ($, on) => {
  const { fs } = machine(on, { [CONFIG]: v2({}) })
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.PostToolUse', () => ({}))

  await $.classic.UserPromptSubmit({ prompt: 'hi' })
  const typed = JSON.parse(fs.get(ACTIVITY) ?? '{}').lastChat
  expect(typed.place.terminal).toBe('whitebox:terminal:t1')
  expect(typed.place.project).toBe('/work/app')
  const places = JSON.parse(fs.get('/home/me/.hookwich/places.json') ?? '{}')
  expect(places.terminals['whitebox:terminal:t1'].agent).toBe('claude')

  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 't1' })
  const after = JSON.parse(fs.get(ACTIVITY) ?? '{}')
  expect(after.lastEvent).toBe('PostToolUse')
  expect(after.lastChat).toEqual(typed)
})

test('with the window app in place, /hookwich opens it and clears an old message', async ($, on) => {
  const { ran } = machine(
    on,
    { [CONFIG]: v2({}), '/home/me/.hookwich/Hookwich.app': '' },
    { '/usr/bin/uname -s': { exitCode: 0, stdout: 'Darwin\n' } },
  )
  const statuses: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  const out = await $.command.run({ command: 'hookwich', args: '', origin: 'composer' } as never)
  expect((out as { text: string }).text).toBe('hookwich: toggle')
  expect(ran).toContain('/usr/bin/open -g /home/me/.hookwich/Hookwich.app')
  expect(statuses).toEqual([undefined])
})

test('without the app and no release to download, it says so plainly', async ($, on) => {
  const { ran } = machine(
    on,
    { [CONFIG]: v2({}) },
    {
      '/usr/bin/uname -s': { exitCode: 0, stdout: 'Darwin\n' },
      '/usr/bin/uname -m': { exitCode: 0, stdout: 'arm64\n' },
      '/usr/bin/curl -fsSL -o /home/me/.hookwich/Hookwich-macos-arm64.zip https://github.com/minjund/hookwich/releases/download/v0.1.9/Hookwich-macos-arm64.zip':
        { exitCode: 22, stdout: '' },
    },
  )
  const statuses: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  const out = await $.command.run({ command: 'hookwich', args: 'show', origin: 'composer' } as never)
  expect((out as { text: string }).text).toContain('could not download the window app')
  expect(statuses[0]).toContain('could not download the window app')
  expect(ran.some(l => l.startsWith('/usr/bin/open'))).toBe(false)
})

const PLIST = (app: string) =>
  `/usr/bin/plutil -extract CFBundleShortVersionString raw -o - ${app}/Contents/Info.plist`
const V = 'https://github.com/minjund/hookwich/releases/download/v0.1.9'

test("an older window app is replaced by this plugin's version, checked first", async ($, on) => {
  const app = '/home/me/.hookwich/Hookwich.app'
  const zip = '/home/me/.hookwich/Hookwich-macos-arm64.zip'
  const { ran } = machine(
    on,
    { [CONFIG]: v2({}), [app]: '' },
    {
      '/usr/bin/uname -s': { exitCode: 0, stdout: 'Darwin\n' },
      '/usr/bin/uname -m': { exitCode: 0, stdout: 'arm64\n' },
      [PLIST(app)]: { exitCode: 0, stdout: '0.1.1\n' },
      [`/usr/bin/curl -fsSL ${V}/Hookwich-macos-arm64.zip.sha256`]: {
        exitCode: 0,
        stdout: 'abc123  Hookwich-macos-arm64.zip\n',
      },
      [`/usr/bin/shasum -a 256 ${zip}`]: { exitCode: 0, stdout: `abc123  ${zip}\n` },
    },
  )
  on('ui.status', () => ({ value: undefined }))

  const out = await $.command.run({ command: 'hookwich', args: 'show', origin: 'composer' } as never)
  expect((out as { text: string }).text).toBe('hookwich: show')
  const order = [
    `/usr/bin/curl -fsSL -o ${zip} ${V}/Hookwich-macos-arm64.zip`,
    `/usr/bin/ditto -x -k ${zip} /home/me/.hookwich/.update`,
    '/usr/bin/codesign --verify --deep --strict /home/me/.hookwich/.update/Hookwich.app',
    `/usr/bin/pkill -f ${app}/Contents/MacOS/hookwich`,
    `/bin/mv ${app} /home/me/.hookwich/.old-Hookwich.app`,
    `/bin/mv /home/me/.hookwich/.update/Hookwich.app ${app}`,
    `/usr/bin/open -g ${app}`,
  ]
  const at = order.map(line => ran.indexOf(line))
  expect(at.every(i => i >= 0)).toBe(true)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
})

test('the same or a newer window app is left alone', async ($, on) => {
  const app = '/home/me/.hookwich/Hookwich.app'
  const { ran } = machine(
    on,
    { [CONFIG]: v2({}), [app]: '' },
    {
      '/usr/bin/uname -s': { exitCode: 0, stdout: 'Darwin\n' },
      [PLIST(app)]: { exitCode: 0, stdout: '0.1.10\n' },
    },
  )
  on('ui.status', () => ({ value: undefined }))

  await $.command.run({ command: 'hookwich', args: '', origin: 'composer' } as never)
  expect(ran.some(l => l.includes('curl'))).toBe(false)
  expect(ran).toContain(`/usr/bin/open -g ${app}`)
})

test('a failed update keeps the old window running and says so', async ($, on) => {
  const app = '/home/me/.hookwich/Hookwich.app'
  const { ran, fs } = machine(
    on,
    { [CONFIG]: v2({}), [app]: '' },
    {
      '/usr/bin/uname -s': { exitCode: 0, stdout: 'Darwin\n' },
      '/usr/bin/uname -m': { exitCode: 0, stdout: 'arm64\n' },
      [PLIST(app)]: { exitCode: 0, stdout: '0.1.1\n' },
      [`/usr/bin/curl -fsSL -o /home/me/.hookwich/Hookwich-macos-arm64.zip ${V}/Hookwich-macos-arm64.zip`]: {
        exitCode: 22,
        stdout: '',
      },
    },
  )
  const statuses: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  await $.command.run({ command: 'hookwich', args: '', origin: 'composer' } as never)
  expect(ran.some(l => l.startsWith('/usr/bin/pkill') || l.startsWith('/bin/mv'))).toBe(false)
  expect(ran).toContain(`/usr/bin/open -g ${app}`)
  expect(statuses[0]).toContain('could not update the window app')
  expect(fs.has(app)).toBe(true)
})

test('each record names the item it came from, so a deleted item can be told apart', async ($, on) => {
  const { fs } = machine(on, { [CONFIG]: v2({ global: [item({ id: 'g1', text: 'answer in English' })] }) })
  on('classic.UserPromptSubmit', () => ({}))

  await $.classic.UserPromptSubmit({ prompt: 'hi' })
  const recent = JSON.parse(fs.get(ACTIVITY) ?? '{}').recent
  expect(recent.at(-1)).toMatchObject({ id: 'g1', label: 'answer in English', scope: 'global' })
})

const CODEX_ACTIVITY = '/home/me/.hookwich/activity-codex.json'
/** One key typed in the prompt box, raised as the engine raises it. */
const edit = ($: Parameters<TestBody>[0]) =>
  ($.prompt as unknown as { edit(e: unknown): Promise<unknown> }).edit({
    origin: { kind: 'composer' },
    text: '',
    cursor: 0,
    start: 0,
    end: 0,
    inputText: 'h',
  })
const elsewhere = (at: number) =>
  JSON.stringify({
    lastChat: {
      at,
      place: { project: '/other', terminal: 'whitebox:terminal:t9', terminalLabel: 'Whitebox t9' },
    },
  })

test('typing here moves "where you are chatting" here before sending, once', async ($, on) => {
  const { fs } = machine(on, { [CONFIG]: v2({}), [CODEX_ACTIVITY]: elsewhere(500) })
  on('prompt.edit', (_, e) => ({ text: `${e.text}h`, cursor: e.cursor + 1 }))

  await edit($)
  const chat = JSON.parse(fs.get(ACTIVITY) ?? '{}').lastChat
  expect(chat.place.terminal).toBe('whitebox:terminal:t1')
  expect(chat.place.project).toBe('/work/app')
})

test('typing where the chat already is writes nothing', async ($, on) => {
  const here = JSON.stringify({
    lastChat: {
      at: 900,
      place: { project: '/work/app', terminal: 'whitebox:terminal:t1', terminalLabel: '' },
    },
  })
  const { fs } = machine(on, { [CONFIG]: v2({}), [ACTIVITY]: here })
  on('prompt.edit', (_, e) => ({ text: `${e.text}h`, cursor: e.cursor + 1 }))

  await edit($)
  expect(fs.get(ACTIVITY)).toBe(here)
})

test('a chat working in the background does not take "where you are chatting" back', async ($, on) => {
  // Another Claude Code chat (t9) was typed in later than this one's own last chat.
  const { fs } = machine(on, { [CONFIG]: v2({}), [ACTIVITY]: elsewhere(5_000_000) })
  on('classic.PostToolUse', () => ({}))

  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 't1' })
  const after = JSON.parse(fs.get(ACTIVITY) ?? '{}')
  expect(after.lastEvent).toBe('PostToolUse')
  expect(after.lastChat.place.terminal).toBe('whitebox:terminal:t9')
})

const CONTEXT = '/home/me/.hookwich/context/whitebox_terminal_t1.json'

/** What `$.session.usage({ breakdown })` answers: /context's figures. */
const usage = (used: number) => ({
  startedAt: 0,
  rateLimits: [],
  context: {
    window: 200_000,
    tokens: used,
    percent: Math.round(used / 2000),
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 3000, color: 'promptBorder', isDeferred: false, kind: 'used' as const },
        { name: 'MCP tools', tokens: 900, color: 'cyan', isDeferred: false, kind: 'used' as const },
        { name: 'Custom agents', tokens: 0, color: 'warning', isDeferred: false, kind: 'used' as const },
        { name: 'Messages', tokens: used - 3900, color: 'purple', isDeferred: false, kind: 'used' as const },
        { name: 'Free space', tokens: 200_000 - used, color: 'inactive', isDeferred: false, kind: 'free' as const },
      ],
      totalTokens: used,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'model-default' as const,
      percentage: Math.round(used / 2000),
      gridRows: [],
      model: 'claude-opus-5-5',
      memoryFiles: [{ path: '/home/me/.claude/CLAUDE.md', type: 'User', tokens: 120 }],
      mcpTools: [
        { name: 'a', serverName: 'docs', tokens: 500, isLoaded: true },
        { name: 'b', serverName: 'docs', tokens: 300, isLoaded: true },
        { name: 'c', serverName: 'files', tokens: 100, isLoaded: true },
        { name: 'd', serverName: 'later', tokens: 9000, isLoaded: false },
      ],
      agents: [{ agentType: 'helper', source: 'plugin', tokens: 40 }],
      skills: {
        totalSkills: 4,
        includedSkills: 3,
        tokens: 250,
        skillFrontmatter: [
          { name: 'review', source: 'plugin', pluginName: 'tools', tokens: 100 },
          { name: 'lint', source: 'plugin', pluginName: 'tools', tokens: 60 },
          { name: 'mine', source: 'userSettings', tokens: 90 },
        ],
      },
      autoCompactThreshold: 167_000,
      isAutoCompactEnabled: true,
      apiUsage: null,
    },
  },
})

const measure = ($: Parameters<TestBody>[0]) =>
  ($.session as unknown as { measure(e: unknown): Promise<unknown> }).measure({
    context: { window: 200_000 },
    rateLimits: [],
    changed: ['context'],
  })

test('after a turn, what /context shows is written for this terminal', async ($, on) => {
  const { fs, ran } = machine(on, {})
  const asked: unknown[] = []
  on('session.usage', (_, e) => {
    asked.push(e)
    return { value: usage(40_000) }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await measure($)

  expect(asked).toEqual([{ breakdown: 'summary' }])
  expect(ran).toContain('/bin/mkdir -p /home/me/.hookwich/context')
  const snap = JSON.parse(fs.get(CONTEXT) ?? '{}')
  expect(snap).toMatchObject({ v: 1, used: 40_000, max: 200_000, percent: 20, compactAt: 167_000 })
  expect(snap.place.terminal).toBe('whitebox:terminal:t1')
  // empty rows are left out, the free space stays
  expect(snap.rows.map((r: { name: string }) => r.name)).toEqual([
    'System prompt',
    'MCP tools',
    'Messages',
    'Free space',
  ])
  expect(snap.mcp).toEqual([
    { server: 'docs', tools: 2, tokens: 800 },
    { server: 'files', tools: 1, tokens: 100 },
  ])
  expect(snap.skills).toEqual({ count: 3, tokens: 250 })
  expect(snap.skillGroups).toEqual([
    { kind: 'plugin', name: 'tools', skills: 2, tokens: 160 },
    { kind: 'user', name: '', skills: 1, tokens: 90 },
  ])
  expect(snap.agents).toEqual([{ name: 'helper', source: 'plugin', tokens: 40 }])
})

test('a measurement where the context did not move writes nothing', async ($, on) => {
  const { fs } = machine(on, {})
  on('session.usage', () => ({ value: usage(40_000) }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await ($.session as unknown as { measure(e: unknown): Promise<unknown> }).measure({
    context: { window: 200_000 },
    rateLimits: [],
    changed: ['cost'],
  })

  expect(fs.has(CONTEXT)).toBe(false)
})

test('while tools run, /context is written at most every two seconds', async ($, on) => {
  const { fs } = machine(on, {})
  let asked = 0
  on('session.usage', () => {
    asked += 1
    return { value: usage(10_000 + asked * 1000) }
  })
  on('tool.call', () => ({ result: { content: 'ok' } }) as never)

  const call = () =>
    ($.tool as unknown as { call(e: unknown): Promise<unknown> }).call({ tool: 'Read', input: {} })
  await call()
  await call()
  await call()
  const later = (globalThis as unknown as { setTimeout(f: () => void, ms: number): void }).setTimeout
  await new Promise<void>(r => later(r, 20))

  expect(asked).toBe(1)
  expect(JSON.parse(fs.get(CONTEXT) ?? '{}').used).toBe(11_000)
})
