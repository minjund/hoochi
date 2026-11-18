import { useMemo, useState } from 'react'

import type { ContextSnapshot, Skill, SkillGroup, SkillState } from '../../lib/backend'
import type { UiText } from '../../lib/i18n'
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

/** Kinds of skill that can be switched one by one (skillOverrides); plugins go whole. */
const ONE_BY_ONE: ReadonlySet<SkillGroup['kind']> = new Set(['user', 'project', 'builtin'])

/** Every skill Claude is shown, by where it comes from, with a switch wherever one works. */
export function SkillsPanel({
  snap,
  state,
  local,
  t,
  onSkill,
  onPlugin,
  onClose,
}: {
  snap: ContextSnapshot | null
  state: SkillState
  /** skills found on disk: your own, and installed plugins' as "plugin:skill" */
  local: Skill[]
  t: UiText
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
    const installed = new Set(state.plugins.map(p => p.name))
    const list: Row[] = fromDisk
      ? local.flatMap((k): Row[] => {
          const i = k.name.indexOf(':')
          if (i < 0) return [{ name: k.name, kind: 'user', tokens: 0 }]
          const plugin = k.name.slice(0, i)
          return installed.has(plugin) && plugin !== 'hookwich'
            ? [{ name: k.name, kind: 'plugin', plugin, tokens: 0 }]
            : []
        })
      : (snap?.skillList ?? [])
    const byKey = new Map<string, Group>()
    const order = { plugin: 0, user: 1, project: 2, builtin: 3, synced: 4, other: 5, off: 6 } as const
    for (const row of list) {
      const key = row.kind === 'plugin' ? `plugin:${row.plugin ?? ''}` : row.kind
      const plugin = row.kind === 'plugin' ? state.plugins.find(p => p.name === row.plugin) : undefined
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
      if (p.on || p.name === 'hookwich' || byKey.has(`plugin:${p.name}`)) continue
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

  const q = filter.trim().toLowerCase()
  const shown = groups
    .map(g => ({ ...g, rows: q ? g.rows.filter(r => r.name.toLowerCase().includes(q)) : g.rows }))
    .filter(g => !q || g.rows.length > 0 || g.title.toLowerCase().includes(q))
  const count = fromDisk
    ? groups.reduce((n, g) => n + (g.kind === 'off' ? 0 : g.rows.length), 0)
    : (snap?.skills?.count ?? 0)

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
            {t.skillsTitle} · {count}
            {snap?.skills && !fromDisk ? ` · ${tokens(snap.skills.tokens)}` : ''}
          </b>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t.close}
          </Button>
        </div>
        <p className="hw-editor-hint">{t.skillsHint}</p>
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
          {shown.length === 0 && <p className="hw-editor-hint">{t.skillsNone}</p>}
          {shown.map(g => (
            <section key={g.key} data-off={g.plugin?.on === false || undefined}>
              <h4 className="hw-skills-head">
                <span>
                  {g.title}
                  {g.rows.length > 0 ? ` · ${t.ctxSkillCount(g.rows.length)}` : ''}
                  {g.tokens > 0 ? ` · ${tokens(g.tokens)}` : ''}
                  {g.plugin?.on === false ? ` · ${t.existingOff}` : ''}
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
              </h4>
              {g.kind === 'synced' && <p className="hw-editor-hint">{t.skillsSynced}</p>}
              <ul className="hw-skills-rows">
                {g.rows.map(r => {
                  const switchable = g.kind === 'off' || ONE_BY_ONE.has(r.kind)
                  const isOff = off.has(r.name)
                  return (
                    <li key={r.name} data-off={isOff || undefined}>
                      <span className="hw-skills-name" title={r.name}>
                        {r.name}
                      </span>
                      {r.tokens > 0 && <span className="hw-skills-num">{tokens(r.tokens)}</span>}
                      {switchable && (
                        <Switch
                          size="sm"
                          aria-label={t.skillSwitch(r.name)}
                          checked={!isOff}
                          onChange={e => onSkill(r.name, e.currentTarget.checked)}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
