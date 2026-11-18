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

const OPEN_KEY = 'hookwich.contextOpen'
const PICK_KEY = 'hookwich.contextPick'

function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function keep(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // no storage: it starts as it was next time
  }
}

/** Where a row's own list comes from, by the name /context gives it. */
type Detail = 'mcp' | 'memory' | 'skills' | 'agents' | 'compact' | undefined
const detailOf = (r: ContextRow): Detail =>
  r.name === 'MCP tools'
    ? 'mcp'
    : r.name === 'Memory files'
      ? 'memory'
      : r.name === 'Skills'
        ? 'skills'
        : r.name === 'Custom agents'
          ? 'agents'
          : r.kind === 'free' || r.kind === 'buffer'
            ? 'compact'
            : undefined

/** What /context shows for the terminal in view, redrawn as the chat works: a bar, then a button per part. */
export function ContextMeter({ snap, t, now }: { snap: ContextSnapshot | null; t: UiText; now: number }) {
  const [open, setOpen] = useState(() => load(OPEN_KEY) !== '0')
  const [pick, setPick] = useState(() => load(PICK_KEY) ?? '')
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
    r.kind === 'free'
      ? 'var(--hw-line-strong)'
      : r.kind === 'buffer'
        ? 'var(--hw-soft)'
        : r.kind === 'deferred'
          ? 'transparent'
          : COLORS[used.indexOf(r) % COLORS.length]
  const name = (r: ContextRow) => t.ctxRows[r.name] ?? r.name
  const share = (r: ContextRow) => `${((r.tokens / max) * 100).toFixed(1)}%`
  const near = snap.compactAt !== undefined && snap.used >= snap.compactAt * 0.9
  // Used parts first, as /context lists them, then the room left, then what waits outside.
  const rank = { used: 0, free: 1, buffer: 2, deferred: 3 } as const
  const rows = [...snap.rows].sort((a, b) => rank[a.kind] - rank[b.kind])
  const picked = rows.find(r => r.name === pick)
  const choose = (r: ContextRow) => {
    const next = r.name === pick ? '' : r.name
    setPick(next)
    keep(PICK_KEY, next)
  }
  const toggle = () => {
    setOpen(!open)
    keep(OPEN_KEY, open ? '0' : '1')
  }
  const list = (items: { key: string; label: string; title?: string; tokens: number }[]) => (
    <ul className="hw-ctx-rows">
      {items.map(i => (
        <li key={i.key}>
          <span className="hw-ctx-name" title={i.title ?? i.label}>
            {i.label}
          </span>
          <span className="hw-ctx-num">{tokens(i.tokens)}</span>
        </li>
      ))}
    </ul>
  )
  const detail = (r: ContextRow) => {
    switch (detailOf(r)) {
      case 'mcp':
        return list(
          snap.mcp.map(m => ({
            key: m.server,
            label: `${m.server} · ${t.ctxTools(m.tools)}`,
            tokens: m.tokens,
          })),
        )
      case 'memory':
        return list(
          snap.memory.map(m => ({
            key: m.path,
            label: m.path.replace(/^\/Users\/[^/]+/, '~'),
            title: m.path,
            tokens: m.tokens,
          })),
        )
      case 'skills':
        return list(
          snap.skillGroups.map(g => ({
            key: `${g.kind}:${g.name}`,
            label: `${
              g.kind === 'plugin'
                ? t.ctxFromPlugin(g.name)
                : g.kind === 'other' && g.name
                  ? g.name
                  : t.ctxFrom[g.kind]
            } · ${t.ctxSkillCount(g.skills)}`,
            tokens: g.tokens,
          })),
        )
      case 'agents':
        return list(snap.agents.map(a => ({ key: a.name, label: a.name, tokens: a.tokens })))
      case 'compact':
        return snap.compactAt !== undefined ? (
          <p className="hw-editor-hint">{t.ctxCompact(tokens(snap.compactAt))}</p>
        ) : null
      default:
        return null
    }
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
            data-picked={r.name === pick || undefined}
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
        <>
          <div className="hw-ctx-chips">
            {rows.map(r => (
              <button
                type="button"
                key={r.name}
                className="hw-ctx-chip"
                data-kind={r.kind}
                aria-pressed={r.name === pick}
                title={name(r)}
                onClick={() => choose(r)}
              >
                <span className="hw-ctx-chip-name">
                  <span className="hw-ctx-dot" style={{ background: colorOf(r) }} aria-hidden="true" />
                  {name(r)}
                </span>
                <span className="hw-ctx-chip-num">
                  {tokens(r.tokens)}
                  {r.kind === 'deferred' ? '' : ` · ${share(r)}`}
                </span>
              </button>
            ))}
          </div>
          {picked ? (
            <div className="hw-ctx-detail" role="status">
              <div className="hw-ctx-detail-head">
                <span className="hw-ctx-dot" style={{ background: colorOf(picked) }} aria-hidden="true" />
                <b>{name(picked)}</b>
                <span className="hw-ctx-num">
                  {tokens(picked.tokens)}
                  {picked.kind === 'deferred' ? '' : ` · ${share(picked)}`}
                </span>
              </div>
              {t.ctxAbout[picked.name] && <p className="hw-editor-hint">{t.ctxAbout[picked.name]}</p>}
              {picked.kind === 'deferred' && <p className="hw-editor-hint">{t.ctxDeferred}</p>}
              {detail(picked)}
            </div>
          ) : (
            <p className="hw-editor-hint">{t.ctxPickHint}</p>
          )}
        </>
      )}
    </section>
  )
}
