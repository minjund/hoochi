/**
 * What a sentence can do to the items already put in, as pure changes to the config: change one
 * (its words, its moment, its place or its AI), copy some to another place or AI, switch some off
 * or on, or delete some. Each one can be taken back by itself (`revertEdit`), without undoing
 * whatever else changed since.
 */
import { listOf, withList, type Agent, type Config, type Item, type Scope } from './lifecycle.ts'

/** An item already put in, where it is, and where it stood in its list. */
export type Target = { agent: Agent; scope: Scope; key: string; index: number; item: Item }
export type Dest = { agent: Agent; scope: Scope; key: string }

export type Edit =
  /** `item` is the item after the change (the same id), in `to` */
  | { action: 'change'; target: Target; item: Item; to: Dest }
  /** `items` are the copies (new ids), each in its own `to` */
  | { action: 'copy'; copies: { item: Item; to: Dest }[] }
  | { action: 'off' | 'on' | 'delete'; targets: Target[] }

const same = (a: Dest, b: Dest) => a.agent === b.agent && a.scope === b.scope && a.key === b.key

/** Every item put in, for both AIs, at every place, in list order. */
export function allTargets(config: Config): Target[] {
  return (['claude', 'codex'] as const).flatMap(agent => {
    const a = config[agent]
    const lists: [Scope, string, Item[]][] = [
      ['global', '', a.global],
      ...Object.entries(a.projects).map(([k, l]) => ['project', k, l] as [Scope, string, Item[]]),
      ...Object.entries(a.terminals).map(([k, l]) => ['terminal', k, l] as [Scope, string, Item[]]),
    ]
    return lists.flatMap(([scope, key, list]) => list.map((item, index) => ({ agent, scope, key, index, item })))
  })
}

function mapList(config: Config, at: Dest, f: (list: Item[]) => Item[]): Config {
  return withList(config, at.agent, at.scope, at.key, f(listOf(config[at.agent], at.scope, at.key)))
}

/** Put an item back where it stood (or at the end when the list got shorter). */
function insertAt(list: Item[], item: Item, index: number): Item[] {
  const rest = list.filter(i => i.id !== item.id)
  return [...rest.slice(0, index), item, ...rest.slice(index)]
}

export function applyEdit(config: Config, e: Edit): Config {
  switch (e.action) {
    case 'change': {
      if (same(e.target, e.to)) return mapList(config, e.to, l => l.map(i => (i.id === e.target.item.id ? e.item : i)))
      const out = mapList(config, e.target, l => l.filter(i => i.id !== e.target.item.id))
      return mapList(out, e.to, l => [...l, e.item])
    }
    case 'copy':
      return e.copies.reduce((c, x) => mapList(c, x.to, l => [...l, x.item]), config)
    case 'off':
    case 'on':
      return e.targets.reduce(
        (c, t) => mapList(c, t, l => l.map(i => (i.id === t.item.id ? { ...i, enabled: e.action === 'on' } : i))),
        config,
      )
    case 'delete':
      return e.targets.reduce((c, t) => mapList(c, t, l => l.filter(i => i.id !== t.item.id)), config)
  }
}

export function revertEdit(config: Config, e: Edit): Config {
  switch (e.action) {
    case 'change': {
      const out = mapList(config, e.to, l => l.filter(i => i.id !== e.item.id))
      return mapList(out, e.target, l => insertAt(l, e.target.item, e.target.index))
    }
    case 'copy':
      return e.copies.reduce((c, x) => mapList(c, x.to, l => l.filter(i => i.id !== x.item.id)), config)
    case 'off':
    case 'on':
      return e.targets.reduce(
        (c, t) => mapList(c, t, l => l.map(i => (i.id === t.item.id ? { ...i, enabled: t.item.enabled } : i))),
        config,
      )
    case 'delete':
      // In list order, so each one goes back to the index it had.
      return [...e.targets]
        .sort((a, b) => a.index - b.index)
        .reduce((c, t) => mapList(c, t, l => insertAt(l, t.item, t.index)), config)
  }
}
