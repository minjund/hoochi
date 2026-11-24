import type { ReactNode } from 'react'

import type { ExistingHook } from '../../lib/backend'
import { targetKey } from '../../lib/edit'
import { UI, type Lang } from '../../lib/i18n'
import { slotOf, type Agent, type Item, type Scope } from '../../lib/lifecycle'
import { byMoment, placeId, placesOf, type Row, type View } from '../../lib/rules-view'
import { DropdownMenu } from '../ui/dropdown-menu'
import { Switch } from '../ui/switch'

type Place = { scope: Scope; key: string }

/**
 * "What you put in": every rule for both AIs at every place, by moment, one row each. Seen from
 * the chat you are in, each row says whether it goes in there, what hides it, or what is wrong.
 * A row switches on and off in place; its menu says it in words, opens the editor, puts it in
 * elsewhere too, or deletes it. Adding is done in words; "Make one yourself" is the one way in.
 */
export function RuleList({
  lang,
  rows,
  shown,
  view,
  query,
  chat,
  codexWarn,
  existing,
  context,
  momentName,
  placeWords,
  itemWords,
  ago,
  onView,
  onQuery,
  onConnectCodex,
  onToggle,
  onTalk,
  onEdit,
  onSend,
  onSendAi,
  onDelete,
  onAddHere,
  onMake,
  onToggleExisting,
  onFlow,
  onSkills,
}: {
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
  /** hooks set up outside hoochi */
  existing: { agent: Agent; hook: ExistingHook }[]
  /** the context window at a glance, when a Claude Code chat has one */
  context: ReactNode
  momentName(event: string, agent: Agent): string
  placeWords(p: Place): string
  itemWords(item: Item): ReactNode
  ago(ms: number): string
  onView(v: View): void
  onQuery(q: string): void
  onConnectCodex(): void
  onToggle(r: Row, on: boolean): void
  onTalk(r: Row): void
  onEdit(r: Row): void
  onSend(r: Row): void
  onSendAi(r: Row): void
  onDelete(r: Row): void
  onAddHere(r: Row): void
  onMake(): void
  onToggleExisting(agent: Agent, hook: ExistingHook, on: boolean): void
  onFlow(): void
  onSkills(): void
}) {
  const t = UI[lang]
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
    if (r.problem === 'codex-off') return <span className="hw-rl-state" data-s="idle">{t.rlCodexOff}</span>
    if (r.problem === 'blocked') return <span className="hw-rl-state" data-s="hid">{t.rlBlocked}</span>
    if (!r.item.enabled) return <span className="hw-rl-tag">{t.tagOff}</span>
    if (inChat && r.reach === 'hidden') return <span className="hw-rl-state" data-s="hid">{t.rlHidden}</span>
    const ran = r.lastRun ? t.rlRan(ago(Date.now() - r.lastRun)) : t.rlNotYet
    if (inChat && r.reach === 'in') return <span className="hw-rl-state" data-s="in">✓ {t.rlIn} · {ran}</span>
    return <span className="hw-rl-state" data-s={r.lastRun ? 'ran' : 'idle'}>{ran}</span>
  }

  const row = (r: Row) => (
    <li key={targetKey(r)} className="hw-rl-row" data-off={!r.item.enabled || undefined} data-hidden={(inChat && r.reach === 'hidden') || undefined}>
      <div className="hw-rl-main">
        <div className="hw-rl-what">{itemWords(r.item)}</div>
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
        {inChat && r.reach === 'hidden' && r.hiddenBy && (
          <p className="hw-rl-why">
            {t.rlHiddenWhy(placeWords(r.hiddenBy))}{' '}
            <button type="button" className="hw-link" onClick={() => onAddHere(r)}>
              {t.rlAddThere(placeWords(r.hiddenBy))}
            </button>
          </p>
        )}
      </div>
      <div className="hw-rl-side">
        <Switch size="sm" aria-label={t.mineSwitch(momentName(r.item.event, r.agent))} checked={r.item.enabled} onChange={e => onToggle(r, e.currentTarget.checked)} />
        <DropdownMenu
          align="end"
          aria-label={t.rlMenu}
          items={[
            { label: t.rlTalk, description: t.rlTalkHint, onSelect: () => onTalk(r) },
            { label: t.rlEdit, onSelect: () => onEdit(r) },
            { label: t.rlSend, onSelect: () => onSend(r) },
            { label: t.rlSendAi(t.agents[r.agent === 'claude' ? 'codex' : 'claude']), onSelect: () => onSendAi(r) },
            { label: t.rlDelete, danger: true, divider: true, onSelect: () => onDelete(r) },
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

  return (
    <section className="hw-rl" aria-label={t.tabMine}>
      {chat && (
        <div className="hw-rl-now">
          <span className="hw-now-dot" style={{ background: chat.color }} aria-hidden="true" />
          <p>
            <b>{chat.words}</b>
            <small>{t.rlNowCount(chat.in, chat.hidden)}</small>
          </p>
          <div className="hw-rl-seg" role="group" aria-label={t.rlModeLabel}>
            <button type="button" aria-pressed={view.mode === 'chat'} onClick={() => set({ mode: 'chat' })}>
              {t.rlModeChat}
            </button>
            <button type="button" aria-pressed={view.mode === 'all'} onClick={() => set({ mode: 'all' })}>
              {t.rlModeAll}
            </button>
          </div>
        </div>
      )}

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
        {chip(t.rlProblems, view.problems, () => set({ problems: !view.problems }), count(r => r.problem !== undefined))}
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

      <h4 className="hw-rl-label">{t.rlMore}</h4>
      <div className="hw-rl-fold">
        <details>
          <summary>
            {t.rlExisting} <small>{t.rlExistingHint(existing.length)}</small>
          </summary>
          {existing.length === 0 ? (
            <p className="hw-rl-empty">{t.rlExistingNone}</p>
          ) : (
            <ul className="hw-rl-rows hw-rl-existing">
              {existing.map(({ agent, hook }) => (
                <li key={`${agent}-${hook.id}`} className="hw-rl-row" data-off={hook.off || undefined}>
                  <div className="hw-rl-main">
                    <div className="hw-rl-what">{hook.origin?.name ?? hook.name}</div>
                    <div className="hw-rl-meta">
                      <span className="hw-rl-ai" data-agent={agent}>
                        {t.agents[agent]}
                      </span>
                      <span>{momentName(hook.event, agent)}</span>
                      <span className="hw-rl-tag">{t.existingFrom(hook.from)}</span>
                    </div>
                  </div>
                  <div className="hw-rl-side">
                    <Switch size="sm" aria-label={t.existingSwitch(hook.name)} checked={!hook.off} onChange={e => onToggleExisting(agent, hook, e.currentTarget.checked)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </details>
        <button type="button" onClick={onFlow}>
          {t.flowView} <small>{t.rlFlowHint}</small>
        </button>
        <button type="button" onClick={onSkills}>
          {t.rlSkills} <small>{t.rlSkillsHint}</small>
        </button>
        <details>
          <summary>
            {t.ctxTitle} <small>{context ? '' : t.rlContextNone}</small>
          </summary>
          {context && <div className="hw-rl-context">{context}</div>}
        </details>
      </div>
    </section>
  )
}
