import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { LifecycleSandwich } from './components/hookwich/lifecycle-sandwich'
import { SandwichBubble } from './components/hookwich/sandwich-bubble'
import { SlotEditor } from './components/hookwich/slot-editor'
import { IconButton } from './components/ui/icon-button'
import {
  browserFlags,
  EMPTY_ACTIVITY,
  hideWindow,
  listSkills,
  newId,
  parseActivity,
  parseConfig,
  readState,
  setExpanded,
  startDrag,
  writeConfig,
  type Skill,
} from './lib/backend'
import { ALL_SLOTS, slotOf, type Activity, type Config, type Item } from './lib/lifecycle'

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

function newItem(event: string): Item {
  const slot = slotOf(event)
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

export default function App() {
  useSystemTheme()
  const [expanded, setIsExpanded] = useState(browserFlags.panel)
  const [config, setConfig] = useState<Config>({ version: 1, items: [] })
  const [activity, setActivity] = useState<Activity>(EMPTY_ACTIVITY)
  const [selected, setSelected] = useState<string | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])

  // The config text we last wrote or read, and whether an edit is waiting to be saved.
  const known = useRef('')
  const dirty = useRef(false)
  const saveTimer = useRef<number | undefined>(undefined)

  // Read the files: the plugin writes activity, and may switch "once" items off.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const s = await readState()
        if (!alive) return
        setActivity(parseActivity(s.activity))
        if (!dirty.current && s.config !== known.current) {
          known.current = s.config
          setConfig(parseConfig(s.config))
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

  const save = useCallback((next: Config) => {
    setConfig(next)
    dirty.current = true
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      try {
        known.current = await writeConfig(next)
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

  const addTo = (event: string) => {
    save({ ...config, items: [...config.items, newItem(event)] })
    setSelected(event)
  }

  const changeItem = (item: Item) =>
    save({ ...config, items: config.items.map(i => (i.id === item.id ? item : i)) })

  const removeItem = (id: string) => save({ ...config, items: config.items.filter(i => i.id !== id) })

  const toggleItem = (id: string, enabled: boolean) =>
    save({ ...config, items: config.items.map(i => (i.id === id ? { ...i, enabled } : i)) })

  const activeCount = useMemo(() => config.items.filter(i => i.enabled).length, [config.items])
  const slot = selected ? ALL_SLOTS.find(s => s.event === selected) : undefined

  if (!expanded) {
    return (
      <div className="hw-bubble-host">
        <SandwichBubble
          activeCount={activeCount}
          pulseKey={activity.lastAt}
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
          <span>{activeCount} on</span>
        </div>
        <IconButton
          size="sm"
          variant="ghost"
          icon={MinimizeIcon}
          label="Fold into the bubble"
          onClick={() => void collapse()}
        />
        <IconButton
          size="sm"
          variant="ghost"
          icon={HideIcon}
          label="Hide to the menu bar"
          onClick={() => void hideWindow()}
        />
      </header>

      <main className="hw-body">
        {slot ? (
          <SlotEditor
            slot={slot}
            items={config.items.filter(i => i.event === slot.event)}
            skills={skills}
            onChange={changeItem}
            onRemove={removeItem}
            onAdd={() => addTo(slot.event)}
            onBack={() => setSelected(null)}
          />
        ) : (
          <LifecycleSandwich
            items={config.items}
            activity={activity}
            selectedEvent={selected}
            onSelectSlot={setSelected}
            onAdd={addTo}
            onToggleItem={toggleItem}
          />
        )}
      </main>

      {activity.recent.length > 0 && (
        <footer className="hw-feed" aria-label="Recently put in">
          {activity.recent
            .slice(-3)
            .reverse()
            .map((f, i) => (
              <div className="hw-feed-row" key={`${f.at}-${i}`}>
                <b>{f.event}</b>
                {f.tool ? ` · ${f.tool}` : ''} — {f.label}
              </div>
            ))}
        </footer>
      )}
    </div>
  )
}
