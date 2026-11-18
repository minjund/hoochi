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
      '/usr/bin/curl -fsSL -o /home/me/.hookwich/Hookwich-macos-arm64.zip https://github.com/minjund/hookwich/releases/download/v0.1.5/Hookwich-macos-arm64.zip':
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
const V = 'https://github.com/minjund/hookwich/releases/download/v0.1.5'

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
