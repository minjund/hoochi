import { eventName, UI, type Lang } from '../../lib/i18n'
import { itemLabel, type Agent, type Item } from '../../lib/lifecycle'
import type { PlaceRef } from '../../lib/copy'
import { useEffect, useState, type ReactNode } from 'react'

import { Button } from '../ui/button'
import { IconButton } from '../ui/icon-button'

export type Target = { place: PlaceRef; name: string }

const CloseIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="m4.5 4.5 7 7m0-7-7 7" strokeLinecap="round" />
  </svg>
)

const keyOf = (p: PlaceRef) => `${p.scope}:${p.key}`

/**
 * Put items from this place into others: pick what (step 1) and where (step 2), read the
 * sentence saying what will happen, then put them in. Places that already have everything picked
 * are greyed out. Nothing asks again after: the window offers an undo instead.
 */
export function SendSheet({
  lang,
  agent,
  items,
  picked: pickedAtFirst,
  targets,
  has,
  banner,
  onSend,
  onClose,
}: {
  lang: Lang
  agent: Agent
  /** what this place has, to choose from */
  items: Item[]
  /** chosen when the sheet opens */
  picked: ReadonlySet<string>
  /** where it can go: everywhere (unless this is everywhere) and the projects */
  targets: Target[]
  /** whether a place already has every one of these items */
  has(place: PlaceRef, items: Item[]): boolean
  /** a notice to show inside (undo, error) */
  banner?: ReactNode
  onSend(items: Item[], places: PlaceRef[]): void
  onClose(): void
}) {
  const t = UI[lang]
  const [what, setWhat] = useState<ReadonlySet<string>>(pickedAtFirst)
  const [where, setWhere] = useState<ReadonlySet<string>>(new Set())
  const chosen = items.filter(i => what.has(i.id))
  const full = (p: PlaceRef) => has(p, chosen)
  const open = targets.filter(x => !full(x.place))
  const places = open.filter(x => where.has(keyOf(x.place)))
  const skipped = targets.filter(x => chosen.length > 0 && full(x.place))
  const projects = targets.filter(x => x.place.scope === 'project')
  const others = targets.filter(x => x.place.scope !== 'project')

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const toggle = (set: ReadonlySet<string>, k: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(k)
    else next.delete(k)
    return next
  }
  const label = (i: Item) => `${eventName(i.event, lang, agent)} · ${t.kinds[i.kind]} ${itemLabel(i)}`
  const whatWords =
    chosen.length === 1 ? `‘${itemLabel(chosen[0])}’(${eventName(chosen[0].event, lang, agent)})` : t.itemsCount(chosen.length)
  const chip = (x: Target) => {
    const k = keyOf(x.place)
    const done = chosen.length > 0 && full(x.place)
    const on = !done && where.has(k)
    return (
      <button
        key={k}
        type="button"
        className="hw-send-chip"
        aria-pressed={on}
        disabled={done}
        onClick={() => setWhere(w => toggle(w, k, !on))}
      >
        {on ? '✓ ' : ''}
        {x.name}
        {done ? ` · ${t.alreadyThere}` : ''}
      </button>
    )
  }

  return (
    <div
      className="hw-modal hw-send"
      role="dialog"
      aria-modal="true"
      aria-label={t.sendTitle}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="hw-modal-card hw-send-card">
        <div className="hw-modal-head">
          <b>{t.sendTitle}</b>
          <IconButton size="sm" variant="ghost" icon={CloseIcon} label={t.close} onClick={onClose} />
        </div>
        {banner}
        <p className="hw-step">
          <span>1</span>
          {t.sendWhat}
        </p>
        <ul className="hw-send-list">
          {items.map(i => (
            <li key={i.id}>
              <label className="hw-send-item" data-on={what.has(i.id) || undefined}>
                <input
                  type="checkbox"
                  checked={what.has(i.id)}
                  onChange={e => setWhat(w => toggle(w, i.id, e.currentTarget.checked))}
                />
                <span>{label(i)}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="hw-step">
          <span>2</span>
          {t.sendWhere}
        </p>
        {others.length > 0 && <div className="hw-send-chips">{others.map(chip)}</div>}
        {projects.length > 0 && (
          <>
            <div className="hw-send-sub">
              <span>{t.sendProjects}</span>
              <button
                type="button"
                className="hw-link"
                onClick={() =>
                  setWhere(w => {
                    const next = new Set(w)
                    for (const x of projects) if (!full(x.place)) next.add(keyOf(x.place))
                    return next
                  })
                }
              >
                {t.selectAll}
              </button>
            </div>
            <div className="hw-send-chips">{projects.map(chip)}</div>
          </>
        )}
        <div className="hw-preview" aria-live="polite">
          <span>✓ {t.previewTitle}</span>
          <p>
            {chosen.length === 0 || places.length === 0
              ? t.sendNothing
              : t.sendPreview(whatWords, places.map(x => x.name).join(' · '), skipped.map(x => x.name).join(', '))}
          </p>
        </div>
        <div className="hw-send-foot">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={chosen.length === 0 || places.length === 0}
            onClick={() => onSend(chosen, places.map(x => x.place))}
          >
            {t.sendGo(places.length)}
          </Button>
        </div>
      </div>
    </div>
  )
}
