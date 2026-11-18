import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  listOf,
  mergeItems,
  slotOf,
  withList,
  type Activity,
  type Agent,
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

/** Follows the system light/dark setting; affectUI reads `.dark` on <html>. */
function useSystemTheme() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
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

/** The chat you opened or typed in last, across Claude Code and Codex. */
function lastChatOf(activity: Record<Agent, Activity>) {
  const all = (['claude', 'codex'] as const).flatMap(agent => {
    const chat = activity[agent].lastChat
    return chat ? [{ agent, ...chat }] : []
  })
  return all.sort((a, b) => b.at - a.at)[0]
}

export default function App() {
  useSystemTheme()
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
  }, [])

  useEffect(() => {
    if (expanded && skills.length === 0)
      void listSkills()
        .then(setSkills)
        .catch(() => undefined)
  }, [expanded, skills.length])

  // Every chat open in a terminal, found from the process list, even before hookwich hears from it.
  useEffect(() => {
    if (!expanded) return
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
  }, [expanded])

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

  // Without a chat seen yet, open on the project and terminal that were active last.
  const last = activity[agent].place
  useEffect(() => {
    if (last && !projectKey) setProjectKey(last.project)
    if (last && !terminalKey) setTerminalKey(last.terminal)
  }, [last, projectKey, terminalKey])

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
    const targets = allProjects.filter(p => !(scope === 'project' && p === projectKey))
    let next = config
    let added = 0
    for (const p of targets) {
      const merged = mergeItems(listOf(next[agent], 'project', p), list, newId)
      next = withList(next, agent, 'project', p, merged.list)
      added += merged.added
    }
    act(next, t.copiedProjects(added, targets.length))
  }
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
    if (!expanded) return
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
  }, [expanded, existingProject])
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
  const shortId = (label: string) => label.split(' ').pop() ?? label
  const terminalOptions = [
    ...running.map(r => ({
      value: r.terminal,
      label: `${folderName(r.project || r.cwd)} · ${t.agents[r.agent]} · ${shortId(r.terminalLabel)}`,
      description: `${r.terminalLabel} · ${places.terminals[r.terminal] ? t.open : t.notHooked}`,
    })),
    ...Object.entries(places.terminals)
      .filter(([id]) => !running.some(r => r.terminal === id))
      .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
      .map(([id, v]) => ({
        value: id,
        label: `${folderName(v.cwd)} · ${v.agent === 'codex' ? t.agents.codex : t.agents.claude} · ${shortId(v.label)}`,
        description: `${v.label} · ${t.closed}`,
      })),
  ]

  const slot = selected ? slotOf(selected, agent) : undefined
  const recent = activity[agent].recent

  if (!expanded) {
    return (
      <div className="hw-bubble-host">
        <SandwichBubble
          activeCount={activeCount}
          pulseKey={Math.max(activity.claude.lastAt, activity.codex.lastAt)}
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
            follow && latest
              ? t.followNow(
                  t.agents[latest.agent],
                  places.terminals[latest.place.terminal]?.label ||
                    latest.place.terminalLabel ||
                    folderName(latest.place.project),
                ) +
                (latest.agent === 'claude' && codex?.installed && !codex.connected
                  ? ` — ${t.followCodex}`
                  : '')
              : t.followHint
          }
          checked={follow}
          onChange={e => setFollow(e.currentTarget.checked)}
        />
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
        {scope === 'terminal' &&
          (terminalOptions.length ? (
            <Select
              size="sm"
              aria-label={t.pickTerminal}
              placeholder={t.pickTerminal}
              options={terminalOptions}
              value={terminalKey || null}
              onChange={next => {
                setTerminalKey(next)
                setFollow(false)
              }}
            />
          ) : (
            <p className="hw-editor-hint">{t.noPlaces}</p>
          ))}
        {scopeReady && (
          <div className="hw-actions">
            {scope !== 'global' && (
              <Button size="sm" variant="secondary" onClick={() => loadFrom('global')}>
                {t.loadGlobal}
              </Button>
            )}
            {scope === 'terminal' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!terminalHasProject}
                title={terminalHasProject ? terminalProject : t.noProjectHere}
                onClick={() => loadFrom('project')}
              >
                {t.loadProject}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={list.length === 0 || allProjects.length === 0}
              title={allProjects.length === 0 ? t.noProjects : allProjects.map(folderName).join(', ')}
              onClick={applyAllProjects}
            >
              {t.applyAllProjects}
            </Button>
            {scope !== 'global' && (
              <Button size="sm" variant="ghost" disabled={list.length === 0} onClick={applyGlobal}>
                {t.applyGlobal}
              </Button>
            )}
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
            />
          </>
        )}
      </main>

      {recent.length > 0 && (
        <footer className="hw-feed" aria-label={t.recent}>
          {recent
            .slice(-3)
            .reverse()
            .map((f, i) => (
              <div className="hw-feed-row" key={`${f.at}-${i}`}>
                <b>{eventName(f.event, lang, agent)}</b>
                {f.scope ? ` · ${t.scopes[f.scope]}` : ''}
                {f.tool ? ` · ${f.tool}` : ''} — {f.label}
              </div>
            ))}
        </footer>
      )}
    </div>
  )
}
