import { eventHint, eventName, UI, type Lang } from '../../lib/i18n'
import { SLOTS, type Agent } from '../../lib/lifecycle'
import { useEffect, useRef, useState } from 'react'

import { IconButton } from '../ui/icon-button'

/** The moments most people use; the picker shows them first. */
const MAIN_EVENTS: ReadonlySet<string> = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'])

/** The other moments people look for most, shown first. */
const COMMON = ['PermissionRequest', 'PostToolUseFailure', 'UserPromptExpansion', 'PreCompact', 'SubagentStop', 'PostModelSwitch', 'StopFailure']
/** Shown before "see all". */
const FIRST = 7

const CloseIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="m4.5 4.5 7 7m0-7-7 7" strokeLinecap="round" />
  </svg>
)

/** The first sentence of a moment's explanation: enough to recognise it. */
const firstSentence = (text: string) => {
  const m = text.match(/^.*?[.。!?](\s|$)/)
  return (m ? m[0] : text).trim()
}

/**
 * "When should it go in?": the moments outside the main ones, to search or pick from. Picking
 * one opens it in the editor. The common ones show first; "see all" lists every one.
 */
export function MomentPicker({
  lang,
  agent,
  unreachable,
  onPick,
  onClose,
}: {
  lang: Lang
  agent: Agent
  unreachable: ReadonlySet<string>
  onPick(event: string): void
  onClose(): void
}) {
  const t = UI[lang]
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const rest = SLOTS[agent].map(s => s.event).filter(e => !MAIN_EVENTS.has(e))
  const common = COMMON.filter(e => rest.includes(e))
  const others = rest.filter(e => !common.includes(e))
  const q = query.trim().toLowerCase()
  const found = q
    ? rest.filter(e => `${eventName(e, lang, agent)} ${eventHint(e, lang, agent)} ${e}`.toLowerCase().includes(q))
    : []

  const row = (event: string) => (
    <li key={event}>
      <button type="button" className="hw-pick-opt" onClick={() => onPick(event)}>
        <b>{eventName(event, lang, agent)}</b>
        <span>
          {firstSentence(eventHint(event, lang, agent))}
          {unreachable.has(event) ? ` · ${t.blockedCard}` : ''}
        </span>
      </button>
    </li>
  )

  return (
    <div
      className="hw-modal hw-pick"
      role="dialog"
      aria-modal="true"
      aria-label={t.pickTitle}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="hw-modal-card hw-pick-card">
        <div className="hw-modal-head">
          <b>{t.pickTitle}</b>
          <IconButton size="sm" variant="ghost" icon={CloseIcon} label={t.close} onClick={onClose} />
        </div>
        <input
          ref={input}
          className="hw-pick-search"
          type="search"
          placeholder={t.pickSearch}
          aria-label={t.pickSearch}
          value={query}
          onChange={e => setQuery(e.currentTarget.value)}
        />
        <div className="hw-pick-body">
          {q ? (
            found.length > 0 ? (
              <ul>{found.map(row)}</ul>
            ) : (
              <p className="hw-pick-none">{t.pickNone}</p>
            )
          ) : (
            <>
              {common.length > 0 && <p className="hw-pick-group">{t.pickCommon}</p>}
              <ul>{(all ? common : common.slice(0, FIRST)).map(row)}</ul>
              {all && others.length > 0 && (
                <>
                  <p className="hw-pick-group">{t.pickRest}</p>
                  <ul>{others.map(row)}</ul>
                </>
              )}
              {!all && rest.length > Math.min(common.length, FIRST) && (
                <button type="button" className="hw-link hw-pick-all" onClick={() => setAll(true)}>
                  {t.pickAll(rest.length)}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
