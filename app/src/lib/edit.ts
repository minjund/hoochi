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
export type Change = { target: Target; item: Item; to: Dest }

export type Edit =
  /** each `item` is that item after the change (the same id), in its `to` */
  | { action: 'change'; changes: Change[] }
  /** `items` are the copies (new ids), each in its own `to` */
  | { action: 'copy'; copies: { item: Item; to: Dest }[] }
  | { action: 'off' | 'on' | 'delete'; targets: Target[] }

/** One item put in, named by its AI, place and id. */
export const targetKey = (t: Pick<Target, 'agent' | 'scope' | 'key' | 'item'>) => `${t.agent}|${t.scope}|${t.key}|${t.item.id}`

const same = (a: Dest, b: Dest) => a.agent === b.agent && a.scope === b.scope && a.key === b.key

/** The items an edit leaves on screen: where they are after it (done) or before it. */
export function touched(e: Edit, done: boolean): Target[] {
  switch (e.action) {
    case 'change':
      return e.changes.map(x => (done ? { ...x.to, index: 0, item: x.item } : x.target))
    case 'copy':
      return done ? e.copies.map(x => ({ ...x.to, index: 0, item: x.item })) : []
    case 'delete':
      return done ? [] : e.targets
    default:
      return e.targets
  }
}

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
    case 'change':
      return e.changes.reduce((c, x) => {
        if (same(x.target, x.to)) return mapList(c, x.to, l => l.map(i => (i.id === x.target.item.id ? x.item : i)))
        return mapList(mapList(c, x.target, l => l.filter(i => i.id !== x.target.item.id)), x.to, l => [...l, x.item])
      }, config)
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
    case 'change':
      // In list order, so each one goes back to the index it had.
      return [...e.changes]
        .sort((a, b) => a.target.index - b.target.index)
        .reduce((c, x) => {
          const out = mapList(c, x.to, l => l.filter(i => i.id !== x.item.id))
          return mapList(out, x.target, l => insertAt(l, x.target.item, x.target.index))
        }, config)
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
