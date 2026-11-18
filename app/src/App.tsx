import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { CLAUDE_LAYOUT, CODEX_LAYOUT, LifecycleDiagram } from './components/hookwich/lifecycle-diagram'
import { SandwichBubble } from './components/hookwich/sandwich-bubble'
import { SlotEditor } from './components/hookwich/slot-editor'
import { Button } from './components/ui/button'
import { IconButton } from './components/ui/icon-button'
import { SegmentedControl } from './components/ui/segmented-control'
import { Select } from './components/ui/select'
import { Switch } from './components/ui/switch'
import {
  browserFlags,
  codexConnect,
  codexDisconnect,
  codexStatus,
  EMPTY_ACTIVITY,
  hideWindow,
  listSkills,
  newId,
  existingHooks,
  readState,
  setExistingHook,
  runningChats,
  setExpanded,
  startDrag,
  writeConfig,
  type CodexStatus,
  type ExistingHooks,
  type Running,
  type Skill,
} from './lib/backend'
import { detectLang, eventName, saveLang, UI, type Lang } from './lib/i18n'
import {
  decidingScope,
  emptyAgent,
  itemLabel,
  listOf,
  mergeItems,
  slotOf,
  withList,
  type Activity,
  type Agent,
  type Config,
  type Fired,
  type Item,
  type Place,
  type Places,
  type Scope,
} from './lib/lifecycle'

const POLL_MS = 800
const SAVE_DELAY_MS = 350
const RUNNING_MS = 4000
const EXISTING_MS = 15000

type Theme = 'system' | 'light' | 'dark'
const THEME_KEY = 'hookwich.theme'
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
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
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
  }
}

const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

const MinimizeIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3.5 8h9" strokeLinecap="round" />
  </svg>
)

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

const HideIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
  </svg>
)

const EMPTY_CONFIG: Config = { version: 2, claude: emptyAgent(), codex: emptyAgent() }

const FOLLOW_KEY = 'hookwich.follow'
function loadFollow(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) !== 'off'
  } catch {
    return true
  }
}
function saveFollow(on: boolean) {
  try {
    localStorage.setItem(FOLLOW_KEY, on ? 'on' : 'off')
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
  const [selected, setSelected] = useState<string | null>(browserFlags.select)
  const [skills, setSkills] = useState<Skill[]>([])
  const [lang, setLang] = useState<Lang>(detectLang)
  const [agent, setAgent] = useState<Agent>(browserFlags.agent === 'codex' ? 'codex' : 'claude')
  const [scope, setScope] = useState<Scope>(
    browserFlags.scope === 'project' || browserFlags.scope === 'terminal' ? browserFlags.scope : 'global',
  )
  const [projectKey, setProjectKey] = useState('')
  const [terminalKey, setTerminalKey] = useState('')
  const [codex, setCodex] = useState<CodexStatus | null>(null)
  const [codexNote, setCodexNote] = useState('')
  const [follow, setFollowState] = useState(loadFollow)
  const [running, setRunning] = useState<Running[]>([])
  const [existing, setExisting] = useState<ExistingHooks>({ claude: [], codex: [] })
  const [done, setDone] = useState<{ message: string; before: Config } | null>(null)
  const t = UI[lang]

  const setFollow = (on: boolean) => {
    setFollowState(on)
    saveFollow(on)
    if (on) {
      followed.current = 0
      followedTerminal.current = ''
    }
  }

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  // The config we last wrote or read (as canonical JSON), and whether an edit waits to be saved.
  const known = useRef('')
  const dirty = useRef(false)
  const saveTimer = useRef<number | undefined>(undefined)

  // Read the files: the plugin and the Codex hook write activity, and may switch "once" items off.
  useEffect(() => {
    if (!visible) return
    let alive = true
    const tick = async () => {
      try {
        const s = await readState()
        if (!alive) return
        setActivity({ claude: s.claude, codex: s.codex })
        setPlaces(s.places)
        const text = JSON.stringify(s.config)
        if (!dirty.current && text !== known.current) {
          known.current = text
          setConfig(s.config)
        }
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
  }, [visible])

  useEffect(() => {
    if (expanded && skills.length === 0)
      void listSkills()
        .then(setSkills)
        .catch(() => undefined)
  }, [expanded, skills.length])

  // Every chat open in a terminal, found from the process list, even before hookwich hears from it.
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

  // Follow the chat you typed in last: its AI's picture, its project and its terminal.
  // Not while a moment is open for editing; it catches up when you go back to the picture.
  // On reaching a new terminal, it opens on that project's settings, or on "everywhere" when the
  // terminal is not in a project folder. Within the same terminal, the tab you picked stays.
  const latest = lastChatOf(activity)
  const followed = useRef(0)
  const followedTerminal = useRef('')
  useEffect(() => {
    if (!follow || !latest || selected !== null || latest.at <= followed.current) return
    followed.current = latest.at
    setAgent(latest.agent)
    setProjectKey(latest.place.project)
    setTerminalKey(latest.place.terminal)
    if (latest.place.terminal !== followedTerminal.current) {
      followedTerminal.current = latest.place.terminal
      setScope(isProject(latest.place.project, latest.place.terminal) ? 'project' : 'global')
    }
  }, [follow, latest, selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Moving to another terminal shows a short notice, and the "chatting now" chip flashes.
  const [switched, setSwitched] = useState<{ terminal: string; at: number } | null>(null)
  const lastTerminal = useRef('')
  useEffect(() => {
    const now = latest?.place.terminal ?? ''
    if (!now || now === lastTerminal.current) return
    if (lastTerminal.current) setSwitched({ terminal: now, at: Date.now() })
    lastTerminal.current = now
  }, [latest])
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

  const save = useCallback((next: Config) => {
    setConfig(next)
    dirty.current = true
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      try {
        await writeConfig(next)
        known.current = JSON.stringify(next)
      } finally {
        dirty.current = false
      }
    }, SAVE_DELAY_MS)
  }, [])

  const open = async () => {
    await setExpanded(true)
    setIsExpanded(true)
  }

  const collapse = async () => {
    setIsExpanded(false)
    setSelected(null)
    await setExpanded(false)
  }

  /** Whether a folder is a git project: from the open chats, else from what hookwich has seen. */
  function isProject(path: string, terminal = ''): boolean {
    return (
      running.find(r => r.terminal === terminal)?.hasProject ??
      running.find(r => r.project === path)?.hasProject ??
      places.projects[path]?.git ??
      false
    )
  }
  const terminalProject =
    running.find(r => r.terminal === terminalKey)?.project ?? places.terminals[terminalKey]?.cwd ?? ''
  const terminalHasProject = terminalProject !== '' && isProject(terminalProject, terminalKey)
  // Terminals are told apart by folder, AI and a number in the order they were opened
  // (among the chats open now), never by their raw ids.
  const order = [...running].sort((a, b) => a.pid - b.pid).map(r => r.terminal)
  const chatName = (terminal: string, project: string, who: Agent) => {
    const n = order.indexOf(terminal) + 1
    const sameFolder = running.filter(r => r.project === project).length > 1
    return [folderName(project), t.agents[who], ...(n > 0 && sameFolder ? [t.terminalNo(n)] : [])].join(' · ')
  }
  const terminalAgent: Agent =
    running.find(r => r.terminal === terminalKey)?.agent ??
    (places.terminals[terminalKey]?.agent === 'codex' ? 'codex' : 'claude')
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
  const setList = (next: Item[]) => save(withList(config, agent, scope, key, next))

  const addTo = (event: string) => {
    setList([...list, newItem(event, agent)])
    setSelected(event)
  }
  const changeItem = (item: Item) => setList(list.map(i => (i.id === item.id ? item : i)))
  const removeItem = (id: string) => setList(list.filter(i => i.id !== id))

  // Copy between scopes. Nothing is overwritten: items already there are skipped, and one undo is kept.
  const act = (next: Config, message: string) => {
    setDone({ message, before: config })
    save(next)
  }
  const loadFrom = (from: Scope) => {
    const fromKey = from === 'project' ? terminalProject : ''
    const merged = mergeItems(list, listOf(config[agent], from, fromKey), newId)
    act(withList(config, agent, scope, key, merged.list), t.copied(merged.added))
  }
  const applyGlobal = () => {
    const merged = mergeItems(config[agent].global, list, newId)
    act(withList(config, agent, 'global', '', merged.list), t.copied(merged.added))
  }
  const applyAllProjects = () => {
    const targets = targetProjects
    let next = config
    let added = 0
    for (const p of targets) {
      const merged = mergeItems(listOf(next[agent], 'project', p), list, newId)
      next = withList(next, agent, 'project', p, merged.list)
      added += merged.added
    }
    act(next, t.copiedProjects(added, targets.length))
  }
  // Only what can be done here is shown.
  const targetProjects = allProjects.filter(p => !(scope === 'project' && p === projectKey))
  const actions: { label: string; title?: string; strong?: boolean; run(): void }[] = [
    ...(scope !== 'global' ? [{ label: t.setFromGlobal, strong: true, run: () => loadFrom('global') }] : []),
    ...(scope === 'terminal' && terminalHasProject
      ? [{ label: t.setFromProject, title: terminalProject, strong: true, run: () => loadFrom('project') }]
      : []),
    ...(list.length > 0 && targetProjects.length > 0
      ? [
          {
            label: t.applyAllProjects,
            title: targetProjects.map(folderName).join(', '),
            run: applyAllProjects,
          },
        ]
      : []),
    ...(scope !== 'global' && list.length > 0 ? [{ label: t.applyGlobal, run: applyGlobal }] : []),
  ]

  const undo = () => {
    if (!done) return
    save(done.before)
    setDone(null)
  }
  useEffect(() => {
    if (!done) return
    const id = window.setTimeout(() => setDone(null), 12_000)
    return () => window.clearTimeout(id)
  }, [done])

  // Hooks already set up outside hookwich at this place, read again now and then.
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
    return [...all(config.claude), ...all(config.codex)].filter(i => i.enabled).length
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

  // A record of something put in earlier; it says so when that item has since been deleted.
  const label60 = (i: Item) => {
    const raw = i.kind === 'text' ? i.text : i.kind === 'command' ? `$ ${i.command}` : `/${i.skill}`
    const one = raw.replace(/\s+/g, ' ').trim()
    return one.length > 60 ? `${one.slice(0, 59)}…` : one
  }
  const allItems = [
    ...config[agent].global,
    ...Object.values(config[agent].projects).flat(),
    ...Object.values(config[agent].terminals).flat(),
  ]
  const stillThere = (f: Fired) =>
    f.id
      ? allItems.some(i => i.id === f.id)
      : allItems.some(i => i.event === f.event && label60(i) === f.label)

  const slot = selected ? slotOf(selected, agent) : undefined
  const recent = activity[agent].recent

  if (!expanded) {
    return (
      <div className="hw-bubble-host">
        <SandwichBubble
          activeCount={activeCount}
          pulseKey={Math.max(activity.claude.lastAt, activity.codex.lastAt)}
          chatColor={latest ? colorOf(latest.place.terminal) : undefined}
          chatName={latest ? chatName(latest.place.terminal, latest.place.project, latest.agent) : undefined}
          onOpen={() => void open()}
          onDragStart={() => void startDrag()}
        />
      </div>
    )
  }

  return (
    <div className="hw-panel">
      <header
        className="hw-head"
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest('button')) return
          void startDrag()
        }}
      >
        <div className="hw-head-title">
          hookwich
          <span>{t.on(activeCount)}</span>
        </div>
        <SegmentedControl
          size="sm"
          aria-label={t.language}
          options={[
            { value: 'en', label: 'EN', ariaLabel: 'English' },
            { value: 'ko', label: '한', ariaLabel: '한국어' },
            { value: 'ja', label: '日', ariaLabel: '日本語' },
            { value: 'zh', label: '中', ariaLabel: '中文' },
          ]}
          value={lang}
          onChange={next => {
            setLang(next)
            saveLang(next)
          }}
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
        <IconButton
          size="sm"
          variant="ghost"
          icon={MinimizeIcon}
          label={t.fold}
          onClick={() => void collapse()}
        />
        <IconButton
          size="sm"
          variant="ghost"
          icon={HideIcon}
          label={t.hide}
          onClick={() => void hideWindow()}
        />
      </header>

      <div className="hw-controls">
        <Switch
          size="sm"
          placement="end"
          label={t.follow}
          description={
            t.followHint +
            (follow && latest?.agent === 'claude' && codex?.installed && !codex.connected
              ? ` ${t.followCodex}`
              : '')
          }
          checked={follow}
          onChange={e => setFollow(e.currentTarget.checked)}
        />
        {latest && (
          <div className="hw-now" key={latest.place.terminal} data-moved={switched ? true : undefined}>
            <span
              className="hw-now-dot"
              style={{ background: colorOf(latest.place.terminal) }}
              aria-hidden="true"
            />
            <span className="hw-now-label">{t.nowChatting}</span>
            <b>{chatName(latest.place.terminal, latest.place.project, latest.agent)}</b>
          </div>
        )}
        {switched && latest && (
          <p className="hw-switched" role="status">
            {t.switchedTo(chatName(latest.place.terminal, latest.place.project, latest.agent))}
          </p>
        )}
        <SegmentedControl
          fullWidth
          size="sm"
          aria-label="Agent"
          options={[
            { value: 'claude', label: t.agents.claude },
            { value: 'codex', label: t.agents.codex },
          ]}
          value={agent}
          onChange={next => {
            setAgent(next)
            setSelected(null)
            setFollow(false)
          }}
        />
        <SegmentedControl
          fullWidth
          size="sm"
          aria-label={t.scopeLabel}
          options={[
            { value: 'global', label: t.scopes.global },
            { value: 'project', label: t.scopes.project },
            { value: 'terminal', label: t.scopes.terminal },
          ]}
          value={scope}
          onChange={setScope}
        />
        {scope === 'project' &&
          (projectOptions.length ? (
            <Select
              size="sm"
              aria-label={t.pickProject}
              placeholder={t.pickProject}
              options={projectOptions}
              value={projectKey || null}
              onChange={next => {
                setProjectKey(next)
                setFollow(false)
              }}
            />
          ) : (
            <p className="hw-editor-hint">{t.noPlaces}</p>
          ))}
        {scope === 'terminal' && (
          <p className="hw-editor-hint">
            {terminalKey ? t.terminalNow(chatName(terminalKey, terminalProject, terminalAgent)) : t.noPlaces}
          </p>
        )}
        {scopeReady && actions.length > 0 && (
          <div className="hw-actions">
            {actions.map(a => (
              <Button
                key={a.label}
                size="sm"
                variant={a.strong ? 'secondary' : 'ghost'}
                title={a.title}
                onClick={a.run}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
        {done && (
          <div className="hw-done" role="status">
            <span>{done.message}</span>
            <Button size="sm" variant="ghost" onClick={undo}>
              {t.undo}
            </Button>
          </div>
        )}
        {agent === 'codex' && codex && (
          <div className="hw-codex">
            {!codex.installed ? (
              <span>{t.codexMissing}</span>
            ) : codex.connected ? (
              <>
                <span>{codexNote || '✓ Codex'}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void codexDisconnect()
                      .then(setCodex)
                      .then(() => setCodexNote(''))
                  }
                >
                  {t.codexDisconnect}
                </Button>
              </>
            ) : (
              <>
                <span>{t.codexOff}</span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    void codexConnect()
                      .then(setCodex)
                      .then(() => setCodexNote(t.codexTrust))
                      .catch((e: unknown) => setCodexNote(String(e)))
                  }
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
            slot={slot}
            agent={agent}
            note={noteFor(slot.event)}
            existing={existing[agent].filter(h => h.event === slot.event)}
            onToggleExisting={(hook, on) =>
              void setExistingHook(existingProject, hook.id, on)
                .then(setExisting)
                .catch((e: unknown) => setDone({ message: t.toggleFailed(String(e)), before: config }))
            }
            items={list.filter(i => i.event === slot.event)}
            skills={skills}
            lang={lang}
            onChange={changeItem}
            onRemove={removeItem}
            onAdd={() => addTo(slot.event)}
            onBack={() => setSelected(null)}
          />
        ) : (
          <>
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
              describe={event => {
                const added = list.filter(i => i.event === event)
                const already = existing[agent].filter(h => h.event === event)
                return (
                  <div className="hw-tip">
                    <b>{eventName(event, lang, agent)}</b>
                    {added.length === 0 && already.length === 0 && <p>{t.tipEmpty}</p>}
                    {added.length > 0 && (
                      <>
                        <span>
                          {t.tipAdded} · {t.scopes[scope]}
                        </span>
                        <ul>
                          {added.map(i => (
                            <li key={i.id} data-off={!i.enabled || undefined}>
                              {t.kinds[i.kind]}: {itemLabel(i)}
                              {i.enabled ? '' : ` (${t.tipOff})`}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {already.length > 0 && (
                      <>
                        <span>{t.tipExisting}</span>
                        <ul>
                          {already.map(h => (
                            <li key={h.id} data-off={h.off || undefined}>
                              {h.name} · {t.existingFrom(h.from)}
                              {h.matcher ? ` · ${t.onlyWhen(h.matcher)}` : ''}
                              {h.off ? ` (${t.tipOff})` : ''}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )
              }}
            />
          </>
        )}
      </main>

      {recent.length > 0 && (
        <footer className="hw-feed" aria-label={t.recentTitle}>
          <div className="hw-feed-title">{t.recentTitle}</div>
          {recent
            .slice(-3)
            .reverse()
            .map((f, i) => {
              const gone = !stillThere(f)
              return (
                <div className="hw-feed-row" key={`${f.at}-${i}`} data-gone={gone || undefined}>
                  <span className="hw-feed-time">{t.ago(Date.now() - f.at)}</span>
                  <b>{eventName(f.event, lang, agent)}</b>
                  {f.scope ? ` · ${t.scopes[f.scope]}` : ''}
                  {f.tool ? ` · ${f.tool}` : ''} — {f.label}
                  {gone ? ` (${t.gone})` : ''}
                </div>
              )
            })}
        </footer>
      )}
    </div>
  )
}
