import { useMemo, useState, type ReactNode } from 'react'

import type { ContextSnapshot, Skill, SkillGroup, SkillState } from '../../lib/backend'
import type { UiText } from '../../lib/i18n'
import { ONE_BY_ONE } from '../../lib/skills'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { tokens } from './lifecycle-diagram'

type Row = NonNullable<ContextSnapshot['skillList']>[number]

type Group = {
  key: string
  kind: SkillGroup['kind'] | 'off'
  title: string
  rows: Row[]
  tokens: number
  /** for a plugin: its "name@marketplace" and whether it is on */
  plugin?: { key: string; on: boolean }
}

/** Every skill Claude is shown, by where it comes from, with a switch wherever one works. */
export function SkillsPanel({
  snap,
  state,
  local,
  t,
  banner,
  onSkill,
  onPlugin,
  onClose,
}: {
  snap: ContextSnapshot | null
  state: SkillState
  /** skills found on disk: your own, and installed plugins' as "plugin:skill" */
  local: Skill[]
  t: UiText
  /** what the window has to say while this is open (a switch that failed), shown inside it */
  banner?: ReactNode
  onSkill(name: string, on: boolean): void
  onPlugin(key: string, on: boolean): void
  onClose(): void
}) {
  const [filter, setFilter] = useState('')
  const [asking, setAsking] = useState<Group | null>(null)
  const off = useMemo(() => new Set(state.off), [state.off])

  // What the chat lists (sizes included) when its plugin wrote it, else what is on disk.
  const fromDisk = (snap?.skillList.length ?? 0) === 0
  const groups = useMemo(() => {
    // A plugin's skills may name it as its manifest does ("Notion") and the settings in lower case.
    const same = (a = '', b = '') => a.toLowerCase() === b.toLowerCase()
    const installed = new Set(state.plugins.map(p => p.name.toLowerCase()))
    const list: Row[] = fromDisk
      ? local.flatMap((k): Row[] => {
          const i = k.name.indexOf(':')
          if (i < 0) return [{ name: k.name, kind: 'user', tokens: 0 }]
          const plugin = k.name.slice(0, i)
          return installed.has(plugin.toLowerCase()) && plugin !== 'hookwich'
            ? [{ name: k.name, kind: 'plugin', plugin, tokens: 0 }]
            : []
        })
      : (snap?.skillList ?? [])
    const byKey = new Map<string, Group>()
    const order = { plugin: 0, user: 1, project: 2, builtin: 3, synced: 4, other: 5, off: 6 } as const
    for (const row of list) {
      const key = row.kind === 'plugin' ? `plugin:${row.plugin ?? ''}` : row.kind
      const plugin = row.kind === 'plugin' ? state.plugins.find(p => same(p.name, row.plugin)) : undefined
      const g = byKey.get(key) ?? {
        key,
        kind: row.kind,
        title: row.kind === 'plugin' ? t.ctxFromPlugin(row.plugin ?? '') : t.ctxFrom[row.kind],
        rows: [],
        tokens: 0,
        ...(plugin ? { plugin: { key: plugin.key, on: plugin.on } } : {}),
      }
      g.rows.push(row)
      g.tokens += row.tokens
      byKey.set(key, g)
    }
    // Plugins switched off are not listed to Claude, so they come from the settings instead.
    for (const p of state.plugins) {
      const listed = [...byKey.values()].some(g => g.kind === 'plugin' && same(g.key.slice('plugin:'.length), p.name))
      if (p.on || p.name === 'hookwich' || listed) continue
      byKey.set(`plugin:${p.name}`, {
        key: `plugin:${p.name}`,
        kind: 'plugin',
        title: t.ctxFromPlugin(p.name),
        rows: [],
        tokens: 0,
        plugin: { key: p.key, on: false },
      })
    }
    const listed = new Set(list.map(r => r.name))
    const parked = state.off.filter(name => !listed.has(name))
    if (parked.length > 0)
      byKey.set('off', {
        key: 'off',
        kind: 'off',
        title: t.skillsOff,
        rows: parked.map(name => ({ name, kind: 'user', tokens: 0 })),
        tokens: 0,
      })
    return [...byKey.values()].sort(
      (a, b) =>
        order[a.kind] - order[b.kind] ||
        Number(b.plugin?.on ?? true) - Number(a.plugin?.on ?? true) ||
        b.tokens - a.tokens,
    )
  }, [snap, state, local, fromDisk, t])

  // Only what can be switched from here: a skill of yours or a built-in one by itself, a plugin
  // as a whole (one row, its skills not listed one by one). Skills synced from claude.ai, ones of
  // unknown origin, and hookwich itself are left out; how many is said once, at the end.
  const canSwitch = (g: Group) =>
    g.kind === 'off' ||
    (g.kind !== 'plugin' && ONE_BY_ONE.has(g.kind)) ||
    (g.kind === 'plugin' && g.plugin !== undefined && !g.plugin.key.startsWith('hookwich@'))
  const usable = groups.filter(canSwitch)
  const hidden = groups
    .filter(g => !canSwitch(g))
    .reduce((n, g) => n + g.rows.length, 0)
  const plugins = usable.filter(g => g.kind === 'plugin')
  const singles = usable.filter(g => g.kind !== 'plugin')

  const q = filter.trim().toLowerCase()
  const hits = (text: string) => text.toLowerCase().includes(q)
  const shownPlugins = plugins.filter(g => !q || hits(g.title) || g.rows.some(r => hits(r.name)))
  const shownSingles = singles
    .map(g => ({ ...g, rows: q ? g.rows.filter(r => hits(r.name)) : g.rows }))
    .filter(g => g.rows.length > 0)
  const oneByOne = singles.reduce((n, g) => n + g.rows.length, 0)

  return (
    <div
      className="hw-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t.skillsTitle}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="hw-modal-card">
        <div className="hw-modal-head">
          <b>
            {t.skillsTitle} · {t.skillsCounts(oneByOne, plugins.length)}
          </b>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t.close}
          </Button>
        </div>
        <p className="hw-editor-hint">{t.skillsHint}</p>
        {banner}
        {fromDisk && <p className="hw-note">{t.skillsFromDisk}</p>}
        <input
          className="hw-skills-filter"
          type="search"
          placeholder={t.skillsFilter}
          aria-label={t.skillsFilter}
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        {asking?.plugin && (
          <div className="hw-confirm" role="alertdialog">
            <span>{t.pluginWhole(asking.plugin.key.split('@')[0] ?? asking.plugin.key)}</span>
            <div>
              <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
                {t.cancel}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (asking.plugin) onPlugin(asking.plugin.key, false)
                  setAsking(null)
                }}
              >
                {t.turnOffPlugin}
              </Button>
            </div>
          </div>
        )}
        <div className="hw-modal-list">
          {shownPlugins.length === 0 && shownSingles.length === 0 && (
            <p className="hw-editor-hint">{t.skillsNone}</p>
          )}
          {shownPlugins.length > 0 && (
            <section>
              <h4 className="hw-skills-head">
                <span>{t.skillsPlugins}</span>
              </h4>
              <ul className="hw-skills-rows">
                {shownPlugins.map(g => (
                  <li
                    key={g.key}
                    data-off={g.plugin?.on === false || undefined}
                    title={g.rows.map(r => r.name).join(', ')}
                  >
                    <span className="hw-skills-name">{g.key.slice('plugin:'.length)}</span>
                    <span className="hw-skills-num">
                      {g.rows.length > 0 ? t.ctxSkillCount(g.rows.length) : t.existingOff}
                      {g.tokens > 0 ? ` · ${tokens(g.tokens)}` : ''}
                    </span>
                    {g.plugin && (
                      <Switch
                        size="sm"
                        aria-label={t.pluginSwitch(g.title)}
                        checked={g.plugin.on}
                        onChange={e => {
                          if (!g.plugin) return
                          if (e.currentTarget.checked) onPlugin(g.plugin.key, true)
                          else setAsking(g)
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {shownSingles.map(g => (
            <section key={g.key}>
              <h4 className="hw-skills-head">
                <span>
                  {g.title} · {t.ctxSkillCount(g.rows.length)}
                  {g.tokens > 0 ? ` · ${tokens(g.tokens)}` : ''}
                </span>
              </h4>
              <ul className="hw-skills-rows">
                {g.rows.map(r => {
                  const isOff = off.has(r.name)
                  return (
                    <li key={r.name} data-off={isOff || undefined}>
                      <span className="hw-skills-name" title={r.name}>
                        {r.name}
                      </span>
                      {r.tokens > 0 && <span className="hw-skills-num">{tokens(r.tokens)}</span>}
                      <Switch
                        size="sm"
                        aria-label={t.skillSwitch(r.name)}
                        checked={!isOff}
                        onChange={e => onSkill(r.name, e.currentTarget.checked)}
                      />
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          {hidden > 0 && !q && <p className="hw-editor-hint">{t.skillsHidden(hidden)}</p>}
        </div>
      </div>
    </div>
  )
}
