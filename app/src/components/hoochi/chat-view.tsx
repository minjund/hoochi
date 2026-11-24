import { UI, type Lang } from '../../lib/i18n'
import { targetKey, type Edit } from '../../lib/edit'
import type { Agent, Item, Scope } from '../../lib/lifecycle'
import type { Known, PlaceOpt, Rule } from '../../lib/understand'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

/** One exchange: what you said, and what hoochi made of it. */
export type Exchange = {
  id: string
  said: string
  state: 'thinking' | 'rule' | 'edit' | 'find' | 'unclear'
  rule?: Rule
  /** the place the sentence named for a new rule, if any */
  at?: PlaceOpt
  /** a change to the rules already put in, and whether it is done (it can be taken back) */
  edit?: Edit
  done?: boolean
  /** rules found, and what was done to each one from the list (by `targetKey`), to take it back */
  found?: Known[]
  rows?: Record<string, Edit>
  /** the place it goes in, as words */
  place?: string
  /** what hoochi says when it could not make a rule of it */
  say?: string
  /** it was matched from the ready-made rules or by words (Claude Code could not be asked) */
  fallback?: boolean
  /** for each AI it was put in for: the item, and where (as words too), to take it back out */
  added?: Partial<Record<Agent, Added>>
}

export type Added = { itemId: string; target: { scope: 'global' | 'project' | 'terminal'; key: string }; place: string }

/** Each AI gets its own button: a rule goes in for Claude Code, Codex, or both. */
const AGENTS: readonly Agent[] = ['claude', 'codex']

/**
 * The first screen: one chat box. You say what you want in your own words; hoochi answers with
 * one rule card (when, what, why) to put in as it is or to adjust in the editor.
 */
export function ChatView({
  lang,
  exchanges,
  where,
  momentName,
  ruleWords,
  itemWords,
  whereOf,
  cannot,
  onSay,
  onApply,
  onRevert,
  onRow,
  onRowUndo,
  onRowOpen,
  onAdd,
  onEdit,
  onUndo,
  onPick,
}: {
  lang: Lang
  exchanges: Exchange[]
  /** the chip that picks the AI and the place, drawn by the caller */
  where: ReactNode
  momentName(event: string): string
  /** what a rule puts in, in a few words ("명령 npm test") */
  ruleWords(rule: Rule): ReactNode
  /** what an item already put in puts in, in a few words */
  itemWords(item: Item): ReactNode
  /** which AI, which place, which moment, in words */
  whereOf(at: { agent: Agent; scope: Scope; key: string }, event: string): string
  /** why this rule cannot go in for that AI, or "" when it can */
  cannot(rule: Rule, agent: Agent): string
  onSay(text: string): void
  onAdd(x: Exchange, agent: Agent): void
  onEdit(x: Exchange): void
  onUndo(x: Exchange, agent: Agent): void
  /** do what an edit card says, and take it back */
  onApply(x: Exchange): void
  onRevert(x: Exchange): void
  /** on a list of rules found: switch one off or on, delete it, take that back, or open it */
  onRow(x: Exchange, k: Known, action: 'off' | 'on' | 'delete'): void
  onRowUndo(x: Exchange, k: Known): void
  onRowOpen(k: Known): void
  onPick(): void
}) {
  const t = UI[lang]
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const busy = exchanges.some(x => x.state === 'thinking')
  useEffect(() => {
    box.current?.focus()
  }, [])
  // Braces, not an arrow's value: scrollIntoView returns a Promise in newer browsers, and an effect
  // must return nothing or a function.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [exchanges])

  const send = (said = text) => {
    const s = said.trim()
    if (!s || busy) return
    onSay(s)
    setText('')
  }
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }
  const input = (
    <div className="hw-chat-box">
      <textarea
        ref={box}
        rows={exchanges.length ? 1 : 2}
        value={text}
        placeholder={exchanges.length ? t.chatPlaceholderMore : t.chatPlaceholder}
        aria-label={t.chatPlaceholder}
        onChange={e => setText(e.currentTarget.value)}
        onKeyDown={onKey}
      />
      <div className="hw-chat-box-row">
        {where}
        <button
          type="button"
          className="hw-chat-send"
          aria-label={t.chatSend}
          disabled={!text.trim() || busy}
          onClick={() => send()}
        >
          ↑
        </button>
      </div>
    </div>
  )

  if (exchanges.length === 0) {
    return (
      <div className="hw-chat hw-chat-empty">
        <h2>
          {t.chatHello[0]}
          <br />
          <em>{t.chatHello[1]}</em>
        </h2>
        <p className="hw-chat-sub">{t.chatSub}</p>
        {input}
        <div className="hw-chat-examples">
          {t.chatExamples.map(ex => (
            <button key={ex} type="button" onClick={() => send(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="hw-chat">
      <div className="hw-chat-log" aria-live="polite">
        {exchanges.map(x => (
          <div key={x.id} className="hw-chat-turn">
            <p className="hw-chat-me">{x.said}</p>
            {x.state === 'thinking' && <p className="hw-chat-thinking">{t.chatThinking}</p>}
            {x.state === 'unclear' && (
              <div className="hw-chat-hoo">
                <p>{x.say || t.chatNotUnderstood}</p>
                <button type="button" className="hw-link" onClick={onPick}>
                  {t.chatPickMoment}
                </button>
              </div>
            )}
            {x.state === 'edit' && x.edit && (
              <EditCard lang={lang} x={x} edit={x.edit} itemWords={itemWords} whereOf={whereOf} onApply={onApply} onRevert={onRevert} />
            )}
            {x.state === 'find' && x.found && (
              <FindCard
                lang={lang}
                x={x}
                found={x.found}
                itemWords={itemWords}
                whereOf={whereOf}
                onRow={onRow}
                onRowUndo={onRowUndo}
                onRowOpen={onRowOpen}
              />
            )}
            {x.state === 'rule' && x.rule && (
              <RuleCard
                lang={lang}
                x={x}
                rule={x.rule}
                momentName={momentName}
                ruleWords={ruleWords}
                cannot={cannot}
                onAdd={onAdd}
                onEdit={onEdit}
                onUndo={onUndo}
              />
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      {input}
    </div>
  )
}

/** One rule: when, what, why, then one button per AI to put it in, and one to adjust it. */
function RuleCard({
  lang,
  x,
  rule,
  momentName,
  ruleWords,
  cannot,
  onAdd,
  onEdit,
  onUndo,
}: {
  lang: Lang
  x: Exchange
  rule: Rule
  momentName(event: string): string
  ruleWords(rule: Rule): ReactNode
  cannot(rule: Rule, agent: Agent): string
  onAdd(x: Exchange, agent: Agent): void
  onEdit(x: Exchange): void
  onUndo(x: Exchange, agent: Agent): void
}) {
  const t = UI[lang]
  const added = AGENTS.filter(a => x.added?.[a])
  const notes = AGENTS.filter(a => !x.added?.[a]).flatMap(a => {
    const why = cannot(rule, a)
    return why ? [why] : []
  })
  return (
    <div className="hw-chat-hoo">
      {added.length === 0 && <p>{t.chatSuggest}</p>}
      <div className="hw-chat-rule" data-added={added.length > 0 || undefined}>
        <span className="hw-chat-rule-when">
          {momentName(rule.event)} · {x.place}
        </span>
        <span className="hw-chat-rule-what">{ruleWords(rule)}</span>
        {added.length === 0 && rule.why && <span className="hw-chat-rule-why">{rule.why}</span>}
        {added.length === 0 && x.fallback && <span className="hw-chat-rule-note">{t.chatFallback}</span>}
        {added.map(a => (
          <span key={a} className="hw-chat-rule-done" data-agent={a}>
            ✓ {t.chatAddedTo(t.agents[a], x.added![a]!.place)}
            <button type="button" className="hw-link" onClick={() => onUndo(x, a)}>
              {t.undo}
            </button>
          </span>
        ))}
        <div className="hw-chat-rule-acts">
          {AGENTS.filter(a => !x.added?.[a]).map(a => (
            <button
              key={a}
              type="button"
              className="hw-cta hw-chat-rule-add"
              data-agent={a}
              disabled={cannot(rule, a) !== ''}
              onClick={() => onAdd(x, a)}
            >
              {t.chatAddTo(t.agents[a])}
            </button>
          ))}
          {added.length === 0 && (
            <button type="button" className="hw-chat-rule-edit" onClick={() => onEdit(x)}>
              {t.chatEdit}
            </button>
          )}
        </div>
        {notes.map(n => (
          <span key={n} className="hw-chat-rule-note">
            {n}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * A change to the rules already put in: what it touches (before and after, for a change), then one
 * button that does it; once done, it can be taken back.
 */
function EditCard({
  lang,
  x,
  edit,
  itemWords,
  whereOf,
  onApply,
  onRevert,
}: {
  lang: Lang
  x: Exchange
  edit: Edit
  itemWords(item: Item): ReactNode
  whereOf(at: { agent: Agent; scope: Scope; key: string }, event: string): string
  onApply(x: Exchange): void
  onRevert(x: Exchange): void
}) {
  const t = UI[lang]
  const n = edit.action === 'change' ? edit.changes.length : edit.action === 'copy' ? edit.copies.length : edit.targets.length
  const row = (key: string, where: string, item: Item, mark?: 'before' | 'gone' | 'off') => (
    <li key={key} className="hw-chat-edit-row" data-mark={mark}>
      <span className="hw-chat-rule-when">{where}</span>
      <span className="hw-chat-rule-what">{itemWords(item)}</span>
    </li>
  )
  const rows =
    edit.action === 'change'
      ? edit.changes.map(c => (
          <li key={targetKey(c.target)} className="hw-chat-edit-change">
            <ul className="hw-chat-edit-list">
              {row('before', whereOf(c.target, c.target.item.event), c.target.item, 'before')}
              <li className="hw-chat-edit-arrow" aria-hidden="true">
                ↓
              </li>
              {row('after', whereOf(c.to, c.item.event), c.item)}
            </ul>
          </li>
        ))
      : edit.action === 'copy'
        ? edit.copies.map(c => row(c.item.id, whereOf(c.to, c.item.event), c.item))
        : edit.targets.map(k =>
            row(
              `${k.agent}-${k.scope}-${k.key}-${k.item.id}`,
              whereOf(k, k.item.event),
              x.done && edit.action !== 'delete' ? { ...k.item, enabled: edit.action === 'on' } : k.item,
              x.done && edit.action === 'delete' ? 'gone' : undefined,
            ),
          )
  return (
    <div className="hw-chat-hoo">
      {!x.done && <p>{t.chatEditSay[edit.action](n)}</p>}
      <div className="hw-chat-rule hw-chat-edit" data-action={edit.action} data-added={x.done || undefined}>
        <ul className="hw-chat-edit-list">{rows}</ul>
        {!x.done && x.fallback && <span className="hw-chat-rule-note">{t.chatEditFallback}</span>}
        {x.done ? (
          <span className="hw-chat-rule-done">
            ✓ {t.chatEditDone[edit.action](n)}
            <button type="button" className="hw-link" onClick={() => onRevert(x)}>
              {t.undo}
            </button>
          </span>
        ) : (
          <div className="hw-chat-rule-acts">
            <button
              type="button"
              className="hw-cta hw-chat-rule-add"
              data-danger={edit.action === 'delete' || undefined}
              onClick={() => onApply(x)}
            >
              {t.chatEditDo[edit.action](n)}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Rules found: each with what it is and where, and buttons to switch it off or on, delete it, or
 * open it in the editor. A press acts at once, and the row says what it did with a way back. The
 * next sentence can act on all of them ("turn these off").
 */
function FindCard({
  lang,
  x,
  found,
  itemWords,
  whereOf,
  onRow,
  onRowUndo,
  onRowOpen,
}: {
  lang: Lang
  x: Exchange
  found: Known[]
  itemWords(item: Item): ReactNode
  whereOf(at: { agent: Agent; scope: Scope; key: string }, event: string): string
  onRow(x: Exchange, k: Known, action: 'off' | 'on' | 'delete'): void
  onRowUndo(x: Exchange, k: Known): void
  onRowOpen(k: Known): void
}) {
  const t = UI[lang]
  return (
    <div className="hw-chat-hoo">
      <p>{t.chatFound(found.length)}</p>
      <div className="hw-chat-rule hw-chat-find">
        <ul className="hw-chat-edit-list">
          {found.map(k => {
            const done = x.rows?.[targetKey(k)]
            const item = done && done.action !== 'delete' ? { ...k.item, enabled: done.action === 'on' } : k.item
            return (
              <li key={targetKey(k)} className="hw-chat-edit-row" data-mark={done?.action === 'delete' ? 'gone' : undefined}>
                <span className="hw-chat-rule-when">{whereOf(k, k.item.event)}</span>
                <span className="hw-chat-rule-what">{itemWords(item)}</span>
                <div className="hw-chat-find-acts">
                  {done ? (
                    <span className="hw-chat-rule-done">
                      ✓ {t.chatEditDone[done.action](1)}
                      <button type="button" className="hw-link" onClick={() => onRowUndo(x, k)}>
                        {t.undo}
                      </button>
                    </span>
                  ) : (
                    <>
                      <button type="button" className="hw-chat-find-btn" onClick={() => onRow(x, k, k.item.enabled ? 'off' : 'on')}>
                        {t.chatEditDo[k.item.enabled ? 'off' : 'on'](1)}
                      </button>
                      <button type="button" className="hw-chat-find-btn" onClick={() => onRowOpen(k)}>
                        {t.chatEdit}
                      </button>
                      <button type="button" className="hw-chat-find-btn" data-danger onClick={() => onRow(x, k, 'delete')}>
                        {t.chatEditDo.delete(1)}
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {x.fallback && <span className="hw-chat-rule-note">{t.chatEditFallback}</span>}
        <span className="hw-chat-rule-note">{t.chatFoundNext}</span>
      </div>
    </div>
  )
}
