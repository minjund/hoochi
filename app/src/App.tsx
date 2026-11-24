import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'

import {
  CLAUDE_LAYOUT,
  CODEX_LAYOUT,
  LifecycleDiagram,
  type ContextFill,
} from './components/hoochi/lifecycle-diagram'
import { SandwichBubble } from './components/hoochi/sandwich-bubble'
import { ContextGlance, type ContextFocus } from './components/hoochi/context-view'
import { SkillsPanel } from './components/hoochi/skills-panel'
import { SlotEditor } from './components/hoochi/slot-editor'
import { MomentList } from './components/hoochi/moment-list'
import { ChatView, type Exchange } from './components/hoochi/chat-view'
import { applyEdit, allTargets, revertEdit, targetKey as rowKey, touched, type Edit, type Target as Held } from './lib/edit'
import {
  CODEX_ONLY,
  interpret,
  itemFor,
  itemOf,
  matchEdit,
  matchRecipe,
  MODEL,
  momentsOf,
  ruleFor,
  schemaFor,
  systemFor,
  type Known,
  type PlaceOpt,
  type Rule,
  type Understood,
} from './lib/understand'
import { SendSheet, type Target } from './components/hoochi/send-sheet'
import { MomentPicker } from './components/hoochi/moment-picker'
import { alsoIn, hasAll, hiddenHere, sendTo, type PlaceRef } from './lib/copy'
import hoochiIcon from './assets/hoochi-icon.svg'
import { Button } from './components/ui/button'
import { DropdownMenu } from './components/ui/dropdown-menu'
import { IconButton } from './components/ui/icon-button'
import { SegmentedControl } from './components/ui/segmented-control'
import { Select } from './components/ui/select'
import { Switch } from './components/ui/switch'
import {
  browserFlags,
  codexConnect,
  codexDisconnect,
  checkUpdate,
  applyUpdate,
  codexStatus,
  contextUsage,
  EMPTY_ACTIVITY,
  bubbleMenu,
  listSkills,
  askClaude,
  newId,
  existingHooks,
  readState,
  setExistingHook,
  setPlugin,
  setSkill,
  skillState,
  runningChats,
  setExpanded,
  startDrag,
  writeConfig,
  type CodexStatus,
  type ContextSnapshot,
  type SkillState,
  type UpdateState,
  type ExistingHooks,
  type Running,
  type Skill,
} from './lib/backend'
import { detectLang, eventHint, eventName, saveLang, UI, type Lang } from './lib/i18n'
import { modelName } from './lib/names'
import {
  afterChange,
  askFlow,
  createSaver,
  followState,
  busyPlaces,
  noteInput,
  type Input,
  NOTICE_MS,
  noticePlace,
  pluginNote,
  REOPEN_MS,
  updateFlow,
  type Ask,
  type Notice,
  type SaveStatus,
} from './lib/machines'
import {
  decidingScope,
  emptyAgent,
  itemFilled,
  itemLabel,
  listOf,
  mergeItems,
  CLAUDE_SLOTS,
  slotOf,
  SLOTS,
  unreachable,
  withList,
  type Activity,
  type Agent,
  type ClassicReach,
  type Config,
  type Item,
  type Place,
  type Places,
  type Scope,
} from './lib/lifecycle'

const POLL_MS = 800
const SAVE_DELAY_MS = 350
const RUNNING_MS = 4000
const EXISTING_MS = 15000
const UPDATE_MS = 30 * 60_000
const UPDATE_MIN_GAP_MS = 5 * 60_000
/** A hover card lists this many hooks of a kind, then how many more (the editor lists them all). */
const TIP_ROWS = 4

type Theme = 'system' | 'light' | 'dark'
const THEME_KEY = 'hoochi.theme'
const THEMES: Theme[] = ['system', 'light', 'dark']

function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Light, dark, or the computer's setting; affectUI and the picture read `.dark` on <html>. */
function useTheme(theme: Theme) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

/** False while the window is hidden in the menu bar: nothing is read then. */
function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

function newItem(event: string, agent: Agent): Item {
  const slot = slotOf(event, agent)
  return {
    id: newId(),
    event,
    kind: slot?.canInject === false ? 'command' : 'text',
    text: '',
    command: '',
    mode: 'always',
    skill: '',
    tools: '',
    enabled: true,
    once: false,
    added: Date.now(),
  }
}

const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path



const ThemeIcons: Record<Theme, ReactNode> = {
  system: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5v11A5.5 5.5 0 0 0 8 2.5Z" fill="currentColor" />
    </svg>
  ),
  light: (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </svg>
  ),
  dark: (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" />
    </svg>
  ),
}

const TrashIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path
      d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const HideIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
  </svg>
)

const EMPTY_CONFIG: Config = { version: 2, claude: emptyAgent(), codex: emptyAgent() }

/** The popup open over the panel: your whole list, or every skill. One at a time. */
type Modal = 'mine' | 'skills' | 'send' | 'pick' | null

/** Connecting Codex: what the last press did, or that one is under way. */
type CodexFlow = { step: 'idle' } | { step: 'busy' } | { step: 'connected-now' } | { step: 'failed'; error: string }

const UNHOOKED_KEY = 'hoochi.unhookedSeen'
function loadUnhookedSeen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(UNHOOKED_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function saveUnhookedSeen(keys: string[]) {
  try {
    localStorage.setItem(UNHOOKED_KEY, JSON.stringify(keys))
  } catch {
    // only a convenience
  }
}


/** A steady color per terminal, so moving to another terminal is visible at a glance. */
function colorOf(terminal: string): string {
  let h = 0
  for (const c of terminal) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 70% 50%)`
}

/** The chat you opened or typed in last, across Claude Code and Codex. */
function lastChatOf(activity: Record<Agent, Activity>) {
  const all = (['claude', 'codex'] as const).flatMap(agent => {
    const chat = activity[agent].lastChat
    return chat ? [{ agent, ...chat }] : []
  })
  return all.sort((a, b) => b.at - a.at)[0]
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  useTheme(theme)
  const visible = usePageVisible()
  const [expanded, setIsExpanded] = useState(browserFlags.panel)
  const [config, setConfig] = useState<Config>(EMPTY_CONFIG)
  const [activity, setActivity] = useState<Record<Agent, Activity>>({
    claude: EMPTY_ACTIVITY,
    codex: EMPTY_ACTIVITY,
  })
  const [places, setPlaces] = useState<Places>({ projects: {}, terminals: {} })
  // Where sec-default passes Claude Code's classic hooks by, the moments only they serve are dimmed.
  const [classic, setClassic] = useState<ClassicReach>('unknown')
  const [selected, setSelected] = useState<string | null>(browserFlags.select)
  // The full picture of every moment, behind "See every moment" (the main moments show as cards).
  const [showAll, setShowAll] = useState(false)
  // The first screen is one chat box; the moments are a page you open from it.
  const [page, setPage] = useState<'chat' | 'moments'>(browserFlags.select ? 'moments' : 'chat')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  // A rule from a sentence, opened in the editor to adjust before it is saved.
  const [draft, setDraft] = useState<Item | null>(null)
  const [mineQuery, setMineQuery] = useState('')
  const [skills, setSkills] = useState<Skill[]>([])
  const [lang, setLang] = useState<Lang>(detectLang)
  const [agent, setAgent] = useState<Agent>(browserFlags.agent === 'codex' ? 'codex' : 'claude')
  const [scope, setScope] = useState<Scope>(
    browserFlags.scope === 'project' || browserFlags.scope === 'terminal' ? browserFlags.scope : 'global',
  )
  const [projectKey, setProjectKey] = useState('')
  const [terminalKey, setTerminalKey] = useState('')
  const [codex, setCodex] = useState<CodexStatus | null>(null)
  const [codexFlow, setCodexFlow] = useState<CodexFlow>({ step: 'idle' })
  const [running, setRunning] = useState<Running[]>([])
  const [existing, setExisting] = useState<ExistingHooks>({ claude: [], codex: [] })
  const [notice, setNotice] = useState<Notice<Config> | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  // A change to many items at once waits here for a yes (askFlow in machines.ts).
  const [asking, setAsking] = useState<Ask | null>(null)
  const [context, setContext] = useState<ContextSnapshot | null>(null)
  const [update, dispatchUpdate] = useReducer(updateFlow, { step: 'unknown' })
  const [justUpdated, setJustUpdated] = useState<UpdateState['updated']>(null)
  const [skillsNow, setSkillsNow] = useState<SkillState>({ off: [], plugins: [] })
  /** The model each Claude Code terminal's chat runs, from its /context. */
  const [models, setModels] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!modal) return
    if (modal === 'skills')
      void skillState()
        .then(setSkillsNow)
        .catch(() => undefined)
    const close = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.hw-confirm[data-asking]')) return
      setModal(null)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [modal])
  // The hover card counts only skills that can be switched, so it needs the installed plugins;
  // read again with each new /context, since a plugin may have been switched since.
  const contextAt = context?.at
  useEffect(() => {
    if (contextAt === undefined) return
    void skillState()
      .then(setSkillsNow)
      .catch(() => undefined)
  }, [contextAt])
  const t = UI[lang]

  // You moved the window yourself: following waits for your next chat.
  const [held, setHeld] = useState(false)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  // Your edits are written after a short delay, one write at a time; one that failed stays on
  // screen (the file does not replace it) until it is written. See lib/machines.ts.
  const [saving, setSaving] = useState<{ status: SaveStatus; error?: string }>({ status: 'saved' })
  const [saver] = useState(() =>
    createSaver<Config>({
      write: writeConfig,
      key: c => JSON.stringify(c),
      delay: SAVE_DELAY_MS,
      onStatus: (status, error) => setSaving({ status, error }),
    }),
  )

  // Read the files: the plugin and the Codex hook write activity, and may switch "once" items off.
  useEffect(() => {
    if (!visible) return
    let alive = true
    const tick = async () => {
      try {
        const s = await readState()
        if (!alive) return
        setActivity({ claude: s.claude, codex: s.codex })
        setClassic(s.classic)
        setPlaces(s.places)
        if (saver.fromDisk(JSON.stringify(s.config))) setConfig(s.config)
      } catch {
        // try again on the next tick
      }
    }
    void tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [visible, saver])

  useEffect(() => {
    if (expanded && skills.length === 0)
      void listSkills()
        .then(setSkills)
        .catch(() => undefined)
  }, [expanded, skills.length])

  // Every chat open in a terminal, found from the process list, even before hoochi hears from it.
  useEffect(() => {
    if (!expanded || !visible) return
    let alive = true
    const scan = () =>
      void runningChats()
        .then(list => alive && setRunning(list))
        .catch(() => undefined)
    scan()
    const id = window.setInterval(scan, RUNNING_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [expanded, visible])

  useEffect(() => {
    if (expanded)
      void codexStatus()
        .then(setCodex)
        .catch(() => undefined)
  }, [expanded, agent])
  /** Connect or disconnect Codex: one press at a time, and what went wrong is said in place. */
  const codexDo = (run: () => Promise<CodexStatus>, after: CodexFlow) => {
    setCodexFlow({ step: 'busy' })
    void run()
      .then(status => {
        setCodex(status)
        setCodexFlow(after)
      })
      .catch((e: unknown) => setCodexFlow({ step: 'failed', error: String(e) }))
  }

  // Always follow the chat you typed in last, on its own: its AI's picture, its project and its terminal.
  // Not while a moment is open for editing; it catches up when you go back to the workflow.
  // The tab follows too (below): this project when that chat is in one, else everywhere.
  const latest = lastChatOf(activity)
  // Input in several places at once (a tool typing into many terminals looks like you typing):
  // the window stays put until input comes to one place alone.
  const inputs = useRef<Input[]>([])
  if (latest) inputs.current = noteInput(inputs.current, { terminal: latest.place.terminal, at: latest.at })
  const busy = busyPlaces(inputs.current)
  const isBusy = busy.length > 1
  const followed = useRef(0)
  const holdFollow = () => {
    followed.current = Math.max(followed.current, Date.now())
    setHeld(true)
  }
  useEffect(() => {
    if (!latest || selected !== null || latest.at <= followed.current) return
    followed.current = latest.at
    if (isBusy) return
    setHeld(false)
    setAgent(latest.agent)
    setProjectKey(latest.place.project)
    setTerminalKey(latest.place.terminal)
  }, [latest, selected, isBusy])

  // The tab: "this project" when the chat you are in has a git project, else
  // "everywhere". "This terminal" is yours to pick; once picked it stays, on the terminal you chat
  // in last. Picking another tab yourself holds following until you chat again (holdFollow).
  const chatHasProject = latest ? isProject(latest.place.project, latest.place.terminal) : false
  useEffect(() => {
    if (held || isBusy || selected !== null || !latest) return
    setScope(s => (s === 'terminal' ? s : chatHasProject ? 'project' : 'global'))
  }, [held, isBusy, selected, latest, chatHasProject])

  // A newer hoochi: looked for when the window opens, each time you open the panel (at most every
  // five minutes), and every half hour while it is shown. About two GitHub requests an hour.
  const lastLook = useRef(0)
  const lookForUpdate = useCallback((force = false) => {
    if (!force && Date.now() - lastLook.current < UPDATE_MIN_GAP_MS) return
    lastLook.current = Date.now()
    void checkUpdate()
      .then(u => {
        dispatchUpdate({ type: 'checked', info: { current: u.current, latest: u.latest, available: u.available } })
        // told once by the window, so kept until you close it
        if (u.updated) setJustUpdated(u.updated)
      })
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (!visible) return
    lookForUpdate()
    const id = window.setInterval(() => lookForUpdate(true), UPDATE_MS)
    return () => window.clearInterval(id)
  }, [visible, lookForUpdate])
  useEffect(() => {
    if (expanded) lookForUpdate()
  }, [expanded, lookForUpdate])
  const runUpdate = async () => {
    if (update.step !== 'available' || !update.info.latest) return
    dispatchUpdate({ type: 'install' })
    try {
      await applyUpdate(update.info.latest)
      dispatchUpdate({ type: 'installed' })
    } catch (e) {
      dispatchUpdate({ type: 'failed', error: t.updateFailed(String(e)) })
    }
  }
  // The window quits and reopens as the new one; still here after a while, it says so.
  useEffect(() => {
    if (update.step !== 'reopening') return
    const id = window.setTimeout(() => dispatchUpdate({ type: 'failed', error: t.updateStuck }), REOPEN_MS)
    return () => window.clearTimeout(id)
  }, [update.step, t])

  // /context for the Claude Code chat you are in (or, when that is Codex, the Claude terminal in
  // view), as its chat keeps writing it. Shown whether or not the window follows you.
  const contextTerminal =
    latest?.agent === 'claude' ? latest.place.terminal : agent === 'claude' ? terminalKey : ''
  useEffect(() => {
    setContext(null)
    if (!expanded || !visible || !contextTerminal) return
    let alive = true
    const read = () =>
      void contextUsage(contextTerminal)
        .then(snap => {
          if (!alive) return
          setContext(snap)
          const model = snap?.model ? modelName(snap.model) : ''
          if (model) setModels(m => (m[contextTerminal] === model ? m : { ...m, [contextTerminal]: model }))
        })
        .catch(() => undefined)
    read()
    const id = window.setInterval(read, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [expanded, visible, contextTerminal])

  // The figures the picture draws, from the snapshot: drawn only on Claude Code's picture.
  const contextFill: ContextFill | undefined =
    context && agent === 'claude'
      ? {
          used: context.used,
          max: context.max,
          percent: context.percent,
          compactAt: context.compactAt,
          loaded: context.rows
            .filter(r => r.kind === 'used' && r.name !== 'Messages')
            .reduce((n, r) => n + r.tokens, 0),
          messages: context.rows.find(r => r.name === 'Messages')?.tokens ?? 0,
        }
      : undefined
  // When each of your items last ran, from what the agent recorded.
  const lastRun = useMemo(() => {
    const at: Record<string, number> = {}
    for (const f of activity[agent].recent) if (f.id && (at[f.id] ?? 0) < f.at) at[f.id] = f.at
    return at
  }, [activity, agent])
  const failed = (e: unknown) => setNotice({ kind: 'error', message: t.toggleFailed(String(e)) })
  /** What the hover card adds about the context, at the moments it fills up. */
  const contextTip = (event: string): ReactNode => {
    if (!context || !contextFill) return null
    const focus: ContextFocus | undefined =
      event === 'SessionStart'
        ? 'start'
        : event === 'UserPromptSubmit' || event === 'PostToolUse'
          ? 'messages'
          : event === 'PreCompact' || event === 'PostCompact'
            ? 'compact'
            : undefined
    if (!focus) return null
    return (
      <ContextGlance
        snap={context}
        focus={focus}
        plugins={skillsNow.plugins}
        t={t}
        extra={
          focus === 'start' && context.skills ? (
            <Button size="sm" variant="ghost" onClick={() => setModal('skills')}>
              {t.skillsAll}
            </Button>
          ) : undefined
        }
      />
    )
  }


  // Moving to another terminal shows a short notice, and the "chatting now" chip flashes.
  const [switched, setSwitched] = useState<{ terminal: string; at: number } | null>(null)
  const lastTerminal = useRef('')
  useEffect(() => {
    const now = latest?.place.terminal ?? ''
    if (!now || now === lastTerminal.current) return
    if (lastTerminal.current && !isBusy) setSwitched({ terminal: now, at: Date.now() })
    else setSwitched(null)
    lastTerminal.current = now
  }, [latest, isBusy])
  useEffect(() => {
    if (!switched) return
    const id = window.setTimeout(() => setSwitched(null), 5000)
    return () => window.clearTimeout(id)
  }, [switched])

  // Without a chat seen yet, open on the project and terminal that were active last.
  // (Once a chat is known, following decides; this must not overwrite it.)
  const last = activity[agent].place
  useEffect(() => {
    if (latest) return
    if (last && !projectKey) setProjectKey(last.project)
    if (last && !terminalKey) setTerminalKey(last.terminal)
  }, [latest, last, projectKey, terminalKey])

  const save = useCallback(
    (next: Config) => {
      setConfig(next)
      saver.save(next)
    },
    [saver],
  )
  /** An edit of yours: an undo still on offer would now throw it away, so the undo ends. */
  const edit = (next: Config) => {
    save(next)
    setNotice(afterChange)
  }

  const open = async () => {
    await setExpanded(true)
    setIsExpanded(true)
  }

  const collapse = async () => {
    setIsExpanded(false)
    setSelected(null)
    setModal(null)
    await setExpanded(false)
  }

  /** Whether a folder is a git project: from the open chats, else from what hoochi has seen. */
  function isProject(path: string, terminal = ''): boolean {
    return (
      running.find(r => r.terminal === terminal)?.hasProject ??
      running.find(r => r.project === path)?.hasProject ??
      places.projects[path]?.git ??
      false
    )
  }
  const terminalProject =
    running.find(r => r.terminal === terminalKey)?.project ??
    places.terminals[terminalKey]?.cwd ??
    (latest?.place.terminal === terminalKey ? latest.place.project : '')
  const terminalHasProject = terminalProject !== '' && isProject(terminalProject, terminalKey)
  // A chat is named by its project and its AI (the model, once its /context said which), never
  // by a number: numbers moved as chats opened and closed. Its color dot tells two alike apart.
  const chatName = (terminal: string, project: string, who: Agent) =>
    [project && isProject(project, terminal) ? folderName(project) : t.noProject, models[terminal] ?? t.agents[who]].join(
      ' · ',
    )
  const terminalAgent: Agent =
    running.find(r => r.terminal === terminalKey)?.agent ??
    (places.terminals[terminalKey]?.agent === 'codex' ? 'codex' : 'claude')
  // Claude Code chats hoochi is not running in (opened before it was installed): the window
  // cannot follow them or put anything in, so it says which, and how to bring hoochi in.
  const unhooked = running.filter(r => r.agent === 'claude' && r.hoochi === false)
  // "Don't show again": the chats seen then are remembered (each by terminal and start), so only a
  // new chat without hoochi brings the notice back.
  const [unhookedSeen, setUnhookedSeen] = useState<string[]>(loadUnhookedSeen)
  const chatKey = (r: Running) => `${r.terminal}@${r.started ?? 0}`
  const unhookedNew = unhooked.filter(r => !unhookedSeen.includes(chatKey(r)))
  const dismissUnhooked = () => {
    const keys = unhooked.map(chatKey)
    setUnhookedSeen(keys)
    saveUnhookedSeen(keys)
  }
  const allProjects = [
    ...new Set([
      ...running.filter(r => r.hasProject).map(r => r.project),
      ...Object.entries(places.projects)
        .filter(([, v]) => v.git)
        .map(([path]) => path),
    ]),
  ]

  const key = scope === 'project' ? projectKey : scope === 'terminal' ? terminalKey : ''
  const scopeReady = scope === 'global' || key !== ''
  const list = scopeReady ? listOf(config[agent], scope, key) : []
  const setList = (next: Item[]) => edit(withList(config, agent, scope, key, next))

  const addTo = (item: Item) => setList([...list, item])
  const changeItem = (item: Item) => setList(list.map(i => (i.id === item.id ? item : i)))
  const removeItem = (id: string) => setList(list.filter(i => i.id !== id))

  // Copy between scopes. Nothing is overwritten: items already there are skipped, and one undo is kept.
  const act = (next: Config, message: string, near: 'controls' | 'list' = 'controls') => {
    save(next)
    setNotice({ kind: 'undo', message, before: config, near })
  }
  const ask = (a: Ask) => setAsking(s => askFlow(s, { kind: 'ask', ask: a }).state)
  const answer = (yes: boolean) => {
    const r = askFlow(asking, { kind: yes ? 'yes' : 'no' })
    setAsking(r.state)
    r.run?.()
  }
  // What an ask would do was worked out on the config and place as they were: any change ends it.
  useEffect(() => setAsking(s => askFlow(s, { kind: 'changed' }).state), [config, agent, scope, key, modal])
  useEffect(() => {
    if (!asking) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAsking(null)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [asking])
  // Sending items to other places: one sheet picks what and where; an undo follows, no second ask.
  const [sendPicked, setSendPicked] = useState<ReadonlySet<string>>(new Set())
  const filled = list.filter(itemFilled)
  const sendTargets: Target[] = [
    ...(scope !== 'global' ? [{ place: { scope: 'global' as const, key: '' }, name: t.scopes.global }] : []),
    ...allProjects
      .filter(p => !(scope === 'project' && p === projectKey))
      .map(p => ({ place: { scope: 'project' as const, key: p }, name: folderName(p) })),
  ]
  const openSend = (ids: string[]) => {
    setSendPicked(new Set(ids))
    setModal('send')
  }
  const itemWords = (items: Item[]) =>
    items.length === 1 ? `‘${itemLabel(items[0])}’` : t.itemsCount(items.length)
  const sendItems = (items: Item[], places: PlaceRef[]) => {
    const r = sendTo(config, agent, items, places, newId)
    setModal(null)
    const names = sendTargets.filter(x => places.some(p => p.scope === x.place.scope && p.key === x.place.key))
    act(r.config, t.sentDone(itemWords(items), names.map(x => x.name).join(' · ')))
  }
  // What a broader place puts in at a moment that this place's own items hide.
  const here: PlaceRef = { scope, key }
  const hiddenFor = (event: string) => {
    if (!scopeReady) return null
    const found = hiddenHere(config, agent, here, terminalHasProject ? terminalProject : '', event)
    if (found.length === 0) return null
    const items = found.flatMap(h => h.items)
    const from = found
      .map(h => (h.place.scope === 'global' ? t.scopes.global : t.placeProject(folderName(h.place.key))))
      .join(' · ')
    return { what: itemWords(items), from, items }
  }
  const addHidden = (event: string) => {
    const h = hiddenFor(event)
    if (!h) return
    const merged = mergeItems(list, h.items, newId)
    act(withList(config, agent, scope, key, merged.list), t.copied(merged.added))
  }

  // ---------- Saying it in words ----------
  // A new rule is made in Claude Code's moments (marking the ones Codex has too); each AI then has
  // its own button that puts it in, converted for that AI (`ruleFor`). A sentence can also change
  // the rules already put in: reword or move one, copy some, switch some off or on, delete some.
  const momentList = momentsOf(CLAUDE_SLOTS, e => eventName(e, lang, 'claude'), e => eventHint(e, lang, 'claude')).map(m => {
    const c = slotOf(m.event, 'codex')
    return { ...m, codex: !!c && (c.canInject || !m.canInject) }
  })
  const skillNames = skills.map(s => s.name)
  /** The AI a terminal's chats run, so only that AI's rules go in there. */
  const terminalAgentOf = (k: string): Agent =>
    running.find(r => r.terminal === k)?.agent ?? (places.terminals[k]?.agent === 'codex' ? 'codex' : 'claude')
  /** The places a sentence can name: everywhere, the projects and terminals that have rules or are open. */
  const placeOpts = (): PlaceOpt[] => {
    const projects = new Set<string>()
    const terminals = new Set<string>()
    for (const a of ['claude', 'codex'] as const) {
      Object.keys(config[a].projects).forEach(k => projects.add(k))
      Object.keys(config[a].terminals).forEach(k => terminals.add(k))
    }
    for (const r of running) {
      if (r.hasProject) projects.add(r.project)
      terminals.add(r.terminal)
    }
    if (projectKey) projects.add(projectKey)
    if (terminalKey) terminals.add(terminalKey)
    return [
      { ref: 'g', scope: 'global', key: '', words: t.scopes.global },
      ...[...projects].map((key, i) => ({ ref: `p${i + 1}`, scope: 'project' as const, key, words: `${placeName({ scope: 'project', key })} (${key})` })),
      ...[...terminals].map((key, i) => ({
        ref: `t${i + 1}`,
        scope: 'terminal' as const,
        key,
        words: placeName({ scope: 'terminal', key }),
        agent: terminalAgentOf(key),
      })),
    ]
  }
  const knownRules = (): Known[] =>
    allTargets(config).map((x, i) => ({ ...x, ref: `r${i + 1}`, place: placeName(x) }))
  /** The rules the last card left on screen, as they are now, so "turn those off" knows which. */
  const onLastCard = (known: Known[]): Known[] => {
    const card = [...exchanges].reverse().find(x => x.state === 'rule' || x.state === 'edit' || x.state === 'find')
    if (!card) return []
    const shown: Held[] =
      card.state === 'find'
        ? (card.found ?? []).filter(k => card.rows?.[rowKey(k)]?.action !== 'delete')
        : card.state === 'edit' && card.edit
          ? touched(card.edit, !!card.done)
          : Object.entries(card.added ?? {}).map(([a, v]) => ({ agent: a as Agent, ...v.target, index: 0, item: { id: v.itemId } as Item }))
    return shown.flatMap(t => known.filter(k => k.agent === t.agent && k.scope === t.scope && k.key === t.key && k.item.id === t.item.id))
  }
  /** This computer's Claude Code reads the sentence; without it, the ready-made rules and words. */
  const understand = async (text: string): Promise<Understood & { fallback?: boolean }> => {
    const known = knownRules()
    const opts = placeOpts()
    const here = opts.find(p => scopeReady && p.scope === scope && p.key === key)?.ref ?? 'g'
    const last = exchanges[exchanges.length - 1]
    const shown = onLastCard(known)
    const recent = last ? { said: last.said, refs: shown.map(k => k.ref) } : undefined
    try {
      const answer = await askClaude(
        systemFor({ agent: 'claude', moments: momentList, skills: skillNames, lang, known, places: opts, here, recent }),
        schemaFor(momentList, known.some(k => k.agent === 'codex') ? CODEX_ONLY : []),
        text,
        MODEL,
      )
      const r = interpret(answer, { moments: momentList, skills: skillNames, known, places: opts })
      if (r.ok || r.say) return r
    } catch {
      // no Claude Code here, or it failed: the ready-made rules answer
    }
    const edit = matchEdit(text, known, shown)
    if (edit) return { ...edit, fallback: true }
    const r = matchRecipe(text, lang, momentList)
    return r.ok ? { ok: true, action: 'add', rule: r.rule, fallback: true } : { ...r, fallback: true }
  }
  /**
   * Where something goes in for one AI. A terminal belongs to one AI, so for the other one it goes
   * in that terminal's project instead (or everywhere when it has none).
   */
  const destFor = (p: { scope: Scope; key: string; agent?: Agent }, who: Agent): PlaceRef => {
    if (p.scope !== 'terminal' || (p.agent ?? terminalAgentOf(p.key)) === who) return { scope: p.scope, key: p.key }
    const project =
      running.find(r => r.terminal === p.key && r.hasProject)?.project ??
      (places.terminals[p.key]?.cwd && isProject(places.terminals[p.key].cwd, p.key) ? places.terminals[p.key].cwd : '')
    return project ? { scope: 'project', key: project } : { scope: 'global', key: '' }
  }
  /** Where a new rule goes in for one AI: the place it names, else everywhere or the place picked. */
  const placeOfRule = (rule: Rule, who: Agent = agent, at?: PlaceOpt): PlaceRef => {
    if (at) return destFor(at, who)
    if (rule.scope === 'global' || !scopeReady || scope === 'global') return { scope: 'global', key: '' }
    return destFor({ scope, key }, who)
  }
  const placeWords = (p: PlaceRef) => (p.scope === 'global' ? t.scopes.global : placeName(p))
  /** A change to the rules put in, made concrete: where each one ends up, and new ids for copies. */
  const editOf = (u: Understood): Edit | null => {
    if (!u.ok || u.action === 'add') return null
    if (u.action === 'find') return null
    if (u.action === 'change') {
      const changes = u.changes.map(c => {
        const who = u.to.agent ?? c.target.agent
        const to = destFor(u.to.place ?? { scope: c.target.scope, key: c.target.key, agent: c.target.agent }, who)
        return { target: c.target, item: c.item, to: { agent: who, ...to } }
      })
      return { action: 'change', changes }
    }
    if (u.action === 'copy') {
      const copies = u.targets.flatMap(k => {
        const who = u.to.agent ?? k.agent
        const to = destFor(u.to.place ?? { scope: k.scope, key: k.key, agent: k.agent }, who)
        if (who === k.agent && to.scope === k.scope && to.key === k.key) return []
        const fit = itemFor(k.item, who)
        if (!fit.ok) return []
        // Not twice: a copy already there (same moment and words) is left out.
        if (hasAll(config, who, to, [fit.item])) return []
        return [{ item: { ...fit.item, id: newId(), added: Date.now() }, to: { agent: who, ...to } }]
      })
      return copies.length ? { action: 'copy', copies } : null
    }
    return { action: u.action, targets: u.targets }
  }
  const say = (text: string) => {
    const id = newId()
    setExchanges(xs => [...xs, { id, said: text, state: 'thinking' }])
    void understand(text).then(u =>
      setExchanges(xs =>
        xs.map(x => {
          if (x.id !== id) return x
          if (!u.ok) return { ...x, state: 'unclear', say: u.say }
          if (u.action === 'add')
            return { ...x, state: 'rule', rule: u.rule, at: u.place, place: placeWords(placeOfRule(u.rule, 'claude', u.place)), fallback: u.fallback }
          if (u.action === 'find') return { ...x, state: 'find', found: u.targets, fallback: u.fallback }
          const edit = editOf(u)
          return edit ? { ...x, state: 'edit', edit, fallback: u.fallback } : { ...x, state: 'unclear', say: t.chatCopyNone }
        }),
      ),
    )
  }
  /** Why a rule cannot go in for that AI, in words; "" when it can. */
  const cannotAdd = (rule: Rule, who: Agent) => {
    if (who === 'codex' && codex && !codex.installed) return t.codexMissing
    const r = ruleFor(rule, who)
    return r.ok ? '' : r.why === 'no-moment' ? t.chatNoMoment(t.agents[who]) : t.chatNoWords(t.agents[who])
  }
  /** Codex runs what hoochi puts in only once its hooks point here: putting one in connects it. */
  const connectCodexFor = (agents: Agent[]) => {
    if (agents.includes('codex') && codex?.installed && !codex.connected) codexDo(codexConnect, { step: 'connected-now' })
  }
  const addRule = (x: Exchange, who: Agent) => {
    if (!x.rule) return
    const r = ruleFor(x.rule, who)
    if (!r.ok) return
    const p = placeOfRule(r.rule, who, x.at)
    const item = itemOf(r.rule, newId(), Date.now())
    save(withList(config, who, p.scope, p.key, [...listOf(config[who], p.scope, p.key), item]))
    connectCodexFor([who])
    const added = { itemId: item.id, target: p, place: placeWords(p) }
    setExchanges(xs => xs.map(e => (e.id === x.id ? { ...e, added: { ...e.added, [who]: added } } : e)))
  }
  const undoRule = (x: Exchange, who: Agent) => {
    const a = x.added?.[who]
    if (!a) return
    const { scope: s0, key: k0 } = a.target
    save(withList(config, who, s0, k0, listOf(config[who], s0, k0).filter(i => i.id !== a.itemId)))
    setExchanges(xs =>
      xs.map(e => {
        if (e.id !== x.id) return e
        const rest = { ...e.added }
        delete rest[who]
        return { ...e, added: rest }
      }),
    )
  }
  /** Do what the card says to the rules put in; and take it back. */
  const applyChange = (x: Exchange) => {
    if (!x.edit || x.done) return
    save(applyEdit(config, x.edit))
    if (x.edit.action === 'change') connectCodexFor(x.edit.changes.map(c => c.to.agent))
    if (x.edit.action === 'copy') connectCodexFor(x.edit.copies.map(c => c.to.agent))
    setExchanges(xs => xs.map(e => (e.id === x.id ? { ...e, done: true } : e)))
  }
  /** On a list of rules found: switch one off or on, or delete it, right away; and take that back. */
  const rowAct = (x: Exchange, k: Known, action: 'off' | 'on' | 'delete') => {
    const e: Edit = { action, targets: [k] }
    save(applyEdit(config, e))
    setExchanges(xs => xs.map(v => (v.id === x.id ? { ...v, rows: { ...v.rows, [rowKey(k)]: e } } : v)))
  }
  const rowUndo = (x: Exchange, k: Known) => {
    const e = x.rows?.[rowKey(k)]
    if (!e) return
    save(revertEdit(config, e))
    setExchanges(xs =>
      xs.map(v => {
        if (v.id !== x.id) return v
        const rows = { ...v.rows }
        delete rows[rowKey(k)]
        return { ...v, rows }
      }),
    )
  }
  /** Open one rule found in the editor, at its own AI and place. */
  const rowOpen = (k: Known) => {
    if (k.agent !== agent) setAgent(k.agent)
    goTo({ item: k.item, scope: k.scope, key: k.key, at: 0 })
  }
  const revertChange = (x: Exchange) => {
    if (!x.edit || !x.done) return
    save(revertEdit(config, x.edit))
    setExchanges(xs => xs.map(e => (e.id === x.id ? { ...e, done: false } : e)))
  }
  const editRule = (x: Exchange) => {
    if (!x.rule) return
    // The editor opens on the AI picked, or on Claude Code when the rule cannot go in for it.
    const mine = ruleFor(x.rule, agent)
    const who: Agent = mine.ok ? agent : 'claude'
    const r = mine.ok ? mine.rule : x.rule
    if (who !== agent) setAgent(who)
    const p = placeOfRule(r, who, x.at)
    if (p.scope !== scope) {
      setScope(p.scope)
      holdFollow()
    }
    if (p.scope === 'project') setProjectKey(p.key)
    if (p.scope === 'terminal') setTerminalKey(p.key)
    setDraft(itemOf(r, newId(), Date.now()))
    // The editor shows over either page; going back returns to the chat it came from.
    setSelected(r.event)
  }
  /** What an item puts in, in a few words, with its tags. */
  const wordsOf = (item: Item) => (
    <>
      <i className="hw-moment-kind" data-kind={item.kind}>
        {t.kinds[item.kind]}
      </i>
      <span className="hw-moment-label">{itemLabel(item)}</span>
      {item.kind === 'command' && item.mode === 'onFail' && <i className="hw-moment-tag">{t.tagOnFail}</i>}
      {item.tools && <i className="hw-moment-tag">{item.tools}</i>}
      {item.once && <i className="hw-moment-tag">{t.tagOnce}</i>}
      {!item.enabled && <i className="hw-moment-tag">{t.tagOff}</i>}
    </>
  )
  const ruleWords = (rule: Rule) => wordsOf(itemOf(rule, '', 0))
  /** Which AI, which place, which moment: the line above a rule on a change card. */
  const whereOf = (at: { agent: Agent } & PlaceRef, event: string) =>
    `${t.agents[at.agent]} · ${placeWords(at)} · ${eventName(event, lang, at.agent)}`

  /** Everything put in for this AI, by place then by moment: inline on the moments page and in the popup. */
  const mineBody = (at: 'page' | 'modal') => (
    <>
            {mine.length > 6 && (
              <input
                className="hw-pick-search hw-mine-search"
                type="search"
                placeholder={t.mineSearch}
                aria-label={t.mineSearch}
                value={mineQuery}
                onChange={e => setMineQuery(e.currentTarget.value)}
              />
            )}
            {asking?.near === 'modal' && (at === 'modal') === (modal === 'mine') && askBanner}
            {at === 'modal' && inModal}
            <div className="hw-modal-list">
              {groups.map(g => ({ ...g, shown: g.rows.filter(mineFound) })).filter(g => g.shown.length > 0).map(g => (
                <section key={`${g.scope}-${g.key}`} className="hw-mine-place">
                  <h4>
                    <span>{g.name}</span>
                    <small>{t.itemsCount(g.rows.length)}</small>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      icon={TrashIcon}
                      label={t.deleteGroup(g.name)}
                      onClick={() => askDeleteGroup(g)}
                    />
                  </h4>
                  {byMoment(g.shown).map(([event, rows]) => (
                    <div key={event} className="hw-mine-moment">
                      <p className="hw-mine-moment-name">{eventName(event, lang, agent)}</p>
                      {rows.map(m => mineRow(m))}
                    </div>
                  ))}
                </section>
              ))}
            </div>
    </>
  )
  const noticeBanner = notice && (
    <div className="hw-done" role={notice.kind === 'error' ? 'alert' : 'status'} data-notice={notice.kind}>
      <span>{notice.message}</span>
      {notice.kind === 'undo' ? (
        <Button size="sm" variant="ghost" onClick={undo}>
          {t.undo}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
          {t.close}
        </Button>
      )}
    </div>
  )
  const askBanner = asking && (
    <div className="hw-confirm" role="alertdialog" data-asking={asking.danger ? 'delete' : 'copy'}>
      <span>{asking.message}</span>
      <div>
        <Button size="sm" variant="ghost" onClick={() => answer(false)}>
          {t.cancel}
        </Button>
        <Button size="sm" variant={asking.danger ? 'destructive' : 'primary'} onClick={() => answer(true)}>
          {asking.yes}
        </Button>
      </div>
    </div>
  )
  function undo() {
    if (notice?.kind !== 'undo') return
    save(notice.before)
    setNotice(null)
  }
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), NOTICE_MS[notice.kind])
    return () => window.clearTimeout(id)
  }, [notice])
  const noticeAt = noticePlace(notice, modal)
  // An edit that could not be written: kept on screen, said until it is.
  const saveBar = saving.status === 'failed' && (
    <div className="hw-update" role="alert" data-save="failed">
      <span>{t.saveFailed(saving.error ?? '')}</span>
      <Button size="sm" variant="primary" onClick={() => saver.retry()}>
        {t.retry}
      </Button>
    </div>
  )
  const inModal = (
    <>
      {saveBar}
      {noticeAt === 'modal' && noticeBanner}
    </>
  )

  // Hooks already set up outside hoochi at this place, read again now and then.
  const existingProject = scope === 'global' ? '' : scope === 'project' ? projectKey : terminalProject
  useEffect(() => {
    if (!expanded || !visible) return
    let alive = true
    const read = () =>
      void existingHooks(existingProject)
        .then(found => alive && setExisting(found))
        .catch(() => undefined)
    read()
    const id = window.setInterval(read, EXISTING_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [expanded, visible, existingProject])
  const existingCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const h of existing[agent]) if (!h.off) counts[h.event] = (counts[h.event] ?? 0) + 1
    return counts
  }, [existing, agent])

  const activeCount = useMemo(() => {
    const all = (a: typeof config.claude) => [
      ...a.global,
      ...Object.values(a.projects).flat(),
      ...Object.values(a.terminals).flat(),
    ]
    // Only what does something: switched on and not left empty.
    return [...all(config.claude), ...all(config.codex)].filter(i => i.enabled && itemFilled(i)).length
  }, [config])

  // Which place the scope notes talk about: the chosen project/terminal, else the last active one.
  const place: Place = {
    project: projectKey || last?.project || '',
    terminal: terminalKey || last?.terminal || '',
    terminalLabel: '',
  }
  const noteFor = (event: string): string | undefined => {
    const decides = decidingScope(config[agent], event, place)
    if (!decides || !scopeReady) return undefined
    const order: Scope[] = ['global', 'project', 'terminal']
    if (decides !== scope && order.indexOf(decides) > order.indexOf(scope))
      return t.overriddenBy(t.scopes[decides])
    const wider = order
      .slice(0, order.indexOf(scope))
      .find(s => listOf(config[agent], s, s === 'project' ? place.project : '').some(i => i.event === event))
    return wider && list.some(i => i.event === event) ? t.replaces(t.scopes[wider]) : undefined
  }

  // Open chats first (newest first), then places seen before, most recent first.
  const openProjects = [...new Set(running.filter(r => r.hasProject).map(r => r.project))]
  const projectOptions = [
    ...openProjects.map(path => ({
      value: path,
      label: folderName(path),
      description: `${t.openChats(running.filter(r => r.project === path).length)} · ${path}`,
    })),
    ...Object.entries(places.projects)
      .filter(([path, v]) => v.git && !openProjects.includes(path))
      .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
      .map(([path]) => ({ value: path, label: folderName(path), description: `${t.closed} · ${path}` })),
  ]

  // What you put in, newest first, across every place, for the list at the bottom and the popup.
  type Mine = { item: Item; scope: Scope; key: string; at: number }
  const mine: Mine[] = (() => {
    const a = config[agent]
    const all: Omit<Mine, 'at'>[] = [
      ...a.global.map(item => ({ item, scope: 'global' as const, key: '' })),
      ...Object.entries(a.projects).flatMap(([key, l]) =>
        l.map(item => ({ item, scope: 'project' as const, key })),
      ),
      ...Object.entries(a.terminals).flatMap(([key, l]) =>
        l.map(item => ({ item, scope: 'terminal' as const, key })),
      ),
    ]
    // Items from before hoochi kept the time come after, newest in each list first.
    return all
      .map((m, i) => ({ mine: { ...m, at: m.item.added ?? 0 }, i }))
      .sort((x, y) => y.mine.at - x.mine.at || y.i - x.i)
      .map(x => x.mine)
  })()
  const placeName = (m: Pick<Mine, 'scope' | 'key'>) =>
    m.scope === 'global'
      ? t.scopes.global
      : m.scope === 'project'
        ? t.placeProject(folderName(m.key))
        : t.placeTerminal(
            chatName(
              m.key,
              running.find(r => r.terminal === m.key)?.project ?? places.terminals[m.key]?.cwd ?? '',
              running.find(r => r.terminal === m.key)?.agent ??
                (places.terminals[m.key]?.agent === 'codex' ? 'codex' : 'claude'),
            ),
          )
  const setMine = (m: Mine, enabled: boolean) =>
    edit(
      withList(
        config,
        agent,
        m.scope,
        m.key,
        listOf(config[agent], m.scope, m.key).map(i => (i.id === m.item.id ? { ...i, enabled } : i)),
      ),
    )
  // Deleted at once, with the undo kept for a while, as the copy buttons do.
  const deleteMine = (m: Mine) =>
    act(
      withList(
        config,
        agent,
        m.scope,
        m.key,
        listOf(config[agent], m.scope, m.key).filter(i => i.id !== m.item.id),
      ),
      t.mineDeleted(eventName(m.item.event, lang, agent)),
      'list',
    )
  /** Everything put in at one place (everywhere, a project or a terminal), after a yes. */
  const askDeleteGroup = (g: { name: string; scope: Scope; key: string; rows: Mine[] }) =>
    ask({
      message: t.askDeleteGroup(g.rows.length, g.name),
      yes: t.deleteYes,
      danger: true,
      near: 'modal',
      run: () => act(withList(config, agent, g.scope, g.key, []), t.deletedN(g.rows.length), 'list'),
    })
  /** Everything put in for this agent, everywhere, after a yes. */
  const askDeleteAll = () =>
    ask({
      message: t.askDeleteAll(mine.length, t.agents[agent]),
      yes: t.deleteYes,
      danger: true,
      near: 'modal',
      run: () => act({ ...config, [agent]: emptyAgent() }, t.deletedN(mine.length), 'list'),
    })
  const goTo = (m: Mine) => {
    setModal(null)
    setScope(m.scope)
    if (m.scope === 'project') setProjectKey(m.key)
    if (m.scope === 'terminal') setTerminalKey(m.key)
    // Editing somewhere other than the chat you are in: hold following, or it would jump back.
    const here = m.scope === 'project' ? latest?.place.project : latest?.place.terminal
    if (m.scope !== 'global' && m.key !== here) holdFollow()
    setSelected(m.item.event)
  }
  const mineRow = (m: Mine) => {
    const label = itemLabel(m.item)
    const name = eventName(m.item.event, lang, agent)
    return (
      <div className="hw-mine-row" key={`${m.scope}-${m.key}-${m.item.id}`} data-off={!m.item.enabled || undefined}>
        <button type="button" className="hw-mine-go" title={t.goEdit} onClick={() => goTo(m)}>
          <span className="hw-mine-what">
            <i className="hw-moment-kind" data-kind={m.item.kind}>
              {t.kinds[m.item.kind]}
            </i>
            <span>{label === '(empty)' ? t.emptyItem : label}</span>
          </span>
          {(m.item.mode === 'onFail' && m.item.kind === 'command') || m.item.once || m.item.tools || !m.item.enabled ? (
            <span className="hw-mine-tags">
              {m.item.kind === 'command' && m.item.mode === 'onFail' && <i className="hw-moment-tag">{t.tagOnFail}</i>}
              {m.item.once && <i className="hw-moment-tag">{t.tagOnce}</i>}
              {m.item.tools && <i className="hw-moment-tag">{m.item.tools}</i>}
              {!m.item.enabled && <i className="hw-moment-tag">{t.tagOff}</i>}
            </span>
          ) : null}
        </button>
        <Switch size="sm" aria-label={t.mineSwitch(name)} checked={m.item.enabled} onChange={e => setMine(m, e.currentTarget.checked)} />
        <IconButton size="sm" variant="ghost" icon={TrashIcon} label={t.mineDelete(name)} onClick={() => deleteMine(m)} />
      </div>
    )
  }
  // Within a place, by moment in the order a chat goes through them.
  const order = SLOTS[agent].map(x => x.event)
  const byMoment = (rows: Mine[]) => {
    const events = [...new Set(rows.map(m => m.item.event))].sort((x, y) => order.indexOf(x) - order.indexOf(y))
    return events.map(e => [e, rows.filter(m => m.item.event === e)] as const)
  }
  const mineFound = (m: Mine) => {
    const q = mineQuery.trim().toLowerCase()
    if (!q) return true
    return `${eventName(m.item.event, lang, agent)} ${itemLabel(m.item)} ${t.kinds[m.item.kind]}`.toLowerCase().includes(q)
  }
  const groups = [
    { name: t.scopes.global, scope: 'global' as const, key: '', rows: mine.filter(m => m.scope === 'global') },
    ...[...new Set(mine.filter(m => m.scope === 'project').map(m => m.key))].map(key => ({
      name: placeName({ scope: 'project', key }),
      scope: 'project' as const,
      key,
      rows: mine.filter(m => m.scope === 'project' && m.key === key),
    })),
    ...[...new Set(mine.filter(m => m.scope === 'terminal').map(m => m.key))].map(key => ({
      name: placeName({ scope: 'terminal', key }),
      scope: 'terminal' as const,
      key,
      rows: mine.filter(m => m.scope === 'terminal' && m.key === key),
    })),
  ].filter(g => g.rows.length > 0)

  const slot = selected ? slotOf(selected, agent) : undefined
  const whereWords =
    scope === 'global'
      ? t.whereGlobal
      : scope === 'project'
        ? t.whereProject(folderName(key))
        : t.whereTerminal(chatName(key, terminalProject, terminalAgent))
  const following = followState(selected !== null, held, isBusy)

  if (!expanded) {
    return (
      <div className="hw-bubble-host" data-view="bubble" data-follow={following}>
        <SandwichBubble
          activeCount={activeCount}
          pulseKey={Math.max(activity.claude.lastAt, activity.codex.lastAt)}
          chatColor={latest ? colorOf(latest.place.terminal) : undefined}
          chatName={latest ? chatName(latest.place.terminal, latest.place.project, latest.agent) : undefined}
          onOpen={() => void open()}
          onDragStart={() => void startDrag()}
          onMenu={() => void bubbleMenu(t.hide, t.quitApp)}
        />
      </div>
    )
  }

  return (
    <div
      className="hw-panel"
      data-view={slot ? 'editor' : page === 'chat' ? 'chat' : 'picture'}
      data-modal={modal ?? undefined}
      data-save={saving.status}
      data-update={update.step}
      data-follow={following}
    >
      <header
        className="hw-head"
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest('button')) return
          void startDrag()
        }}
      >
        <div className="hw-head-title">
          <img className="hw-head-icon" src={hoochiIcon} alt="" width={28} height={28} draggable={false} />
          hoochi
          <span title={t.onHint}>{t.on(activeCount)}</span>
        </div>
        <DropdownMenu
          align="end"
          aria-label={t.language}
          items={(
            [
              ['en', 'English'],
              ['ko', '한국어'],
              ['ja', '日本語'],
              ['zh', '中文'],
            ] as const
          ).map(([value, label]) => ({
            label,
            type: 'radio' as const,
            checked: lang === value,
            onSelect: () => {
              setLang(value)
              saveLang(value)
            },
          }))}
          trigger={({ triggerProps }) => (
            <Button size="sm" variant="ghost" title={t.language} {...triggerProps}>
              {{ en: 'EN', ko: '한국어', ja: '日本語', zh: '中文' }[lang]} ▾
            </Button>
          )}
        />
        <IconButton
          size="sm"
          variant="ghost"
          icon={ThemeIcons[theme]}
          label={`${t.themeLabel}: ${t.themes[theme]}`}
          onClick={() => {
            const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
            setTheme(next)
            try {
              localStorage.setItem(THEME_KEY, next)
            } catch {
              // only a convenience
            }
          }}
        />
        {/* × folds the panel into the bubble; hiding is on the bubble's right-click menu */}
        <IconButton size="sm" variant="ghost" icon={HideIcon} label={t.fold} onClick={() => void collapse()} />
      </header>

      {!modal && saveBar}
      {justUpdated && (
        <div className="hw-update" role="status">
          <span>
            {t.updatedTo(justUpdated.to)}{' '}
            {
              { auto: t.updatedPluginAuto, once: t.updatedPluginOnce, 'by-hand': t.updatedNoPlugin }[
                pluginNote(justUpdated)
              ]
            }
          </span>
          <Button size="sm" variant="ghost" onClick={() => setJustUpdated(null)}>
            {t.close}
          </Button>
        </div>
      )}
      {!justUpdated &&
        (update.step === 'available' || update.step === 'installing' || update.step === 'reopening') && (
          <div className="hw-update" role="status" data-new>
            <span>
              {update.step === 'reopening'
                ? t.updateReopening
                : update.step === 'available' && update.error
                  ? update.error
                  : t.updateReady(update.info.latest ?? '', update.info.current)}
            </span>
            {update.step !== 'reopening' && (
              <Button
                size="sm"
                variant="primary"
                disabled={update.step === 'installing'}
                onClick={() => void runUpdate()}
              >
                {update.step === 'installing' ? t.updating : t.updateNow}
              </Button>
            )}
          </div>
        )}

      {!slot && (
        <nav className="hw-tabs" role="tablist" aria-label={t.tabsLabel}>
          <button
            type="button"
            role="tab"
            aria-selected={page === 'chat'}
            onClick={() => {
              setPage('chat')
              setShowAll(false)
            }}
          >
            {t.tabSay}
          </button>
          <button type="button" role="tab" aria-selected={page === 'moments'} onClick={() => setPage('moments')}>
            {t.tabMine}
            <b className="hw-tabs-count">{mine.length}</b>
          </button>
        </nav>
      )}
      {page === 'chat' && !slot ? (
        <main className="hw-body hw-body-chat">
          <ChatView
            lang={lang}
            exchanges={exchanges}
            momentName={e => eventName(e, lang, 'claude')}
            ruleWords={ruleWords}
            itemWords={wordsOf}
            whereOf={whereOf}
            cannot={cannotAdd}
            onApply={applyChange}
            onRevert={revertChange}
            onRow={rowAct}
            onRowUndo={rowUndo}
            onRowOpen={rowOpen}
            onSay={say}
            onAdd={addRule}
            onEdit={editRule}
            onUndo={undoRule}
            onPick={() => setModal('pick')}
            where={
              <DropdownMenu
                align="start"
                side="top"
                aria-label={t.scopeLabel}
                items={[
                  { label: t.scopes.global, type: 'radio' as const, checked: scope === 'global', onSelect: () => { setScope('global'); holdFollow() } },
                  {
                    label: projectKey ? `${t.scopes.project} · ${folderName(projectKey)}` : t.scopes.project,
                    type: 'radio' as const,
                    disabled: !projectKey,
                    checked: scope === 'project',
                    onSelect: () => { setScope('project'); holdFollow() },
                  },
                  { label: t.scopes.terminal, type: 'radio' as const, disabled: !terminalKey, checked: scope === 'terminal', onSelect: () => setScope('terminal') },
                ]}
                trigger={({ triggerProps }) => (
                  <button type="button" className="hw-chat-where" {...triggerProps}>
                    {scopeReady ? placeWords({ scope, key }) : t.scopes.global} ▾
                  </button>
                )}
              />
            }
          />
        </main>
      ) : (
        <>
      <div className="hw-controls">
        {unhookedNew.length > 0 && (
          <div className="hw-note hw-unhooked" role="status">
            <p>
              <b>{t.unhookedTitle(unhooked.length)}</b> {t.unhookedHow}
            </p>
            <Button size="sm" variant="ghost" onClick={dismissUnhooked}>
              {t.unhookedDismiss}
            </Button>
          </div>
        )}
        <div className="hw-row">
          <span className="hw-row-label">{t.rowAgent}</span>
          <SegmentedControl
            size="sm"
            aria-label={t.rowAgent}
            options={[
              { value: 'claude', label: t.agents.claude },
              { value: 'codex', label: t.agents.codex },
            ]}
            value={agent}
            onChange={next => {
              setAgent(next)
              setSelected(null)
              holdFollow()
            }}
          />
          {latest && isBusy && (
            <div className="hw-now" data-busy title={t.busyHint}>
              {busy.slice(0, 4).map(term => (
                <span key={term} className="hw-now-dot" style={{ background: colorOf(term) }} aria-hidden="true" />
              ))}
              <b>{t.busyNow(busy.length)}</b>
            </div>
          )}
          {latest && !isBusy && (
            <div
              className="hw-now"
              key={latest.place.terminal}
              data-moved={switched ? true : undefined}
              title={switched ? t.switchedTo(chatName(latest.place.terminal, latest.place.project, latest.agent)) : undefined}
            >
              <span className="hw-now-dot" style={{ background: colorOf(latest.place.terminal) }} aria-hidden="true" />
              <span className="hw-now-label">{t.nowChatting}</span>
              <b>{chatName(latest.place.terminal, latest.place.project, latest.agent)}</b>
            </div>
          )}
        </div>
        <div className="hw-row">
          <span className="hw-row-label">{t.scopeLabel}</span>
          <SegmentedControl
            size="sm"
            aria-label={t.scopeLabel}
            options={[
              { value: 'global', label: t.scopes.global },
              { value: 'project', label: t.scopes.project },
              { value: 'terminal', label: t.scopes.terminal },
            ]}
            value={scope}
            onChange={next => {
              setScope(next)
              // "This terminal" is kept while following; the other two would be changed back at once.
              if (next !== 'terminal') holdFollow()
            }}
          />
          {scope === 'project' && projectOptions.length > 0 && (
            <div className="hw-row-fill">
              <Select
                size="sm"
                aria-label={t.pickProject}
                placeholder={t.pickProject}
                options={projectOptions}
                value={projectKey || null}
                onChange={next => {
                  setProjectKey(next)
                  holdFollow()
                }}
              />
            </div>
          )}
        </div>
        <div className="hw-where">
          <p>
            {!scopeReady
              ? t.noPlaces
              : scope === 'terminal'
                ? t.terminalNow(chatName(terminalKey, terminalProject, terminalAgent))
                : t.appliesTo(whereWords)}
          </p>
          {scopeReady && filled.length > 0 && sendTargets.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => openSend(filled.map(i => i.id))}>
              {t.sendAll}
            </Button>
          )}
        </div>
        {asking?.near === 'controls' && askBanner}
        {noticeAt === 'controls' && noticeBanner}
        {agent === 'codex' && codex && (
          <div className="hw-codex">
            {!codex.installed ? (
              <span>{t.codexMissing}</span>
            ) : codex.connected ? (
              <>
                <span>
                  {codexFlow.step === 'failed'
                    ? t.toggleFailed(codexFlow.error)
                    : codexFlow.step === 'connected-now'
                      ? t.codexTrust
                      : '✓ Codex'}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={codexFlow.step === 'busy'}
                  onClick={() => codexDo(codexDisconnect, { step: 'idle' })}
                >
                  {t.codexDisconnect}
                </Button>
              </>
            ) : (
              <>
                <span>{codexFlow.step === 'failed' ? t.toggleFailed(codexFlow.error) : t.codexOff}</span>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={codexFlow.step === 'busy'}
                  onClick={() => codexDo(codexConnect, { step: 'connected-now' })}
                >
                  {t.codexConnect}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <main className="hw-body">
        {!scopeReady ? null : slot ? (
          <SlotEditor
            key={`${slot.event}:${draft?.id ?? ''}`}
            slot={slot}
            agent={agent}
            blocked={unreachable(agent, classic).has(slot.event)}
            note={noteFor(slot.event)}
            existing={existing[agent].filter(h => h.event === slot.event)}
            onToggleExisting={(hook, on) =>
              void setExistingHook(existingProject, hook.id, on)
                .then(setExisting)
                .catch(failed)
            }
            lastRun={lastRun}
            extra={
              slot.event === 'SessionStart' && agent === 'claude' && context?.skills ? (
                <Button size="sm" variant="secondary" onClick={() => setModal('skills')}>
                  {t.skillsAll}
                </Button>
              ) : undefined
            }
            items={list.filter(i => i.event === slot.event)}
            skills={skills}
            lang={lang}
            onChange={changeItem}
            onRemove={removeItem}
            makeItem={() => newItem(slot.event, agent)}
            onAdd={addTo}
            onBack={() => {
              setSelected(null)
              setDraft(null)
            }}
            where={whereWords}
            startWith={draft?.event === slot.event ? draft : null}
            onSend={sendTargets.length > 0 ? item => openSend([item.id]) : undefined}
          />
        ) : (
          <>
            {!showAll && (
            <MomentList
              agent={agent}
              lang={lang}
              items={list}
              activity={activity[agent]}
              existing={existingCounts}
              unreachable={unreachable(agent, classic)}
              onSelect={setSelected}
              hidden={hiddenFor}
              onAddHidden={addHidden}
              alsoIn={item => alsoIn(config, agent, here, item).length}
              onAddOther={() => setModal('pick')}
            />
            )}
            {!showAll && mine.length > 0 && (
              <section className="hw-mine-all" aria-label={t.mineAllTitle}>
                <div className="hw-mine-all-head">
                  <h2 className="hw-moments-title">
                    {t.mineAllTitle} <small>{mine.length}</small>
                  </h2>
                  <Button size="sm" variant="ghost" className="hw-delete-all" onClick={askDeleteAll}>
                    {t.deleteAll}
                  </Button>
                </div>
                <p className="hw-editor-hint">{t.mineAllHint(t.agents[agent])}</p>
                {mineBody('page')}
              </section>
            )}
            {showAll && (
            <>
            <button type="button" className="hw-link hw-back-list" onClick={() => setShowAll(false)}>
              {t.backToList}
            </button>
            <p className="hw-diagram-hint">
              {t.diagramHint}
              <br />
              {t.legend}
            </p>
            <LifecycleDiagram
              layout={agent === 'codex' ? CODEX_LAYOUT : CLAUDE_LAYOUT}
              agent={agent}
              items={list}
              activity={activity[agent]}
              selectedEvent={selected}
              onSelect={setSelected}
              lang={lang}
              existing={existingCounts}
              context={contextFill}
              unreachable={unreachable(agent, classic)}
              describe={event => {
                const added = list.filter(i => i.event === event)
                const already = existing[agent].filter(h => h.event === event)
                const fired = activity[agent].counts[event] ?? 0
                return (
                  <div className="hw-tip">
                    <div className="hw-tip-head">
                      <b>{eventName(event, lang, agent)}</b>
                      {fired > 0 && <span className="hw-tip-count">{t.fired(fired)}</span>}
                    </div>
                    {unreachable(agent, classic).has(event) && <p className="hw-tip-blocked">{t.blockedShort}</p>}
                    {added.length === 0 && already.length === 0 && !contextFill && <p>{t.tipEmpty}</p>}
                    {contextTip(event)}
                    {added.length > 0 && (
                      <section>
                        <div className="hw-tip-label">
                          {t.tipAdded} · {t.scopes[scope]}
                        </div>
                        <ul className="hw-tip-list">
                          {added.slice(0, TIP_ROWS).map(i => (
                            <li key={i.id} data-off={!i.enabled || undefined}>
                              <i className="hw-chip" data-kind={i.kind}>
                                {t.kinds[i.kind]}
                              </i>
                              <span>{itemLabel(i)}</span>
                              {!i.enabled && <em>{t.tipOff}</em>}
                            </li>
                          ))}
                          {added.length > TIP_ROWS && (
                            <li className="hw-tip-more">{t.tipMore(added.length - TIP_ROWS)}</li>
                          )}
                        </ul>
                      </section>
                    )}
                    {already.length > 0 && (
                      <section>
                        <div className="hw-tip-label">{t.tipExisting}</div>
                        <ul className="hw-tip-list">
                          {already.slice(0, TIP_ROWS).map(h => (
                            <li key={h.id} data-off={h.off || undefined}>
                              <i className="hw-chip" data-kind="existing">
                                {t.existingFrom(h.from)}
                              </i>
                              <span>
                                {h.origin?.name ?? h.name}
                                {h.matcher ? ` · ${t.onlyWhen(h.matcher)}` : ''}
                              </span>
                              {h.off && <em>{t.tipOff}</em>}
                            </li>
                          ))}
                          {already.length > TIP_ROWS && (
                            <li className="hw-tip-more">{t.tipMore(already.length - TIP_ROWS)}</li>
                          )}
                        </ul>
                      </section>
                    )}
                    {added.length === 0 && already.length === 0 && contextFill && (
                      <p className="hw-tip-hint">{t.tipEmpty}</p>
                    )}
                  </div>
                )
              }}
            />
            </>
            )}
          </>
        )}
      </main>

      <footer className="hw-feed hw-mine" aria-label={t.mine}>
        <div className="hw-mine-head">
          {slot ? (
            <span>
              {t.mine} · {mine.length}
            </span>
          ) : (
            <button type="button" className="hw-link" aria-pressed={showAll} onClick={() => setShowAll(v => !v)}>
              {showAll ? t.backToList : t.flowView}
            </button>
          )}
          {slot && mine.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setModal('mine')}>
              {t.seeAll(mine.length)}
            </Button>
          )}
        </div>
        {/* One line: the main moments above already show what is in; the list opens in a popup. */}
        {mine.length === 0 && <p className="hw-editor-hint">{t.noneYet}</p>}
        {noticeAt === 'list' && noticeBanner}
      </footer>
        </>
      )}

      {modal === 'skills' && (
        <SkillsPanel
          snap={context}
          state={skillsNow}
          local={skills}
          t={t}
          banner={inModal}
          onSkill={(name, on) => void setSkill(name, on).then(setSkillsNow).catch(failed)}
          onPlugin={(key, on) => void setPlugin(key, on).then(setSkillsNow).catch(failed)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'pick' && (
        <MomentPicker
          lang={lang}
          agent={agent}
          unreachable={unreachable(agent, classic)}
          onPick={event => {
            setModal(null)
            setShowAll(false)
            setSelected(event)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'send' && (
        <SendSheet
          lang={lang}
          agent={agent}
          items={filled}
          picked={sendPicked}
          targets={sendTargets}
          has={(place, items) => hasAll(config, agent, place, items)}
          banner={inModal}
          onSend={sendItems}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'mine' && (
        <div
          className="hw-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t.mine}
          onClick={e => e.target === e.currentTarget && setModal(null)}
        >
          <div className="hw-modal-card">
            <div className="hw-modal-head">
              <b>
                {t.mine} · {mine.length}
              </b>
              {mine.length > 0 && (
                <Button size="sm" variant="ghost" className="hw-delete-all" onClick={askDeleteAll}>
                  {t.deleteAll}
                </Button>
              )}
              <IconButton
                size="sm"
                variant="ghost"
                icon={HideIcon}
                label={t.close}
                onClick={() => setModal(null)}
              />
            </div>
            <p className="hw-editor-hint">{t.mineHint}</p>
            {mineBody('modal')}
          </div>
        </div>
      )}
    </div>
  )
}
