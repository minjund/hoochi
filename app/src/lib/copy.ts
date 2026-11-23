/**
 * Putting what is in one place into others, and finding what a place hides.
 *
 * Only the narrowest place with items for a moment counts (a terminal over its project over
 * everywhere). So once this project has its own item for "answer ends", what is put in
 * everywhere for that moment does not reach chats here. `hiddenHere` finds those, so the window
 * can say so on the card and offer to bring them along. `sendTo` copies chosen items into
 * chosen places, skipping what is already there.
 */
import {
  itemFilled,
  listOf,
  mergeItems,
  sameItem,
  withList,
  type Agent,
  type Config,
  type Item,
  type Scope,
} from './lifecycle.ts'

export type PlaceRef = { scope: Scope; key: string }

/** The places above this one, nearest first: a terminal's project, then everywhere. */
export function broaderThan(scope: Scope, terminalProject: string): PlaceRef[] {
  if (scope === 'global') return []
  if (scope === 'project') return [{ scope: 'global', key: '' }]
  return [...(terminalProject ? [{ scope: 'project' as const, key: terminalProject }] : []), { scope: 'global', key: '' }]
}

/**
 * What is put in for `event` in a broader place that does not reach chats here, because this
 * place has its own items for that moment. Switched-off and empty items are left out, and so is
 * anything this place already has.
 */
export function hiddenHere(
  config: Config,
  who: Agent,
  here: PlaceRef,
  terminalProject: string,
  event: string,
): { place: PlaceRef; items: Item[] }[] {
  const mine = listOf(config[who], here.scope, here.key).filter(i => i.event === event && itemFilled(i))
  if (mine.length === 0) return []
  return broaderThan(here.scope, terminalProject)
    .map(place => ({
      place,
      items: listOf(config[who], place.scope, place.key).filter(
        i => i.event === event && i.enabled && itemFilled(i) && !mine.some(m => sameItem(m, i)),
      ),
    }))
    .filter(h => h.items.length > 0)
}

/** Whether every one of `items` is already in `place`. */
export function hasAll(config: Config, who: Agent, place: PlaceRef, items: readonly Item[]): boolean {
  const there = listOf(config[who], place.scope, place.key)
  return items.length > 0 && items.every(i => there.some(t => sameItem(t, i)))
}

/** Copies `items` into each of `places`; what a place already has is skipped there. */
export function sendTo(
  config: Config,
  who: Agent,
  items: readonly Item[],
  places: readonly PlaceRef[],
  makeId: () => string,
): { config: Config; added: number; places: number } {
  let next = config
  let added = 0
  let reached = 0
  for (const place of places) {
    const merged = mergeItems(listOf(next[who], place.scope, place.key), [...items], makeId)
    if (merged.added === 0) continue
    next = withList(next, who, place.scope, place.key, merged.list)
    added += merged.added
    reached += 1
  }
  return { config: next, added, places: reached }
}

/** The other places that have the same item: everywhere and the projects (not terminals). */
export function alsoIn(config: Config, who: Agent, here: PlaceRef, item: Item): PlaceRef[] {
  const a = config[who]
  const places: PlaceRef[] = [
    { scope: 'global', key: '' },
    ...Object.keys(a.projects).map(key => ({ scope: 'project' as const, key })),
  ]
  return places.filter(
    p => !(p.scope === here.scope && p.key === here.key) && listOf(a, p.scope, p.key).some(i => sameItem(i, item)),
  )
}
