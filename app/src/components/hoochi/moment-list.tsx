import { eventName, UI, type Lang } from '../../lib/i18n'
import { itemFilled, itemLabel, slotOf, type Activity, type Agent, type Item } from '../../lib/lifecycle'
import type { ReactNode } from 'react'

/** The moments most people use, in the order a chat goes through them. Tool moments are one pair. */
const MAIN: (string | [string, string])[] = [
  'SessionStart',
  'UserPromptSubmit',
  ['PreToolUse', 'PostToolUse'],
  'Stop',
  'SessionEnd',
]
export const MAIN_EVENTS: ReadonlySet<string> = new Set(MAIN.flat())

/** How long a moment that just ran is marked. */
const JUST_MS = 90_000

const ICONS: Record<string, ReactNode> = {
  SessionStart: <path d="M8 5.5v13l10-6.5z" />,
  UserPromptSubmit: (
    <>
      <path d="M5 6.5h14v9H10l-4 3.5v-3.5H5z" />
      <path d="M9 10h6M9 12.5h4" />
    </>
  ),
  PreToolUse: (
    <>
      <path d="M5 7.5 9 11.5l-4 4" />
      <path d="M11 16h8" />
    </>
  ),
  PostToolUse: <path d="m5.5 12.5 4 4 9-9.5" />,
  Stop: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  SessionEnd: (
    <>
      <path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" />
      <path d="M14 8.5 17.5 12 14 15.5M17.5 12H9" />
    </>
  ),
}

const Icon = ({ event }: { event: string }) => (
  <span className="hw-moment-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[event]}
    </svg>
  </span>
)

type Props = {
  agent: Agent
  lang: Lang
  /** what is put in at the place shown */
  items: Item[]
  activity: Activity
  /** hooks set up outside hoochi, switched on, by moment */
  existing: Record<string, number>
  unreachable: ReadonlySet<string>
  onSelect(event: string): void
  /** what a broader place puts in at this moment that this place's own items hide */
  hidden?(event: string): { what: string; from: string } | null
  /** copy those hidden items into this place */
  onAddHidden?(event: string): void
  /** how many other places have the same item */
  alsoIn?(item: Item): number
  /** open the picker for the other moments */
  onAddOther(): void
}

/** The moments of the main flow, in the order a chat goes through them. */
const MAIN_LIST = MAIN.flat()

/**
 * What the window shows: the main moments as one-line cards, then the other moments that have
 * something put in here, then one button to put something in at another moment. The moments not
 * in use stay out of sight (the picker finds them).
 */
export function MomentList({
  agent,
  lang,
  items,
  activity,
  existing,
  unreachable,
  onSelect,
  hidden,
  onAddHidden,
  alsoIn,
  onAddOther,
}: Props) {
  const t = UI[lang]
  const now = Date.now()
  const slots = new Set(MAIN_LIST.filter(e => slotOf(e, agent)))
  const others = [...new Set(items.filter(i => itemFilled(i) && !MAIN_EVENTS.has(i.event)).map(i => i.event))].filter(
    e => slotOf(e, agent),
  )

  const card = (event: string) => {
    const here = items.filter(i => i.event === event && itemFilled(i))
    const first = here[0]
    // Only when one of the items shown here ran: with several chats working at once (agents in
    // many terminals), the moment that ran last anywhere says nothing about this place.
    const ids = new Set(here.map(i => i.id))
    const just = activity.recent.some(f => f.event === event && f.id !== undefined && ids.has(f.id) && now - f.at < JUST_MS)
    const blocked = unreachable.has(event)
    const outside = existing[event] ?? 0
    const elsewhere = first && alsoIn ? alsoIn(first) : 0
    const shadow = hidden?.(event) ?? null
    const extra = [
      here.length > 1 ? t.moreItems(here.length - 1) : '',
      elsewhere > 0 ? t.alsoIn(elsewhere) : '',
      outside > 0 ? t.existingCount(outside) : '',
    ].filter(Boolean)
    const button = (
      <button
        type="button"
        className="hw-moment"
        data-just={just || undefined}
        data-empty={here.length === 0 || undefined}
        data-blocked={blocked || undefined}
        onClick={() => onSelect(event)}
      >
        <span className="hw-moment-name">{eventName(event, lang, agent)}</span>
        {first ? (
          <span className="hw-moment-what" data-off={!first.enabled || undefined}>
            <i className="hw-moment-kind" data-kind={first.kind}>
              {t.kinds[first.kind]}
            </i>
            <span className="hw-moment-label">{itemLabel(first)}</span>
            {first.kind === 'command' && first.mode === 'onFail' && <i className="hw-moment-tag">{t.tagOnFail}</i>}
            {first.once && <i className="hw-moment-tag">{t.tagOnce}</i>}
            {!first.enabled && <i className="hw-moment-tag">{t.tagOff}</i>}
          </span>
        ) : (
          <span className="hw-moment-hint">{blocked ? t.blockedCard : `+ ${t.putHere}`}</span>
        )}
        {just ? (
          <span className="hw-moment-just">✓ {t.justNow}</span>
        ) : (
          extra.length > 0 && <span className="hw-moment-more">{extra.join(' · ')}</span>
        )}
      </button>
    )
    if (!shadow) return <li key={event}>{button}</li>
    return (
      <li key={event} className="hw-moment-wrap">
        {button}
        <div className="hw-hidden" role="note">
          <p>{t.hiddenNote(shadow.what, shadow.from)}</p>
          {onAddHidden && (
            <button type="button" className="hw-hidden-add" onClick={() => onAddHidden(event)}>
              {t.hiddenAdd}
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <section className="hw-moments" aria-label={t.momentsTitle}>
      <h2 className="hw-moments-title">{t.momentsTitle}</h2>
      <ul className="hw-moments-list">{MAIN_LIST.filter(e => slots.has(e)).map(card)}</ul>
      {others.length > 0 && (
        <>
          <h3 className="hw-moments-sub">{t.otherMomentsTitle}</h3>
          <ul className="hw-moments-list">{others.map(card)}</ul>
        </>
      )}
      <button type="button" className="hw-add-other" onClick={onAddOther}>
        + {t.addOther}
      </button>
    </section>
  )
}

export type Recipe = { event: string; kind: Item['kind']; text?: string; command?: string; mode?: Item['mode'] }

/** The ready-made items, in the order `t.recipes` describes them. */
export const RECIPES: Recipe[] = [
  { event: 'UserPromptSubmit', kind: 'text' },
  { event: 'Stop', kind: 'command', command: 'npm test', mode: 'onFail' },
  { event: 'SessionStart', kind: 'command', command: 'git status -sb', mode: 'always' },
]

/** Shown while nothing at all is put in: a few common things to start from. */
export function FirstSteps({
  lang,
  place,
  picked,
  onPick,
  onAdd,
  onSkip,
}: {
  lang: Lang
  /** where they go, as words ("the shop project") */
  place: string
  picked: ReadonlySet<number>
  onPick(index: number, on: boolean): void
  onAdd(): void
  onSkip(): void
}) {
  const t = UI[lang]
  return (
    <section className="hw-first" aria-label={t.recipesKicker}>
      <p className="hw-first-kicker">{t.recipesKicker}</p>
      <h2>
        {t.recipesTitle[0]}
        <br />
        <em>{t.recipesTitle[1]}</em>
      </h2>
      <p className="hw-first-lead">{t.recipesLead}</p>
      <ul className="hw-first-list">
        {t.recipes.map((r, i) => (
          <li key={r.title}>
            <label className="hw-recipe" data-on={picked.has(i) || undefined}>
              <Icon event={RECIPES[i].event} />
              <span className="hw-recipe-main">
                <b>{r.title}</b>
                <span>{r.sub}</span>
              </span>
              <input type="checkbox" checked={picked.has(i)} onChange={e => onPick(i, e.currentTarget.checked)} />
            </label>
          </li>
        ))}
      </ul>
      <p className="hw-first-where">{t.recipesWhere(place)}</p>
      <div className="hw-first-actions">
        <button type="button" className="hw-cta" disabled={picked.size === 0} onClick={onAdd}>
          {t.recipesAdd(picked.size)}
        </button>
        <button type="button" className="hw-link" onClick={onSkip}>
          {t.recipesSkip}
        </button>
      </div>
    </section>
  )
}
