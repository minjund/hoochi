'use client'

import { useEffect, useId, useState } from 'react'
import {
  MORE_SLOTS,
  STAGES,
  itemLabel,
  type Activity,
  type Item,
  type Slot,
  type Stage,
} from '../../lib/lifecycle'

export type LifecycleSandwichProps = {
  items: Item[]
  activity: Activity
  selectedEvent: string | null
  onSelectSlot(event: string): void
  onAdd(event: string): void
  onToggleItem(id: string, enabled: boolean): void
}

/** Each stage sits between its before and after bread; less common events live below. */
export function LifecycleSandwich(props: LifecycleSandwichProps) {
  const { activity } = props
  const [, refresh] = useState(0)

  useEffect(() => {
    const remaining = activity.lastAt + 2500 - Date.now()
    if (!activity.lastEvent || remaining <= 0) return
    // Activity can stop arriving entirely, so schedule the render that removes the glow.
    const timeout = window.setTimeout(() => refresh(value => value + 1), remaining + 1)
    return () => window.clearTimeout(timeout)
  }, [activity.lastAt, activity.lastEvent])

  const age = Date.now() - activity.lastAt
  const recentEvent = age >= 0 && age < 2500 ? activity.lastEvent : null

  return (
    <>
      {/* React 19 hoists this into <head> once, even with multiple lifecycle lists. */}
      <style href="ui-lifecycle-sandwich" precedence="default">
        {css}
      </style>
      <div className="ui-lcs">
        <ol className="ui-lcs__stages" aria-label="Claude Code lifecycle">
          {STAGES.map(stage => (
            <li key={stage.id}>
              <StageSandwich stage={stage} {...props} recentEvent={recentEvent} />
            </li>
          ))}
        </ol>
        <details className="ui-lcs__more">
          <summary className="ui-lcs__summary">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
              <path
                d="m6 4 4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            More events
            <span className="ui-lcs__more-count">{MORE_SLOTS.length}</span>
          </summary>
          <ul className="ui-lcs__extra" aria-label="More hook events">
            {MORE_SLOTS.map(slot => (
              <li key={slot.event}>
                <SlotRow slot={slot} {...props} recentEvent={recentEvent} />
              </li>
            ))}
          </ul>
        </details>
      </div>
    </>
  )
}

type RowProps = LifecycleSandwichProps & { recentEvent: string | null }

function StageSandwich({ stage, ...props }: RowProps & { stage: Stage }) {
  const nameId = useId()
  return (
    <section className="ui-lcs__sandwich" aria-labelledby={nameId}>
      <SlotRow slot={stage.before} {...props} bread="top" />
      <h3 className="ui-lcs__filling" id={nameId}>
        <span className="ui-lcs__filling-line" aria-hidden="true" />
        {stage.name}
        <span className="ui-lcs__filling-line" aria-hidden="true" />
      </h3>
      <SlotRow slot={stage.after} {...props} bread="bottom" />
    </section>
  )
}

function SlotRow({
  slot,
  items,
  activity,
  selectedEvent,
  recentEvent,
  onSelectSlot,
  onAdd,
  onToggleItem,
  bread,
}: RowProps & { slot: Slot; bread?: 'top' | 'bottom' }) {
  const hintId = useId()
  const count = activity.counts[slot.event] ?? 0
  const slotItems = items.filter(item => item.event === slot.event)

  return (
    <div
      className="ui-lcs__slot"
      data-bread={bread}
      data-selected={selectedEvent === slot.event ? '' : undefined}
      data-recent={recentEvent === slot.event ? '' : undefined}
    >
      {/* The selection button stretches across the row; other buttons sit above it. */}
      <button
        type="button"
        className="ui-lcs__select"
        aria-pressed={selectedEvent === slot.event}
        aria-describedby={hintId}
        onClick={() => onSelectSlot(slot.event)}
      >
        <span className="ui-lcs__slot-label">{slot.label}</span>
        <span className="ui-lcs__event">{slot.event}</span>
      </button>
      <span className="ui-lcs__sr" id={hintId}>
        {slot.hint}
      </span>
      <span className="ui-lcs__count" aria-label={`Fired ${count} times`} title={`Fired ${count} times`}>
        {count.toLocaleString()}
      </span>
      <button
        type="button"
        className="ui-lcs__add"
        aria-label={`Add item to ${slot.event}`}
        title={`Add item to ${slot.event}`}
        onClick={() => onAdd(slot.event)}
      >
        +
      </button>
      {!slot.canInject && <span className="ui-lcs__tag">commands only</span>}
      {slotItems.length > 0 && (
        <ul className="ui-lcs__chips" aria-label={`Items in ${slot.event}`}>
          {slotItems.map(item => {
            const label = itemLabel(item)
            return (
              <li
                className="ui-lcs__chip"
                data-disabled={!item.enabled ? '' : undefined}
                key={item.id}
                title={label}
              >
                <button
                  type="button"
                  className="ui-lcs__kind"
                  aria-label={`${item.kind}: ${label}`}
                  aria-pressed={item.enabled}
                  title={`${item.enabled ? 'Disable' : 'Enable'} ${item.kind}: ${label}`}
                  onClick={() => onToggleItem(item.id, !item.enabled)}
                >
                  <span aria-hidden="true">
                    {item.kind === 'text' ? 'T' : item.kind === 'command' ? '>_' : '/'}
                  </span>
                </button>
                <span className="ui-lcs__chip-label">{label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-lcs {
  --ui-lcs-ink: var(--aui-ink, #171717);
  --ui-lcs-muted: var(--aui-muted, #6b6b6b);
  --ui-lcs-surface: var(--aui-surface, #ffffff);
  --ui-lcs-tray: var(--aui-subtle, #f0f0f0);
  --ui-lcs-line: var(--aui-border, #ececec);
  --ui-lcs-line-strong: var(--aui-border-strong, #d9d9d9);
  --ui-lcs-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-lcs-bread: var(--aui-warning-soft, #fff1e0);
  --ui-lcs-filling: var(--aui-success, #1e8a4f);
  --ui-lcs-selected: #e6e6e6;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  color: var(--ui-lcs-ink);
  font-family: var(--aui-font, "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 12px;
  line-height: 18px;
  -webkit-font-smoothing: antialiased;
}
.ui-lcs *, .ui-lcs *::before, .ui-lcs *::after { box-sizing: border-box; }
.ui-lcs__stages, .ui-lcs__extra, .ui-lcs__chips { list-style: none; margin: 0; padding: 0; }
.ui-lcs__stages { display: grid; gap: 10px; }
.ui-lcs__sandwich { min-width: 0; padding: 3px; border: 1px solid var(--ui-lcs-line); border-radius: calc(var(--aui-radius, 12px) + 4px); background: var(--ui-lcs-tray); }
.ui-lcs__slot {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 26px;
  align-items: center;
  gap: 4px 6px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--ui-lcs-line);
  border-radius: calc(var(--aui-radius, 12px) - 4px);
  background: var(--ui-lcs-surface);
  transition: background-color 160ms ease, border-color 160ms ease, box-shadow 220ms ease;
}
.ui-lcs__slot[data-bread] { background: color-mix(in srgb, var(--ui-lcs-bread) 38%, var(--ui-lcs-surface)); }
.ui-lcs__slot[data-bread="top"] { border-radius: var(--aui-radius, 12px) var(--aui-radius, 12px) 5px 5px; }
.ui-lcs__slot[data-bread="bottom"] { border-radius: 5px 5px var(--aui-radius, 12px) var(--aui-radius, 12px); }
.ui-lcs__slot:hover { border-color: var(--ui-lcs-line-strong); }
.ui-lcs__slot[data-selected] { background: var(--ui-lcs-selected); border-color: var(--ui-lcs-ink); }
.ui-lcs__slot[data-recent] {
  border-color: var(--ui-lcs-focus);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-lcs-focus) 40%, transparent), 0 0 10px color-mix(in srgb, var(--ui-lcs-focus) 25%, transparent);
}
.ui-lcs__select, .ui-lcs__add, .ui-lcs__kind {
  margin: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ui-lcs__select { display: grid; gap: 0; min-width: 0; padding: 0; text-align: start; }
.ui-lcs__select::after { content: ""; position: absolute; inset: 0; z-index: 0; border-radius: inherit; }
.ui-lcs__select:focus-visible { outline: none; }
.ui-lcs__select:focus-visible::after { outline: 2px solid var(--ui-lcs-focus); outline-offset: 2px; }
.ui-lcs__slot-label { font-weight: 500; }
.ui-lcs__event { color: var(--ui-lcs-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; line-height: 14px; overflow-wrap: anywhere; }
.ui-lcs__count { min-width: 16px; max-width: 70px; overflow-wrap: anywhere; color: var(--ui-lcs-muted); font-size: 10px; text-align: end; font-variant-numeric: tabular-nums; pointer-events: none; }
.ui-lcs__add { position: relative; z-index: 1; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 1px solid var(--ui-lcs-line-strong); border-radius: 7px; background: var(--ui-lcs-surface); color: var(--ui-lcs-muted); font-size: 18px; line-height: 1; }
.ui-lcs__add:hover, .ui-lcs__kind:hover { background: var(--ui-lcs-tray); color: var(--ui-lcs-ink); }
.ui-lcs__add:focus-visible, .ui-lcs__kind:focus-visible, .ui-lcs__summary:focus-visible { outline: 2px solid var(--ui-lcs-focus); outline-offset: 2px; }
.ui-lcs__tag { grid-column: 1 / -1; justify-self: start; padding: 0 5px; border: 1px solid var(--ui-lcs-line-strong); border-radius: 999px; color: var(--ui-lcs-muted); font-size: 9px; line-height: 14px; pointer-events: none; }
.ui-lcs__chips { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.ui-lcs__chip { display: inline-flex; align-items: center; max-width: 100%; min-width: 0; border: 1px solid var(--ui-lcs-line-strong); border-radius: 6px; background: var(--ui-lcs-surface); font-size: 11px; line-height: 20px; }
.ui-lcs__chip[data-disabled] { opacity: 0.5; }
.ui-lcs__kind { position: relative; z-index: 1; display: grid; place-items: center; flex: none; width: 24px; height: 24px; padding: 0; border-inline-end: 1px solid var(--ui-lcs-line); border-radius: 5px 0 0 5px; color: var(--ui-lcs-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; }
.ui-lcs__kind[aria-pressed="true"] { color: var(--ui-lcs-filling); }
.ui-lcs__chip-label { min-width: 0; padding: 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
.ui-lcs__filling { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 0; padding: 3px 12px; color: var(--ui-lcs-ink); font-size: 11px; font-weight: 500; line-height: 18px; }
.ui-lcs__filling-line { flex: 1; height: 3px; border-radius: 999px; background: color-mix(in srgb, var(--ui-lcs-filling) 55%, var(--ui-lcs-tray)); }
.ui-lcs__more { margin-top: 10px; }
.ui-lcs__summary { display: flex; align-items: center; gap: 6px; padding: 7px 4px; border-radius: 6px; color: var(--ui-lcs-muted); font-size: 11px; cursor: pointer; list-style: none; }
.ui-lcs__summary::-webkit-details-marker { display: none; }
.ui-lcs__summary > svg { flex: none; width: 14px; height: 14px; transition: transform 160ms ease; }
.ui-lcs__more[open] > .ui-lcs__summary > svg { transform: rotate(90deg); }
.ui-lcs__more-count { margin-inline-start: auto; font-variant-numeric: tabular-nums; }
.ui-lcs__extra { display: grid; gap: 6px; padding: 2px; }
.ui-lcs__sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
@media (prefers-reduced-motion: reduce) {
  .ui-lcs__slot, .ui-lcs__summary > svg { transition: none; }
}
@media (forced-colors: active) {
  .ui-lcs__slot[data-selected] { outline: 2px solid Highlight; outline-offset: -2px; }
  .ui-lcs__slot[data-recent] { border-color: Highlight; }
}
:where(.dark, [data-theme="dark"]) .ui-lcs {
  --ui-lcs-ink: var(--aui-ink, #ededed);
  --ui-lcs-muted: var(--aui-muted, #a1a1a6);
  --ui-lcs-surface: var(--aui-surface, #19191b);
  --ui-lcs-tray: var(--aui-subtle, #111113);
  --ui-lcs-line: var(--aui-border, #2a2a2e);
  --ui-lcs-line-strong: var(--aui-border-strong, #3a3a40);
  --ui-lcs-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
  --ui-lcs-bread: var(--aui-warning-soft, #3a2610);
  --ui-lcs-filling: var(--aui-success, #5fc88a);
  --ui-lcs-selected: #26262a;
}
`
