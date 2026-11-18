import { useState } from 'react'

import type { ContextRow, ContextSnapshot } from '../../lib/backend'
import type { UiText } from '../../lib/i18n'

/** Colors for the breakdown, in /context's order; readable on light and dark. */
const COLORS = ['#7b8794', '#5b8def', '#2fa5b8', '#e0a030', '#9b6ad8', '#d0607a', '#3fa34d', '#c27c3a']

/** 61400 → "61.4k", 1000000 → "1M" */
function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

function loadOpen(): boolean {
  try {
    return localStorage.getItem('hookwich.contextOpen') === '1'
  } catch {
    return false
  }
}

function saveOpen(open: boolean) {
  try {
    localStorage.setItem('hookwich.contextOpen', open ? '1' : '0')
  } catch {
    // no storage: it opens closed next time
  }
}

/** What /context shows for the terminal in view, redrawn as the chat works. */
export function ContextMeter({ snap, t, now }: { snap: ContextSnapshot | null; t: UiText; now: number }) {
  const [open, setOpen] = useState(loadOpen)
  if (!snap) {
    return (
      <section className="hw-ctx" aria-label={t.ctxTitle}>
        <div className="hw-ctx-head">
          <span>{t.ctxTitle}</span>
        </div>
        <p className="hw-editor-hint">{t.ctxWaiting}</p>
      </section>
    )
  }
  const max = Math.max(snap.max, 1)
  const used = snap.rows.filter(r => r.kind === 'used')
  const colorOf = (r: ContextRow) =>
    r.kind === 'free' ? 'var(--hw-line-strong)' : r.kind === 'buffer' ? 'var(--hw-soft)' : COLORS[used.indexOf(r) % COLORS.length]
  const name = (r: ContextRow) => t.ctxRows[r.name] ?? r.name
  const near = snap.compactAt !== undefined && snap.used >= snap.compactAt * 0.9
  const toggle = () => {
    setOpen(!open)
    saveOpen(!open)
  }

  return (
    <section className="hw-ctx" aria-label={t.ctxTitle} data-near={near || undefined}>
      <button type="button" className="hw-ctx-head" aria-expanded={open} title={t.ctxAria} onClick={toggle}>
        <span>{t.ctxTitle}</span>
        <b>
          {tokens(snap.used)} / {tokens(snap.max)} · {snap.percent}%
        </b>
        <span className="hw-ctx-ago">{t.ago(Math.max(0, now - snap.at))}</span>
        <span className="hw-ctx-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      <div
        className="hw-ctx-bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={snap.max}
        aria-valuenow={snap.used}
        aria-valuetext={`${snap.percent}%`}
      >
        {used.map(r => (
          <span
            key={r.name}
            style={{ width: `${(r.tokens / max) * 100}%`, background: colorOf(r) }}
            title={`${name(r)} · ${tokens(r.tokens)}`}
          />
        ))}
        {snap.compactAt !== undefined && (
          <i className="hw-ctx-mark" style={{ left: `${Math.min(100, (snap.compactAt / max) * 100)}%` }} />
        )}
      </div>
      {near && <p className="hw-ctx-near">{t.ctxNear}</p>}
      {open && (
        <div className="hw-ctx-more">
          <ul className="hw-ctx-rows">
            {snap.rows.map(r => (
              <li key={r.name} data-kind={r.kind}>
                <span className="hw-ctx-dot" style={{ background: colorOf(r) }} aria-hidden="true" />
                <span className="hw-ctx-name">{name(r)}</span>
                <span className="hw-ctx-num">
                  {r.kind === 'deferred'
                    ? tokens(r.tokens)
                    : `${tokens(r.tokens)} · ${((r.tokens / max) * 100).toFixed(1)}%`}
                </span>
              </li>
            ))}
          </ul>
          {snap.compactAt !== undefined && <p className="hw-editor-hint">{t.ctxCompact(tokens(snap.compactAt))}</p>}
          {snap.memory.length > 0 && (
            <details>
              <summary>
                {t.ctxMemory} · {snap.memory.length}
              </summary>
              <ul className="hw-ctx-rows">
                {snap.memory.map(m => (
                  <li key={m.path}>
                    <span className="hw-ctx-name" title={m.path}>
                      {m.path.replace(/^\/Users\/[^/]+/, '~')}
                    </span>
                    <span className="hw-ctx-num">{tokens(m.tokens)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {snap.mcp.length > 0 && (
            <details>
              <summary>
                {t.ctxMcp} · {snap.mcp.length}
              </summary>
              <ul className="hw-ctx-rows">
                {snap.mcp.map(m => (
                  <li key={m.server}>
                    <span className="hw-ctx-name">
                      {m.server} · {t.ctxTools(m.tools)}
                    </span>
                    <span className="hw-ctx-num">{tokens(m.tokens)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {snap.skills && (
            <p className="hw-editor-hint">
              {t.ctxSkills(snap.skills.count)} · {tokens(snap.skills.tokens)}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
