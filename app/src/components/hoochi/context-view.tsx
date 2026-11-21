import type { ReactNode } from 'react'

import type { ContextRow, ContextSnapshot, SkillState } from '../../lib/backend'
import type { UiText } from '../../lib/i18n'
import { switchableGroups } from '../../lib/skills'
import { tokens } from './lifecycle-diagram'

/** One color per kind of thing in the context window, the same in every view. */
const COLORS: Record<string, string> = {
  'System prompt': '#8a93a6',
  'System tools': '#5b8def',
  'MCP tools': '#22a6b3',
  'MCP server instructions': '#79c3cc',
  'Custom agents': '#a77bf3',
  'Memory files': '#d39b5b',
  Skills: '#3fa34d',
  Messages: '#e0a526',
}
const colorOf = (name: string) => COLORS[name] ?? '#9aa3b2'

/** Which part a view is about: what a chat starts with, the conversation, or the room left. */
export type ContextFocus = 'start' | 'messages' | 'compact'

const inWindow = (r: ContextRow) => r.kind === 'used'
const sum = (rows: ContextRow[]) => rows.reduce((n, r) => n + r.tokens, 0)
const percent = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

/** What sits in the window, biggest first, the conversation last. */
function usedRows(snap: ContextSnapshot): ContextRow[] {
  const used = snap.rows.filter(inWindow)
  return [...used.filter(r => r.name !== 'Messages').sort((a, b) => b.tokens - a.tokens), ...used.filter(r => r.name === 'Messages')]
}

/** The whole window as one bar: each kind its color, then the free room, then the compaction buffer. */
export function ContextBar({ snap, focus, t }: { snap: ContextSnapshot; focus?: ContextFocus; t: UiText }) {
  const used = usedRows(snap)
  const free = sum(snap.rows.filter(r => r.kind === 'free'))
  const buffer = sum(snap.rows.filter(r => r.kind === 'buffer'))
  const width = (n: number) => `${Math.max(0, (n / snap.max) * 100)}%`
  const dim = (r: ContextRow) =>
    (focus === 'start' && r.name === 'Messages') || (focus === 'messages' && r.name !== 'Messages')
  return (
    <div
      className="hw-ctxbar"
      role="img"
      aria-label={`${t.ctxTitle}: ${tokens(snap.used)} / ${tokens(snap.max)} (${snap.percent}%)`}
    >
      {used.map(r => (
        <span
          key={r.name}
          style={{ width: width(r.tokens), background: colorOf(r.name) }}
          data-dim={dim(r) || undefined}
          title={`${t.ctxRows[r.name] ?? r.name} · ${tokens(r.tokens)}`}
        />
      ))}
      {free > 0 && <span className="hw-ctxbar-free" style={{ width: width(free) }} />}
      {buffer > 0 && <span className="hw-ctxbar-buffer" style={{ width: width(buffer) }} />}
      {snap.compactAt !== undefined && (
        <i className="hw-ctxbar-mark" style={{ left: width(snap.compactAt) }} title={t.ctxCompactHere} />
      )}
    </div>
  )
}

/** Rows with their color, size and share of the window. */
function Legend({ rows, max, t }: { rows: ContextRow[]; max: number; t: UiText }) {
  return (
    <ul className="hw-ctxlegend">
      {rows.map(r => (
        <li key={r.name} data-kind={r.kind}>
          <i style={r.kind === 'used' ? { background: colorOf(r.name) } : undefined} />
          <span>{t.ctxRows[r.name] ?? r.name}</span>
          <b>{tokens(r.tokens)}</b>
          <em>{percent(r.tokens, max)}%</em>
        </li>
      ))}
    </ul>
  )
}

/** The one figure that matters at this moment, big, with what it is out of. */
function Headline({ snap, focus, t }: { snap: ContextSnapshot; focus: ContextFocus; t: UiText }) {
  const loaded = sum(usedRows(snap).filter(r => r.name !== 'Messages'))
  const messages = snap.rows.find(r => r.name === 'Messages')?.tokens ?? 0
  if (focus === 'start')
    return (
      <div className="hw-ctxhead">
        <b>{tokens(loaded)}</b>
        <span>{t.ctxAtStart(percent(loaded, snap.max))}</span>
      </div>
    )
  if (focus === 'messages')
    return (
      <div className="hw-ctxhead">
        <b>{tokens(messages)}</b>
        <span>{t.ctxConversation(percent(messages, snap.max))}</span>
      </div>
    )
  return (
    <div className="hw-ctxhead">
      <b>
        {tokens(snap.used)}
        <small> / {tokens(snap.compactAt ?? snap.max)}</small>
      </b>
      <span>
        {snap.compactAt === undefined ? t.ctxCompactOff : t.ctxUntilCompact(tokens(Math.max(0, snap.compactAt - snap.used)))}
      </span>
    </div>
  )
}

/** In a hover card each list shows only its biggest few, so the card stays short. */
const TOP = 3

/** A list of named sizes drawn as bars against the biggest; the biggest few, and how many more. */
function Bars({ rows, t }: { rows: { key: string; name: string; note?: string; tokens: number }[]; t: UiText }) {
  const top = Math.max(1, ...rows.map(r => r.tokens))
  const shown = [...rows].sort((a, b) => b.tokens - a.tokens).slice(0, TOP)
  const more = rows.length - shown.length
  return (
    <ul className="hw-ctxbars">
      {shown.map(r => (
        <li key={r.key}>
          <span title={r.name}>
            {r.name}
            {r.note ? <em> · {r.note}</em> : null}
          </span>
          <b>{tokens(r.tokens)}</b>
          <i style={{ width: `${(r.tokens / top) * 100}%` }} />
        </li>
      ))}
      {more > 0 && <li className="hw-ctxbars-more">{t.tipMore(more)}</li>}
    </ul>
  )
}

/** What a chat starts with, beyond the window's own rows: MCP servers, memory, skills, agents. */
function StartDetail({
  snap,
  plugins,
  t,
  extra,
}: {
  snap: ContextSnapshot
  plugins: SkillState['plugins']
  t: UiText
  extra?: ReactNode
}) {
  const home = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
  // Only what can be turned on and off is counted and listed, as in the skills popup.
  const skills = switchableGroups(snap.skillGroups, plugins)
  const skillCount = skills.reduce((n, g) => n + g.skills, 0)
  return (
    <>
      {snap.mcp.length > 0 && (
        <div className="hw-ctxpart">
          <div className="hw-tip-label">{t.ctxMcpServers}</div>
          <Bars t={t} rows={snap.mcp.map(m => ({ key: m.server, name: m.server, note: t.ctxTools(m.tools), tokens: m.tokens }))} />
        </div>
      )}
      {snap.memory.length > 0 && (
        <div className="hw-ctxpart">
          <div className="hw-tip-label">{t.ctxRows['Memory files'] ?? 'Memory files'}</div>
          <Bars t={t} rows={snap.memory.map(m => ({ key: m.path, name: home(m.path), tokens: m.tokens }))} />
        </div>
      )}
      {snap.skills && skills.length > 0 && (
        <div className="hw-ctxpart">
          <div className="hw-tip-label hw-ctxpart-head">
            <span>{t.ctxSkills(skillCount)}</span>
            {extra}
          </div>
          <Bars
            t={t}
            rows={skills.map(g => ({
              key: `${g.kind}:${g.name}`,
              name: g.kind === 'plugin' ? g.name : g.kind === 'other' && g.name ? g.name : t.ctxFrom[g.kind],
              note: t.ctxSkillCount(g.skills),
              tokens: g.tokens,
            }))}
          />
        </div>
      )}
      {snap.agents.length > 0 && (
        <div className="hw-ctxpart">
          <div className="hw-tip-label">{t.ctxAgents}</div>
          <Bars t={t} rows={snap.agents.map(a => ({ key: a.name, name: a.name, note: a.source, tokens: a.tokens }))} />
        </div>
      )}
    </>
  )
}

/**
 * For a hover card: the figure for this moment, the bar, its rows, and at the start of a chat
 * what it loads (MCP servers, memory files, skills that can be switched, agents), each list
 * cut to its biggest few so the card stays short and off the box it points at.
 */
export function ContextGlance({
  snap,
  focus,
  plugins,
  t,
  extra,
}: {
  snap: ContextSnapshot
  focus: ContextFocus
  /** installed plugins, so only skills that can be switched are counted */
  plugins: SkillState['plugins']
  t: UiText
  /** shown with the skills (the switch for them) */
  extra?: ReactNode
}) {
  const used = usedRows(snap)
  const rows =
    focus === 'start'
      ? used.filter(r => r.name !== 'Messages')
      : focus === 'messages'
        ? [...used.filter(r => r.name === 'Messages'), ...snap.rows.filter(r => r.kind === 'free')]
        : snap.rows.filter(r => r.kind === 'free' || r.kind === 'buffer')
  return (
    <section className="hw-ctxglance" aria-label={t.ctxTitle}>
      <div className="hw-tip-label">
        {t.ctxTitle} · {t.ago(Math.max(0, Date.now() - snap.at))}
      </div>
      <Headline snap={snap} focus={focus} t={t} />
      <ContextBar snap={snap} focus={focus} t={t} />
      <Legend rows={rows} max={snap.max} t={t} />
      {focus === 'start' && <StartDetail snap={snap} plugins={plugins} t={t} extra={extra} />}
    </section>
  )
}
