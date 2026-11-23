import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { noteOnce, oldPluginInstalled, parseOnce } from '../hooks/register'

type On = Parameters<TestBody>[1]

/** A fake machine: files in a map, commands answered by `commands`. */
function machine(
  on: On,
  files: Record<string, string>,
  commands: Record<string, { exitCode: number; stdout: string }> = {},
  env: Record<string, string> = { WHITEBOX_SURFACE_ID: 'terminal:t1' },
  { clock = true }: { clock?: boolean } = {},
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
  if (clock) on('clock.now', () => ({ value: (now += 10) }))
  // The engine beneath: this chat's id, and the native events hoochi serves its moments from.
  const chat = { id: 's1' }
  const submitted: string[] = []
  on('session.id', () => ({ value: chat.id }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text, ...(e.context ? { context: e.context } : {}) }
  })
  on('tool.call', (_, e) => {
    const failed = (e as { input?: { fail?: boolean } }).input?.fail === true
    return { result: { content: 'ok' }, ...(failed ? { isError: true } : {}) } as never
  })
  on('turn.complete', () => ({ text: 'done' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  return { fs, ran, chat, submitted }
}

/** A prompt you send; resolves to what went beside it for the model (none: undefined). */
async function prompt($: Parameters<TestBody>[0], text = 'hi', extra: Record<string, unknown> = {}) {
  const r = await ($.prompt as unknown as { submit(e: unknown): Promise<{ context?: string[] }> }).submit({
    text,
    origin: { kind: 'composer' },
    wait: false,
    ...extra,
  })
  return r.context
}

/** A tool the model calls; resolves to what follows its result for the model. */
async function tool($: Parameters<TestBody>[0], name: string, input: Record<string, unknown> = {}) {
  const r = await ($.tool as unknown as { call(e: unknown): Promise<{ context?: string[] }> }).call({
    tool: name,
    input,
  })
  return r.context
}

/** Lets work a hook left running (not awaited) finish. */
const tick = () =>
  new Promise<void>(r => (globalThis as unknown as { setTimeout(f: () => void, ms: number): void }).setTimeout(r, 5))

/** The main loop's turn ends with an answer (or a subagent's, with `agentId`). */
async function turnEnds($: Parameters<TestBody>[0], extra: Record<string, unknown> = {}) {
  await ($.turn as unknown as { complete(e: unknown): Promise<unknown> }).complete({
    reason: 'answer',
    answer: 'done',
    durationMs: 10,
    isAborted: false,
    turnId: 't1',
    ...extra,
  })
  // hoochi sends its "keep going" without waiting for it
  await tick()
}

const CONFIG = '/home/me/.hoochi/config.json'
const ACTIVITY = '/home/me/.hoochi/activity-claude.json'

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

test('text before a prompt reaches the model beside it', async ($, on) => {
  const { fs } = machine(on, { [CONFIG]: config(item({ text: 'Answer in English.' })) })

  expect(await prompt($)).toEqual(['Answer in English.'])

  const seen = JSON.parse(fs.get(ACTIVITY) ?? '{}')
  expect(seen.lastEvent).toBe('UserPromptSubmit')
  expect(seen.counts.UserPromptSubmit).toBe(1)
  expect(seen.recent[0].label).toBe('Answer in English.')
})

test('a disabled item and another event put nothing in', async ($, on) => {
  machine(on, {
    [CONFIG]: config(item({ text: 'off', enabled: false }), item({ id: 'i2', event: 'Stop', text: 'later' })),
  })

  expect(await prompt($)).toBeUndefined()
})

test('a skill item asks the model to use the skill', async ($, on) => {
  machine(on, { [CONFIG]: config(item({ kind: 'skill', skill: 'code-review' })) })

  expect((await prompt($))?.[0]).toContain('"code-review" skill')
})

test('a rules item lists each skill with when to use it, leaving half-filled rows out', async ($, on) => {
  const { fs } = machine(on, {
    [CONFIG]: config(
      item({
        kind: 'rules',
        rules: [
          { when: '기능 추가·버그 수정할 때', skill: 'tdd' },
          { when: '  리뷰해 달라고\n할 때 ', skill: 'code-review' },
          { when: 'no skill yet', skill: '' },
          { when: '', skill: 'no-when' },
        ],
      }),
    ),
  })

  expect(await prompt($)).toEqual([
    'When the task matches one of these, call that skill with the Skill tool before you go on:\n' +
      '- 기능 추가·버그 수정할 때 → "tdd"\n' +
      '- 리뷰해 달라고 할 때 → "code-review"',
  ])
  expect(JSON.parse(fs.get(ACTIVITY) ?? '{}').recent[0]).toMatchObject({ kind: 'rules', label: '/tdd /code-review' })
})

test('a rules item with no full row puts nothing in', async ($, on) => {
  machine(on, { [CONFIG]: config(item({ kind: 'rules', rules: [{ when: 'later', skill: '' }] })) })

  expect(await prompt($)).toBeUndefined()
})

test('a tool item goes only to the tools named', async ($, on) => {
  machine(on, {
    [CONFIG]: config(item({ event: 'PostToolUse', text: 'Summarise it.', tools: 'Bash, Edit' })),
  })

  expect(await tool($, 'Bash')).toEqual(['Summarise it.'])
  expect(await tool($, 'Read')).toBeUndefined()
})

test('before a tool its command runs first; after a failed one only the failure items speak', async ($, on) => {
  const { ran } = machine(
    on,
    {
      [CONFIG]: config(
        item({ event: 'PreToolUse', kind: 'command', command: 'echo before' }),
        item({ id: 'i2', event: 'PostToolUse', text: 'It worked.' }),
        item({ id: 'i3', event: 'PostToolUseFailure', text: 'It failed: say why.' }),
      ),
    },
    { 'echo before': { exitCode: 0, stdout: 'checked' } },
  )

  expect(await tool($, 'Bash')).toEqual(['$ echo before (exit 0)\nchecked', 'It worked.'])
  expect(await tool($, 'Bash', { fail: true })).toEqual(['$ echo before (exit 0)\nchecked', 'It failed: say why.'])
  expect(ran.filter(l => l === 'echo before')).toHaveLength(2)
})

test('a failing test command after the turn makes Claude keep going once', async ($, on) => {
  const { ran, submitted: sent } = machine(
    on,
    { [CONFIG]: config(item({ event: 'Stop', kind: 'command', command: 'npm test', mode: 'onFail' })) },
    { 'npm test': { exitCode: 1, stdout: '1 failing' } },
  )

  const { submitted } = { submitted: sent }
  await turnEnds($)
  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toContain('$ npm test (exit 1)')
  expect(submitted[0]).toContain('1 failing')

  // The turn it started ends too: let through, no loop.
  await turnEnds($)
  expect(submitted).toHaveLength(1)
  expect(ran.filter(l => l === 'npm test').length).toBe(1)

  // A subagent's end runs commands, but cannot keep going.
  await turnEnds($, { agentId: 'a1' })
  expect(submitted).toHaveLength(1)
})

test('a passing command set to "only on failure" puts nothing in', async ($, on) => {
  const { submitted } = machine(
    on,
    { [CONFIG]: config(item({ event: 'Stop', kind: 'command', command: 'npm test', mode: 'onFail' })) },
    { 'npm test': { exitCode: 0, stdout: 'ok' } },
  )

  await turnEnds($)
  expect(submitted).toHaveLength(0)
})

test('a command at an event the model cannot hear still runs', async ($, on) => {
  const { ran } = machine(on, {
    [CONFIG]: config(item({ event: 'SessionEnd', kind: 'command', command: 'echo bye >> log' })),
  })

  await ($.session as unknown as { end(e: unknown): Promise<unknown> }).end({ reason: 'other', sessionId: 's1' })
  expect(ran).toContain('echo bye >> log')
})

test('a "once" item runs once per chat, stays on, and runs again in the next chat', async ($, on) => {
  const { fs, chat } = machine(on, { [CONFIG]: config(item({ text: 'Just this once.', once: true })) })
  const say = (id: string, text: string) => ((chat.id = id), prompt($, text))

  expect(await say('chat-1', 'a')).toEqual(['Just this once.'])
  expect(await say('chat-1', 'b')).toBeUndefined()
  expect(JSON.parse(fs.get(CONFIG) ?? '{}').items[0].once).toBe(true)
  expect(fs.get(CONFIG)).not.toContain('"enabled": false')

  // /clear or a new chat: a new session id, so it runs again there.
  expect(await say('chat-2', 'c')).toEqual(['Just this once.'])
  expect(await say('chat-2', 'd')).toBeUndefined()
  expect(Object.keys(JSON.parse(fs.get('/home/me/.hoochi/once-claude.json') ?? '{}'))).toEqual([
    'chat-1',
    'chat-2',
  ])
})

test('a "once" item next to others: only it waits for the next chat', async ($, on) => {
  machine(on, {
    [CONFIG]: config(item({ text: 'once', once: true }), item({ id: 'i2', text: 'every time' })),
  })

  expect(await prompt($, 'a')).toEqual(['once\n\nevery time'])
  expect(await prompt($, 'b')).toEqual(['every time'])
})

test('chats quiet for a month leave the once log', async () => {
  const day = 24 * 60 * 60 * 1000
  const log = noteOnce({ old: { at: 0, ids: ['x'] }, recent: { at: 40 * day, ids: ['y'] } }, 'new', ['z'], 45 * day)
  expect(Object.keys(log)).toEqual(['recent', 'new'])
  expect(noteOnce(log, 'new', ['z', 'w'], 46 * day).new?.ids).toEqual(['z', 'w'])
  expect(parseOnce('{ broken')).toEqual({})
})

test('a broken config never breaks the hook', async ($, on) => {
  machine(on, { [CONFIG]: '{ not json' })

  expect(await prompt($, 'a', { context: ['from another plugin'] })).toEqual(['from another plugin'])
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

  expect((await prompt($))).toEqual(['terminal'])
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

  expect((await prompt($))).toEqual(['project'])
})

test('a switched-off item in the project silences the global one there', async ($, on) => {
  machine(on, {
    [CONFIG]: v2({
      global: [item({ text: 'global' })],
      projects: { '/work/app': [item({ id: 'p', text: 'quiet here', enabled: false })] },
    }),
  })

  expect((await prompt($))).toBeUndefined()
})

test('the window learns this project and terminal, and where the last event was', async ($, on) => {
  const { fs } = machine(on, { [CONFIG]: v2({}) })
  on('command.register', () => ({ value: { command: 'hoochi' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work/app/sub', surface: 'terminal', isInteractive: true })
  await prompt($)

  const places = JSON.parse(fs.get('/home/me/.hoochi/places.json') ?? '{}')
  expect(Object.keys(places.projects)).toEqual(['/work/app'])
  expect(places.terminals['whitebox:terminal:t1'].label).toBe('Whitebox t1')
  expect(JSON.parse(fs.get(ACTIVITY) ?? '{}').place.project).toBe('/work/app')
})

test('typing a chat marks where you are, and later moments keep that mark', async ($, on) => {
  const { fs } = machine(on, { [CONFIG]: v2({}) })

  await send($, 'composer')
  await tick()
  const typed = JSON.parse(fs.get(ACTIVITY) ?? '{}').lastChat
  expect(typed.place.terminal).toBe('whitebox:terminal:t1')
  expect(typed.place.project).toBe('/work/app')
  const places = JSON.parse(fs.get('/home/me/.hoochi/places.json') ?? '{}')
  expect(places.terminals['whitebox:terminal:t1'].agent).toBe('claude')

  await tool($, 'Bash')
  const after = JSON.parse(fs.get(ACTIVITY) ?? '{}')
  expect(after.lastEvent).toBe('PostToolUse')
  expect(after.lastChat).toEqual(typed)
})

test('with the window app in place, /hoochi opens it and clears an old message', async ($, on) => {
  const { ran } = machine(
    on,
    { [CONFIG]: v2({}), '/home/me/.hoochi/Hoochi.app': '' },
    { '/usr/bin/uname -s': { exitCode: 0, stdout: 'Darwin\n' } },
  )
  const statuses: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  const out = await $.command.run({ command: 'hoochi', args: '', origin: 'composer' } as never)
  expect((out as { text: string }).text).toBe('hoochi: toggle')
  expect(ran).toContain('/usr/bin/open -g /home/me/.hoochi/Hoochi.app')
  expect(statuses).toEqual([undefined])
})

test('without the app and no release to download, it says so plainly', async ($, on) => {
  const { ran } = machine(
    on,
    { [CONFIG]: v2({}) },
    {
      '/usr/bin/uname -s': { exitCode: 0, stdout: 'Darwin\n' },
      '/usr/bin/uname -m': { exitCode: 0, stdout: 'arm64\n' },
      '/usr/bin/curl -fsSL -o /home/me/.hoochi/Hoochi-macos-arm64.zip https://github.com/minjund/hoochi/releases/download/v0.1.32/Hoochi-macos-arm64.zip':
        { exitCode: 22, stdout: '' },
    },
  )
  const statuses: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  const out = await $.command.run({ command: 'hoochi', args: 'show', origin: 'composer' } as never)
  expect((out as { text: string }).text).toContain('could not download the window app')
  expect(statuses[0]).toContain('could not download the window app')
  expect(ran.some(l => l.startsWith('/usr/bin/open'))).toBe(false)
})

const PLIST = (app: string) =>
  `/usr/bin/plutil -extract CFBundleShortVersionString raw -o - ${app}/Contents/Info.plist`
const V = 'https://github.com/minjund/hoochi/releases/download/v0.1.32'

test("an older window app is replaced by this plugin's version, checked first", async ($, on) => {
  const app = '/home/me/.hoochi/Hoochi.app'
  const zip = '/home/me/.hoochi/Hoochi-macos-arm64.zip'
  const { ran } = machine(
    on,
    { [CONFIG]: v2({}), [app]: '' },
    {
      '/usr/bin/uname -s': { exitCode: 0, stdout: 'Darwin\n' },
      '/usr/bin/uname -m': { exitCode: 0, stdout: 'arm64\n' },
      [PLIST(app)]: { exitCode: 0, stdout: '0.1.1\n' },
      [`/usr/bin/curl -fsSL ${V}/Hoochi-macos-arm64.zip.sha256`]: {
        exitCode: 0,
        stdout: 'abc123  Hoochi-macos-arm64.zip\n',
      },
      [`/usr/bin/shasum -a 256 ${zip}`]: { exitCode: 0, stdout: `abc123  ${zip}\n` },
    },
  )
  on('ui.status', () => ({ value: undefined }))

  const out = await $.command.run({ command: 'hoochi', args: 'show', origin: 'composer' } as never)
  expect((out as { text: string }).text).toBe('hoochi: show')
  const order = [
    `/usr/bin/curl -fsSL -o ${zip} ${V}/Hoochi-macos-arm64.zip`,
    `/usr/bin/ditto -x -k ${zip} /home/me/.hoochi/.update`,
    '/usr/bin/codesign --verify --deep --strict /home/me/.hoochi/.update/Hoochi.app',
    `/usr/bin/pkill -f ${app}/Contents/MacOS/hoochi`,
    `/bin/mv ${app} /home/me/.hoochi/.old-Hoochi.app`,
    `/bin/mv /home/me/.hoochi/.update/Hoochi.app ${app}`,
    `/usr/bin/open -g ${app}`,
  ]
  const at = order.map(line => ran.indexOf(line))
  expect(at.every(i => i >= 0)).toBe(true)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
})

test('the same or a newer window app is left alone', async ($, on) => {
  const app = '/home/me/.hoochi/Hoochi.app'
  const { ran } = machine(
    on,
    { [CONFIG]: v2({}), [app]: '' },
    {
      '/usr/bin/uname -s': { exitCode: 0, stdout: 'Darwin\n' },
      [PLIST(app)]: { exitCode: 0, stdout: '9.0.0\n' },
    },
  )
  on('ui.status', () => ({ value: undefined }))

  await $.command.run({ command: 'hoochi', args: '', origin: 'composer' } as never)
  expect(ran.some(l => l.includes('curl'))).toBe(false)
  expect(ran).toContain(`/usr/bin/open -g ${app}`)
})

test('a failed update keeps the old window running and says so', async ($, on) => {
  const app = '/home/me/.hoochi/Hoochi.app'
  const { ran, fs } = machine(
    on,
    { [CONFIG]: v2({}), [app]: '' },
    {
      '/usr/bin/uname -s': { exitCode: 0, stdout: 'Darwin\n' },
      '/usr/bin/uname -m': { exitCode: 0, stdout: 'arm64\n' },
      [PLIST(app)]: { exitCode: 0, stdout: '0.1.1\n' },
      [`/usr/bin/curl -fsSL -o /home/me/.hoochi/Hoochi-macos-arm64.zip ${V}/Hoochi-macos-arm64.zip`]: {
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

  await $.command.run({ command: 'hoochi', args: '', origin: 'composer' } as never)
  expect(ran.some(l => l.startsWith('/usr/bin/pkill') || l.startsWith('/bin/mv'))).toBe(false)
  expect(ran).toContain(`/usr/bin/open -g ${app}`)
  expect(statuses[0]).toContain('could not update the window app')
  expect(fs.has(app)).toBe(true)
})

test('each record names the item it came from, so a deleted item can be told apart', async ($, on) => {
  const { fs } = machine(on, { [CONFIG]: v2({ global: [item({ id: 'g1', text: 'answer in English' })] }) })

  await prompt($)
  const recent = JSON.parse(fs.get(ACTIVITY) ?? '{}').recent
  expect(recent.at(-1)).toMatchObject({ id: 'g1', label: 'answer in English', scope: 'global' })
})

const CODEX_ACTIVITY = '/home/me/.hoochi/activity-codex.json'
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

  await tool($, 'Bash')
  const after = JSON.parse(fs.get(ACTIVITY) ?? '{}')
  expect(after.lastEvent).toBe('PostToolUse')
  expect(after.lastChat.place.terminal).toBe('whitebox:terminal:t9')
})

const CONTEXT = '/home/me/.hoochi/context/whitebox_terminal_t1.json'

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
        {
          name: 'System prompt',
          tokens: 3000,
          color: 'promptBorder',
          isDeferred: false,
          kind: 'used' as const,
        },
        { name: 'MCP tools', tokens: 900, color: 'cyan', isDeferred: false, kind: 'used' as const },
        { name: 'Custom agents', tokens: 0, color: 'warning', isDeferred: false, kind: 'used' as const },
        { name: 'Messages', tokens: used - 3900, color: 'purple', isDeferred: false, kind: 'used' as const },
        {
          name: 'Free space',
          tokens: 200_000 - used,
          color: 'inactive',
          isDeferred: false,
          kind: 'free' as const,
        },
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
  expect(ran).toContain('/bin/mkdir -p /home/me/.hoochi/context')
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
  expect(snap.skillList).toEqual([
    { name: 'review', kind: 'plugin', plugin: 'tools', tokens: 100 },
    { name: 'mine', kind: 'user', tokens: 90 },
    { name: 'lint', kind: 'plugin', plugin: 'tools', tokens: 60 },
  ])
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

test('a claude -p run in the same terminal is not where you chat', async ($, on) => {
  const earlier = {
    at: 500,
    place: { project: '/work/app', terminal: 'whitebox:terminal:t1', terminalLabel: 'Whitebox t1' },
  }
  const { fs } = machine(on, {
    [CONFIG]: v2({}),
    [ACTIVITY]: JSON.stringify({ lastEvent: '', lastAt: 0, counts: {}, recent: [], lastChat: earlier }),
  })
  let asked = 0
  on('command.register', () => ({ value: { command: 'hoochi' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => {
    asked += 1
    return { value: usage(10_000) }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/tmp/scratch', surface: null, isInteractive: false })
  await prompt($, 'reply ok')
  await measure($)

  expect(JSON.parse(fs.get(ACTIVITY) ?? '{}').lastChat).toEqual(earlier)
  expect(fs.has('/home/me/.hoochi/places.json')).toBe(false)
  expect(asked).toBe(0)
  expect(fs.has(CONTEXT)).toBe(false)
})

const INSTALLED = '/home/me/.claude/plugins/installed_plugins.json'
const installed = (version: string) =>
  JSON.stringify({ version: 2, plugins: { 'hoochi@hoochi': [{ scope: 'user', version }] } })

function reloadsSeen(on: On) {
  const reloads: unknown[] = []
  on('command.register', () => ({ value: { command: 'hoochi' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.run', { command: 'reload-plugins' }, (_, e) => {
    reloads.push(e)
    return { text: 'Reloaded' }
  })
  return reloads
}

test('a newer hoochi installed: the open chat reloads its plugins, once', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const { fs } = machine(on, { [CONFIG]: v2({}), [INSTALLED]: installed('0.0.1') }, {}, undefined, {
    clock: false,
  })
  const reloads = reloadsSeen(on)

  await $.session.start({ cwd: '/work/app/sub', surface: 'terminal', isInteractive: true })
  await clock.advance(10_000)
  expect(reloads).toHaveLength(0)

  fs.set(INSTALLED, installed('9.0.0'))
  await clock.advance(10_000)
  expect(reloads).toHaveLength(1)
  // a reload that did not take is not tried again for the same version
  await clock.advance(60_000)
  expect(reloads).toHaveLength(1)
})

test('a `claude -p` run never reloads plugins', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  machine(on, { [CONFIG]: v2({}), [INSTALLED]: installed('9.0.0') }, {}, undefined, { clock: false })
  const reloads = reloadsSeen(on)
  on('session.usage', () => ({ value: usage(10_000) }))

  await $.session.start({ cwd: '/tmp/scratch', surface: null, isInteractive: false })
  await clock.advance(30_000)
  expect(reloads).toHaveLength(0)
})

/** A prompt entering the session, from where the engine says it came. */
function send($: Parameters<TestBody>[0], kind: string) {
  return ($.prompt as unknown as { submit(e: unknown): Promise<unknown> }).submit({
    text: 'hi',
    origin: { kind },
    wait: false,
  })
}

test('only your own Enter makes this "where you are chatting"', async ($, on) => {
  const clock = mock.clock(on, { now: 9_000_000 })
  const { fs } = machine(on, { [CONFIG]: v2({}), [ACTIVITY]: elsewhere(5_000) }, {}, undefined, { clock: false })

  // a terminal app's request, a notification, a scheduled run: the window stays on t9
  for (const kind of ['unclassified', 'task-notification', 'peer', 'scheduled-trigger']) {
    await send($, kind)
    await clock.settle()
    expect(JSON.parse(fs.get(ACTIVITY) ?? '{}').lastChat.place.terminal).toBe('whitebox:terminal:t9')
  }

  await send($, 'composer')
  await clock.settle()
  expect(JSON.parse(fs.get(ACTIVITY) ?? '{}').lastChat.place.terminal).toBe('whitebox:terminal:t1')
})

test('a chat compacting on its own does not take "where you are chatting"', async ($, on) => {
  // t9 was typed in a moment ago, earlier than this chat's own clock reads now
  const { fs } = machine(on, { [CONFIG]: v2({}), [ACTIVITY]: elsewhere(500) })
  on('classic.SessionStart', () => ({}))

  await $.classic.SessionStart({ source: 'compact' })
  expect(JSON.parse(fs.get(ACTIVITY) ?? '{}').lastChat.place.terminal).toBe('whitebox:terminal:t9')
})

test('chat start: its words go in with the first prompt only, and again after /clear', async ($, on) => {
  const { chat, ran } = machine(on, {
    [CONFIG]: config(
      item({ event: 'SessionStart', text: 'Read NOTES.md first.' }),
      item({ id: 'i2', event: 'SessionStart', kind: 'command', command: 'git pull' }),
    ),
  })
  on('command.register', () => ({ value: { command: 'hoochi' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work/app/sub', surface: 'terminal', isInteractive: true })
  expect(ran.filter(l => l === 'git pull')).toHaveLength(1)
  expect((await prompt($))?.[0]).toContain('Read NOTES.md first.')
  expect(await prompt($)).toBeUndefined()

  // a reload runs session.start again in the same chat: nothing runs twice
  await $.session.start({ cwd: '/work/app/sub', surface: 'terminal', isInteractive: true })
  expect(ran.filter(l => l === 'git pull')).toHaveLength(1)
  expect(await prompt($)).toBeUndefined()

  // /clear: the chat ends, a new one goes on in this process with no session.start
  await ($.session as unknown as { end(e: unknown): Promise<unknown> }).end({ reason: 'clear', sessionId: 's1' })
  chat.id = 's2'
  expect((await prompt($))?.[0]).toContain('Read NOTES.md first.')
  expect(ran.filter(l => l === 'git pull')).toHaveLength(2)
})

test('a slash command also gets what goes in when a command expands', async ($, on) => {
  machine(on, { [CONFIG]: config(item({ event: 'UserPromptExpansion', text: 'Expanded.' })) })

  expect(await prompt($, 'hi')).toBeUndefined()
  expect(await prompt($, '/review', { command: { name: 'review', args: '' } })).toEqual(['Expanded.'])
})

test('engine notices and hoochi\'s own "keep going" get nothing', async ($, on) => {
  machine(on, { [CONFIG]: config(item({ text: 'Answer in English.' })) })

  expect(await prompt($, 'a notice', { isMeta: true })).toBeUndefined()
  expect(await prompt($, 'keep going', { origin: { kind: 'plugin', name: 'hoochi' } })).toBeUndefined()
  expect(await prompt($, 'mine')).toEqual(['Answer in English.'])
})

test('a classic hook for a moment served natively puts nothing in, so nothing goes in twice', async ($, on) => {
  machine(on, {
    [CONFIG]: config(
      item({ text: 'Answer in English.' }),
      item({ id: 'i2', event: 'PostToolUse', text: 'Summarise it.' }),
      item({ id: 'i3', event: 'Stop', text: 'Run the tests.' }),
      item({ id: 'i4', event: 'PostModelSwitch', text: 'Say which model you are now.' }),
    ),
  })
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.Stop', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  on('classic.PostToolBatch', () => ({}))

  expect((await $.classic.UserPromptSubmit({ prompt: 'hi' })).additionalContext).toBeUndefined()
  const base = { tool_input: {}, tool_response: {}, tool_use_id: 't1' }
  expect((await $.classic.PostToolUse({ ...base, tool_name: 'Bash' })).additionalContext).toBeUndefined()
  expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  expect(
    (await $.classic.PostModelSwitch({ previous_model: 'a', model: 'b' } as never)).additionalContext,
  ).toBeUndefined()
})

test('a moment with no native event still goes through its classic hook', async ($, on) => {
  machine(on, { [CONFIG]: config(item({ event: 'PostToolBatch', text: 'Check the batch.' })) })
  on('classic.PostToolBatch', () => ({}))

  expect((await $.classic.PostToolBatch({ tool_calls: [] } as never)).additionalContext).toEqual([
    'Check the batch.',
  ])
})

test('after changing model, its words go in with the next prompt, once', async ($, on) => {
  machine(on, { [CONFIG]: config(item({ event: 'PostModelSwitch', text: 'Say which model you are now.' })) })
  let model = 'claude-sonnet-5'
  on('session.model', () => ({ value: model }))

  expect(await prompt($)).toBeUndefined()
  model = 'claude-opus-5'
  expect(await prompt($)).toEqual(['Say which model you are now.'])
  expect(await prompt($)).toBeUndefined()
})

test('after /clear, changing model puts a "once" item in again for the new chat', async ($, on) => {
  const { chat } = machine(on, {
    [CONFIG]: config(item({ event: 'PostModelSwitch', text: 'Say which model you are now.', once: true })),
  })
  let model = 'claude-opus-5'
  on('session.model', () => ({ value: model }))

  expect(await prompt($)).toBeUndefined()
  model = 'claude-sonnet-5'
  expect(await prompt($)).toEqual(['Say which model you are now.'])
  // once per chat: switching again in the same chat says nothing
  model = 'claude-opus-5'
  expect(await prompt($)).toBeUndefined()

  // /clear starts a new chat in this process; then the model changes before the first prompt
  await ($.session as unknown as { end(e: unknown): Promise<unknown> }).end({ reason: 'clear', sessionId: 's1' })
  chat.id = 's2'
  model = 'claude-haiku-5'
  expect(await prompt($)).toEqual(['Say which model you are now.'])
  // a /clear with no model change says nothing
  await ($.session as unknown as { end(e: unknown): Promise<unknown> }).end({ reason: 'clear', sessionId: 's2' })
  chat.id = 's3'
  expect(await prompt($)).toBeUndefined()
})

test('before and after compacting, commands run; a compaction worked out ahead does not count', async ($, on) => {
  const { ran } = machine(on, {
    [CONFIG]: config(
      item({ event: 'PreCompact', kind: 'command', command: 'echo pre' }),
      item({ id: 'i2', event: 'PostCompact', kind: 'command', command: 'echo post' }),
    ),
  })
  on('session.compact', (_, e) => ({ messages: e.messages }))
  const compact = (trigger: string) =>
    ($.session as unknown as { compact(e: unknown): Promise<unknown> }).compact({ trigger, messages: [{ role: 'user', text: 'hi', toolUses: [] }] })

  await compact('precompute')
  expect(ran.filter(l => l.startsWith('echo'))).toEqual([])
  await compact('manual')
  expect(ran.filter(l => l.startsWith('echo'))).toEqual(['echo pre', 'echo post'])
})

test('a turn an API error ended runs the failure commands, and nothing keeps it going', async ($, on) => {
  const { ran, submitted } = machine(on, {
    [CONFIG]: config(
      item({ event: 'StopFailure', kind: 'command', command: 'say failed' }),
      item({ id: 'i2', event: 'Stop', text: 'Run the tests.' }),
    ),
  })

  await turnEnds($, { reason: 'error' })
  expect(ran).toContain('say failed')
  expect(submitted).toEqual([])
})

test("a subagent's words follow the task it was given", async ($, on) => {
  machine(on, { [CONFIG]: config(item({ event: 'SubagentStart', text: 'Reply in Korean.' })) })
  const given: string[] = []
  on('agent.spawn', (_, e) => {
    given.push(e.prompt)
    return { model: 'claude-haiku-5' }
  })

  await ($.agent as unknown as { spawn(e: unknown): Promise<unknown> }).spawn({
    prompt: 'Find the bug.',
    description: 'find',
    subagentType: 'general-purpose',
    parentModel: 'claude-opus-5',
  })
  expect(given).toEqual(['Find the bug.\n\nReply in Korean.'])
})

test('answers with no classic event at all mark the classic hooks blocked; one arriving opens them', async ($, on) => {
  const { fs } = machine(on, { [CONFIG]: config() })
  on('classic.MessageDisplay', () => ({}))
  const REACH = '/home/me/.hoochi/classic-claude.json'
  const reach = () => JSON.parse(fs.get(REACH) ?? '{}').reach

  await turnEnds($, { answer: 'one' })
  expect(reach()).toBeUndefined()
  await turnEnds($, { answer: 'two' })
  expect(reach()).toBe('blocked')

  await $.classic.MessageDisplay({ turn_id: 't1', message_id: 'm1', index: 0 } as never)
  await tick()
  expect(reach()).toBe('open')
})

/** Starts a chat on the fake machine; returns the toasts it showed. */
async function startChat($: Parameters<TestBody>[0], on: On): Promise<string[]> {
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'hoochi' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/work/app/sub', surface: 'terminal', isInteractive: true })
  return toasts
}

const OLD_MOVE = [
  '/usr/bin/pkill -f /home/me/.hookwich/Hookwich.app/Contents/MacOS/hookwich',
  '/bin/mv /home/me/.hookwich /home/me/.hoochi',
  '/bin/rm -rf /home/me/.hoochi/Hookwich.app /home/me/.hoochi/.update',
  '/bin/ln -s /home/me/.hoochi /home/me/.hookwich',
]

test('the folder kept under the old name (hookwich) moves to ~/.hoochi once, its old window stopped', async ($, on) => {
  const { ran } = machine(on, { '/home/me/.hookwich': '' })
  const toasts = await startChat($, on)
  expect(ran.slice(0, 4)).toEqual(OLD_MOVE)
  expect(toasts).toEqual([])
})

test('once ~/.hoochi is there, the old folder is left alone', async ($, on) => {
  const { ran } = machine(on, { '/home/me/.hookwich': '', '/home/me/.hoochi': '', [CONFIG]: v2({}) })
  await startChat($, on)
  expect(ran.filter(l => l.includes('.hookwich'))).toEqual([])
})

test('the plugin still installed under the old name is noticed, to remove', async ($, on) => {
  machine(on, {
    [CONFIG]: v2({}),
    '/home/me/.claude/plugins/installed_plugins.json': JSON.stringify({
      plugins: { 'hookwich@hookwich': [{ version: '0.1.27' }], 'hoochi@hoochi': [{ version: '0.1.28' }] },
    }),
  })
  const toasts = await startChat($, on)
  expect(toasts).toEqual(['hookwich is now hoochi: remove the old plugin with  claude plugin uninstall hookwich@hookwich'])
  expect(oldPluginInstalled(JSON.stringify({ plugins: { 'hoochi@hoochi': [] } }))).toBe(false)
  expect(oldPluginInstalled('not json')).toBe(false)
})
