import { useState, type ReactNode } from 'react'

import type { ExistingHook } from '../../lib/backend'
import { targetKey } from '../../lib/edit'
import { UI, type Lang } from '../../lib/i18n'
import { slotOf, type Agent, type Item, type Scope } from '../../lib/lifecycle'
import { byMoment, momentOrder, placeId, placesOf, type Row, type View } from '../../lib/rules-view'
import { isTrouble, type Why } from '../../lib/why'
import { VERDICT, WHY_UI, whyWords, type WhyHelp } from '../../lib/why-words'
import { DropdownMenu } from '../ui/dropdown-menu'
import { Switch } from '../ui/switch'
import { ConfirmDelete } from './confirm-delete'

type Place = { scope: Scope; key: string }

/** A hook set up outside hoochi, with why it runs or does not. */
export type OutsideRow = { agent: Agent; hook: ExistingHook; why: Why }

/**
 * The Lifecycle page: "why doesn't my hook run?" first. On top, the hooks that are stuck or
 * failing, each with its reason; then the picture; then every rule for both AIs at every place,
 * by moment, one row each, with how it is doing; then the hooks set up outside hoochi, with how
 * their last runs ended. Pressing a row opens it with every check it went through.
 * A row switches on and off in place; its menu says it in words, opens the editor, puts it in
 * elsewhere too, or deletes it. Adding is done in words; "Make one yourself" is the one way in.
 */
export function RuleList({
  part,
  onOpenList,
  picture,
  pictureAi,
  onPictureAi,
  lang,
  rows,
  shown,
  view,
  query,
  chat,
  codexWarn,
  outside,
  help,
  momentName,
  placeWords,
  itemWords,
  ago,
  onView,
  onQuery,
  onConnectCodex,
  onToggle,
  onOpen,
  onTalk,
  onEdit,
  onSend,
  onSendAi,
  onDelete,
  onAddHere,
  onMake,
  onToggleExisting,
  onOpenHook,
  onSkills,
}: {
  /** page: what is not working, the picture and the ways in; rules / outside: a list, in a popup */
  part: 'page' | 'rules' | 'outside'
  /** open a list in its popup (the rules ones not working only, when `problems`) */
  onOpenList(which: 'rules' | 'outside', problems?: boolean): void
  /** the lifecycle picture of one AI, and which AI it is */
  picture: ReactNode
  pictureAi: Agent
  onPictureAi(a: Agent): void
  lang: Lang
  /** every row (for the counts and the place chips) and the ones this view shows */
  rows: Row[]
  shown: Row[]
  view: View
  query: string
  /** the chat the window follows, in words, or null when there is none */
  chat: { words: string; in: number; hidden: number; color: string } | null
  /** Codex rules that do not run: Codex not installed, or its hooks not connected */
  codexWarn: { count: number; installed: boolean } | null
  /** hooks set up outside hoochi, with why each runs or does not */
  outside: OutsideRow[]
  /** what the "why" sentences need */
  help: WhyHelp
  momentName(event: string, agent: Agent): string
  placeWords(p: Place): string
  itemWords(item: Item): ReactNode
  ago(ms: number): string
  onView(v: View): void
  onQuery(q: string): void
  onConnectCodex(): void
  onToggle(r: Row, on: boolean): void
  /** set this rule in a popup */
  onOpen(r: Row): void
  onTalk(r: Row): void
  onEdit(r: Row): void
  onSend(r: Row): void
  onSendAi(r: Row): void
  onDelete(r: Row): void
  onAddHere(r: Row): void
  onMake(): void
  onToggleExisting(agent: Agent, hook: ExistingHook, on: boolean): void
  /** an outside hook in a popup, with every check */
  onOpenHook(o: OutsideRow): void
  onSkills(): void
}) {
  const t = UI[lang]
  const w = WHY_UI[lang]
  const verdicts = VERDICT[lang]
  // The row whose delete waits for a second yes.
  const [asking, setAsking] = useState<string | null>(null)
  const set = (p: Partial<View>) => onView({ ...view, ...p })
  const count = (f: (r: Row) => boolean) => rows.filter(f).length
  const inChat = view.mode === 'chat' && chat !== null
  const chip = (label: string, on: boolean, click: () => void, n?: number) => (
    <button key={label} type="button" className="hw-rl-chip" aria-pressed={on} onClick={click}>
      {label}
      {n !== undefined && <i>{n}</i>}
    </button>
  )

  const state = (r: Row) => {
    if (!r.item.enabled) return <span className="hw-rl-tag">{t.tagOff}</span>
    if (r.reach === 'hidden') return <span className="hw-rl-state" data-s="hid">{t.rlHidden}</span>
    if (r.problem) return <span className="hw-rl-state" data-s="bad">✕ {verdicts[r.why.verdict]}</span>
    if (r.why.verdict === 'warn') return <span className="hw-rl-state" data-s="hid">! {verdicts.warn}</span>
    const ran = r.lastRun ? t.rlRan(ago(Date.now() - r.lastRun)) : t.rlNotYet
    if (inChat && r.reach === 'in') return <span className="hw-rl-state" data-s="in">✓ {t.rlIn} · {ran}</span>
    return <span className="hw-rl-state" data-s={r.lastRun ? 'ran' : 'idle'}>{ran}</span>
  }
  /** The reason a row is stuck, failing or worth a look, in a line under it. */
  const reasonLine = (why: Why) =>
    why.reason && why.verdict !== 'off' && why.verdict !== 'waiting' ? (
      <p className="hw-rl-why" data-v={why.verdict}>
        {whyWords(lang, why.reason.check, help)}
      </p>
    ) : null

  const row = (r: Row) => (
    <li key={targetKey(r)} className="hw-rl-row" data-off={!r.item.enabled || undefined} data-hidden={r.reach === 'hidden' || undefined}>
      <div className="hw-rl-main">
        <button type="button" className="hw-rl-open" title={t.rlOpen} onClick={() => onOpen(r)}>
          <span className="hw-rl-what">{itemWords(r.item)}</span>
        </button>
        <div className="hw-rl-meta">
          <span className="hw-rl-ai" data-agent={r.agent}>
            {t.agents[r.agent]}
          </span>
          <span>{placeWords(r)}</span>
          {r.item.kind === 'command' && <span className="hw-rl-tag">{r.item.mode === 'onFail' ? t.tagOnFail : t.rlAlways}</span>}
          {r.item.tools && <span className="hw-rl-tag">{r.item.tools}</span>}
          {r.item.once && <span className="hw-rl-tag">{t.tagOnce}</span>}
          {state(r)}
        </div>
        {r.reach === 'hidden' && r.hiddenBy ? (
          <p className="hw-rl-why">
            {t.rlHiddenWhy(placeWords(r.hiddenBy))}{' '}
            <button type="button" className="hw-link" onClick={() => onAddHere(r)}>
              {t.rlAddThere(placeWords(r.hiddenBy))}
            </button>
          </p>
        ) : (
          reasonLine(r.why)
        )}
        {asking === targetKey(r) && (
          <ConfirmDelete
            lang={lang}
            message={t.askDeleteOne(1)}
            onYes={() => {
              setAsking(null)
              onDelete(r)
            }}
            onNo={() => setAsking(null)}
          />
        )}
      </div>
      <div className="hw-rl-side">
        <Switch size="sm" aria-label={t.mineSwitch(momentName(r.item.event, r.agent))} checked={r.item.enabled} onChange={e => onToggle(r, e.currentTarget.checked)} />
        <DropdownMenu
          align="end"
          aria-label={t.rlMenu}
          items={[
            { label: t.rlOpen, onSelect: () => onOpen(r) },
            { label: t.rlTalk, description: t.rlTalkHint, onSelect: () => onTalk(r) },
            { label: t.rlEdit, onSelect: () => onEdit(r) },
            { label: t.rlSend, onSelect: () => onSend(r) },
            { label: t.rlSendAi(t.agents[r.agent === 'claude' ? 'codex' : 'claude']), onSelect: () => onSendAi(r) },
            { label: t.rlDelete, danger: true, divider: true, onSelect: () => setAsking(targetKey(r)) },
          ]}
          trigger={({ triggerProps, open }) => (
            <button type="button" className="hw-rl-more" data-open={open || undefined} aria-label={t.rlMenu} {...triggerProps}>
              ⋯
            </button>
          )}
        />
      </div>
    </li>
  )

  // Outside hooks, filtered as the list is (by AI, off, not working and the search box).
  const order = momentOrder()
  const q = query.trim().toLowerCase()
  const outsideShown = outside
    .filter(o => !q || `${o.hook.origin?.name ?? ''} ${o.hook.name} ${momentName(o.hook.event, o.agent)} ${o.hook.body ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => order.indexOf(a.hook.event) - order.indexOf(b.hook.event))
  const ruleTrouble = rows.filter(r => r.problem).length
  const outsideTrouble = outside.filter(o => !o.hook.off && isTrouble(o.why)).length

  // What is stuck or failing, rules first: the answer to "why doesn't my hook run?".
  const trouble = [
    ...rows.filter(r => r.problem).map(r => ({ key: `r-${targetKey(r)}`, agent: r.agent, what: itemWords(r.item), event: r.item.event, why: r.why, open: () => onOpen(r) })),
    ...outside
      .filter(o => !o.hook.off && isTrouble(o.why))
      .map(o => ({ key: `h-${o.agent}-${o.hook.id}`, agent: o.agent, what: o.hook.origin?.name ?? o.hook.name, event: o.hook.event, why: o.why, open: () => onOpenHook(o) })),
  ]
  // Failing first, then what stops a rule, then a narrower place hiding it (often meant that way).
  const rank = (why: Why) => (why.verdict === 'failing' ? 0 : why.reason?.check.key === 'hidden' ? 2 : 1)
  trouble.sort((a, b) => rank(a.why) - rank(b.why))
  const TROUBLE_SHOWN = 4

  const outsideRow = (o: OutsideRow) => {
    const { agent, hook, why } = o
    const ran = why.steps.find(s => s.check.key === 'ran' || s.check.key === 'blocked-on-purpose')
    return (
      <li key={`${agent}-${hook.id}`} className="hw-rl-row" data-off={hook.off || undefined}>
        <div className="hw-rl-main">
          <button type="button" className="hw-rl-open" title={w.checks} onClick={() => onOpenHook(o)}>
            <span className="hw-rl-what">{hook.origin?.name ?? hook.name}</span>
          </button>
          <div className="hw-rl-meta">
            <span className="hw-rl-ai" data-agent={agent}>
              {t.agents[agent]}
            </span>
            <span>{momentName(hook.event, agent)}</span>
            {hook.matcher && <span className="hw-rl-tag">{hook.matcher}</span>}
            <span className="hw-rl-tag">{t.existingFrom(hook.from)}</span>
            {hook.off ? (
              <span className="hw-rl-tag">{t.tagOff}</span>
            ) : isTrouble(why) ? (
              <span className="hw-rl-state" data-s="bad">
                ✕ {verdicts[why.verdict]}
              </span>
            ) : why.verdict === 'warn' ? (
              <span className="hw-rl-state" data-s="hid">
                ! {verdicts.warn}
              </span>
            ) : ran && 'run' in ran.check ? (
              <span className="hw-rl-state" data-s="ran">
                {t.rlRan(ago(Date.now() - ran.check.run.at))}
              </span>
            ) : null}
          </div>
          {!hook.off && reasonLine(why)}
        </div>
        <div className="hw-rl-side">
          <Switch size="sm" aria-label={t.existingSwitch(hook.name)} checked={!hook.off} onChange={e => onToggleExisting(agent, hook, e.currentTarget.checked)} />
        </div>
      </li>
    )
  }

  if (part === 'rules')
    return (
      <section className="hw-rl hw-rl-in-popup" aria-label={t.rlListTitle}>
      <div className="hw-rl-list-head">
        {chat && (
          <div className="hw-rl-seg" role="group" aria-label={t.rlModeLabel}>
            <button type="button" aria-pressed={view.mode === 'all'} onClick={() => set({ mode: 'all' })}>
              {t.rlModeAll}
            </button>
            <button type="button" aria-pressed={view.mode === 'chat'} onClick={() => set({ mode: 'chat' })}>
              {t.rlModeChat}
            </button>
          </div>
        )}
      </div>
      <input
        className="hw-pick-search hw-rl-search"
        type="search"
        placeholder={t.mineSearch}
        aria-label={t.mineSearch}
        value={query}
        onChange={e => onQuery(e.currentTarget.value)}
      />
      <div className="hw-rl-chips">
        {chip(t.rlAllAi, view.ai === 'all', () => set({ ai: 'all' }))}
        {(['claude', 'codex'] as const).map(a => chip(t.agents[a], view.ai === a, () => set({ ai: view.ai === a ? 'all' : a }), count(r => r.agent === a)))}
        <span className="hw-rl-chips-gap" aria-hidden="true" />
        {placesOf(rows).map(p => chip(placeWords(p), view.place === placeId(p), () => set({ place: view.place === placeId(p) ? '' : placeId(p) })))}
        <span className="hw-rl-chips-gap" aria-hidden="true" />
        {chip(t.rlOffOnly, view.off, () => set({ off: !view.off }), count(r => !r.item.enabled))}
        {chip(t.rlProblems, view.problems, () => set({ problems: !view.problems }), trouble.length)}
      </div>

      {codexWarn && (
        <div className="hw-rl-warn" role="status">
          <p>{codexWarn.installed ? t.rlCodexWarn(codexWarn.count) : t.rlCodexMissing(codexWarn.count)}</p>
          {codexWarn.installed && (
            <button type="button" className="hw-rl-warn-btn" onClick={onConnectCodex}>
              {t.codexConnect}
            </button>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="hw-rl-empty">{rows.length === 0 ? t.rlNone : inChat && !query && !view.off && !view.problems ? t.rlNoneHere : t.rlNoMatch}</p>
      ) : (
        byMoment(shown).map(([event, rs]) => {
          const codexOnly = !slotOf(event, 'claude')
          return (
            <section key={event} className="hw-rl-moment">
              <h3>
                {momentName(event, rs[0].agent)} <small>{rs.length}</small>
                {codexOnly && <em>{t.rlCodexOnly}</em>}
              </h3>
              <ul className="hw-rl-rows">{rs.map(row)}</ul>
            </section>
          )
        })
      )}

      <button type="button" className="hw-link hw-rl-make" onClick={onMake}>
        + {t.rlMake}
      </button>

      </section>
    )
  if (part === 'outside')
    return (
      <section className="hw-rl hw-rl-in-popup" aria-label={w.outside}>
      <p className="hw-rl-sub">{w.outsideHint}</p>
      {outsideShown.length === 0 ? (
        <p className="hw-rl-empty">{outside.length === 0 ? w.outsideNone : t.rlNoMatch}</p>
      ) : (
        <ul className="hw-rl-rows hw-rl-outside">{outsideShown.map(outsideRow)}</ul>
      )}

      </section>
    )

  const entry = (title: string, n: number, bad: number, open: () => void) => (
    <button type="button" onClick={open}>
      {title} <small>{n}</small>
      {bad > 0 && <em className="hw-rl-bad">✕ {bad}</em>}
    </button>
  )
  return (
    <section className="hw-rl" aria-label={t.tabMine}>
      <div className="hw-rl-now" data-trouble={trouble.length > 0 || undefined}>
        {chat && (
          <p className="hw-rl-now-chat">
            <span className="hw-now-dot" style={{ background: chat.color }} aria-hidden="true" />
            <span>
              <b>{chat.words}</b>
              <small>{t.rlNowCount(chat.in, chat.hidden)}</small>
            </span>
          </p>
        )}
        <div className="hw-rl-trouble">
          <h3>
            {trouble.length > 0 ? (
              <>
                <i aria-hidden="true">✕</i> {w.trouble(trouble.length)}
              </>
            ) : (
              <>
                <i aria-hidden="true">✓</i> {w.troubleNone}
              </>
            )}
          </h3>
          {trouble.length > 0 && (
            <>
              <p>{w.troubleHint}</p>
              <ul>
                {trouble.slice(0, TROUBLE_SHOWN).map(x => (
                  <li key={x.key}>
                    <button type="button" onClick={x.open}>
                      <span className="hw-rl-trouble-what">
                        <span className="hw-rl-ai" data-agent={x.agent} aria-label={t.agents[x.agent]} />
                        <b>{x.what}</b>
                        <small>{momentName(x.event, x.agent)}</small>
                      </span>
                      {x.why.reason && <span className="hw-rl-trouble-why">{whyWords(lang, x.why.reason.check, help)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {trouble.length > TROUBLE_SHOWN && (
                <button type="button" className="hw-link" onClick={() => onOpenList(ruleTrouble > 0 ? 'rules' : 'outside', true)}>
                  {w.troubleMore(trouble.length - TROUBLE_SHOWN)}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="hw-rl-fold hw-rl-ways">
        {entry(t.rlListTitle, rows.length, ruleTrouble, () => onOpenList('rules'))}
        {entry(w.outside, outside.length, outsideTrouble, () => onOpenList('outside'))}
        <button type="button" onClick={onSkills}>
          {t.rlSkills} <small>{t.rlSkillsHint}</small>
        </button>
      </div>

      <div className="hw-rl-picture">
        <div className="hw-rl-picture-head">
          <p className="hw-diagram-hint">{t.diagramHint}</p>
          <div className="hw-rl-seg" role="group" aria-label={t.rowAgent}>
            {(['claude', 'codex'] as const).map(a => (
              <button key={a} type="button" aria-pressed={pictureAi === a} onClick={() => onPictureAi(a)}>
                {t.agents[a]}
              </button>
            ))}
          </div>
        </div>
        {picture}
        <p className="hw-rl-legend">{t.legend}</p>
      </div>

    </section>
  )
}
