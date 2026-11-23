import { UI, type Lang } from '../../lib/i18n'
import type { Rule } from '../../lib/understand'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

/** One exchange: what you said, and what hoochi made of it. */
export type Exchange = {
  id: string
  said: string
  state: 'thinking' | 'rule' | 'added' | 'unclear'
  rule?: Rule
  /** the place it goes in, as words */
  place?: string
  /** what hoochi says when it could not make a rule of it */
  say?: string
  /** it was matched from the ready-made rules (Claude Code could not be asked) */
  fallback?: boolean
  /** the item put in, and where, to take it back out */
  itemId?: string
  target?: { scope: 'global' | 'project' | 'terminal'; key: string }
}

/**
 * The first screen: one chat box. You say what you want in your own words; hoochi answers with
 * one rule card (when, what, why) to put in as it is or to adjust in the editor.
 */
export function ChatView({
  lang,
  exchanges,
  where,
  mine,
  momentName,
  ruleWords,
  onSay,
  onAdd,
  onEdit,
  onUndo,
  onPick,
  onSeeMine,
}: {
  lang: Lang
  exchanges: Exchange[]
  /** the chip that picks the AI and the place, drawn by the caller */
  where: ReactNode
  /** how many things are put in, everywhere */
  mine: number
  momentName(event: string): string
  /** what a rule puts in, in a few words ("명령 npm test") */
  ruleWords(rule: Rule): ReactNode
  onSay(text: string): void
  onAdd(x: Exchange): void
  onEdit(x: Exchange): void
  onUndo(x: Exchange): void
  onPick(): void
  onSeeMine(): void
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
        {mine > 0 && (
          <button type="button" className="hw-link hw-chat-mine" onClick={onSeeMine}>
            {t.chatSeeMine(mine)}
          </button>
        )}
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
            {(x.state === 'rule' || x.state === 'added') && x.rule && (
              <div className="hw-chat-hoo">
                {x.state === 'rule' && <p>{t.chatSuggest}</p>}
                <div className="hw-chat-rule" data-added={x.state === 'added' || undefined}>
                  <span className="hw-chat-rule-when">
                    {x.state === 'added' ? `✓ ${t.chatAdded} · ` : ''}
                    {momentName(x.rule.event)} · {x.place}
                  </span>
                  <span className="hw-chat-rule-what">{ruleWords(x.rule)}</span>
                  {x.state === 'rule' && x.rule.why && <span className="hw-chat-rule-why">{x.rule.why}</span>}
                  {x.state === 'rule' && x.fallback && <span className="hw-chat-rule-note">{t.chatFallback}</span>}
                  <div className="hw-chat-rule-acts">
                    {x.state === 'rule' ? (
                      <>
                        <button type="button" className="hw-cta hw-chat-rule-add" onClick={() => onAdd(x)}>
                          {t.chatAdd}
                        </button>
                        <button type="button" className="hw-chat-rule-edit" onClick={() => onEdit(x)}>
                          {t.chatEdit}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="hw-link" onClick={() => onUndo(x)}>
                        {t.undo}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="hw-chat-foot">
        <button type="button" className="hw-link" onClick={onSeeMine}>
          {t.chatSeeMine(mine)}
        </button>
      </div>
      {input}
    </div>
  )
}
