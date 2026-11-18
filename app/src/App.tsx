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
  readState,
  setExpanded,
  startDrag,
  writeConfig,
  type CodexStatus,
  type Skill,
} from './lib/backend'
import { detectLang, eventName, saveLang, UI, type Lang } from './lib/i18n'
import {
  decidingScope,
  emptyAgent,
  listOf,
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
  const [scope, setScope] = useState<Scope>('global')
  const [projectKey, setProjectKey] = useState('')
  const [terminalKey, setTerminalKey] = useState('')
  const [codex, setCodex] = useState<CodexStatus | null>(null)
  const [codexNote, setCodexNote] = useState('')
  const [follow, setFollowState] = useState(loadFollow)
  const t = UI[lang]

  const setFollow = (on: boolean) => {
    setFollowState(on)
    saveFollow(on)
    if (on) followed.current = 0
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

  useEffect(() => {
    if (expanded)
      void codexStatus()
        .then(setCodex)
        .catch(() => undefined)
  }, [expanded, agent])

  // Follow the chat you typed in last: its AI's picture, its project and its terminal.
  // Not while a moment is open for editing; it catches up when you go back to the picture.
  const latest = lastChatOf(activity)
  const followed = useRef(0)
  useEffect(() => {
    if (!follow || !latest || selected !== null || latest.at <= followed.current) return
    followed.current = latest.at
    setAgent(latest.agent)
    setProjectKey(latest.place.project)
    setTerminalKey(latest.place.terminal)
  }, [follow, latest, selected])

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

  const projectOptions = Object.entries(places.projects)
    .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
    .map(([path]) => ({ value: path, label: folderName(path), description: path }))
  const terminalOptions = Object.entries(places.terminals)
    .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
    .map(([id, v]) => ({ value: id, label: v.label, description: `${folderName(v.cwd)} · ${v.agent}` }))

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
            <p className="hw-diagram-hint">{t.diagramHint}</p>
            <LifecycleDiagram
              layout={agent === 'codex' ? CODEX_LAYOUT : CLAUDE_LAYOUT}
              agent={agent}
              items={list}
              activity={activity[agent]}
              selectedEvent={selected}
              onSelect={setSelected}
              lang={lang}
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
