'use client'

import { useEffect, useRef, useState } from 'react'

export type SandwichBubbleProps = {
  activeCount: number
  pulseKey: number
  /** the color of the terminal you are chatting in; changes when you move to another one */
  chatColor?: string
  /** a short name for that terminal, for the tooltip */
  chatName?: string
  onOpen(): void
  onDragStart(): void
  /** right-click: the bubble's menu (hide, quit) */
  onMenu?(): void
}

/** The floating, collapsed hoochi window. The host supplies the native window drag. */
export function SandwichBubble({
  activeCount,
  pulseKey,
  chatColor,
  chatName,
  onOpen,
  onDragStart,
  onMenu,
}: SandwichBubbleProps) {
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const previousPulse = useRef(pulseKey)
  const [pulse, setPulse] = useState(0)
  const [glowing, setGlowing] = useState(false)

  useEffect(() => {
    if (Object.is(previousPulse.current, pulseKey)) return
    previousPulse.current = pulseKey
    setPulse(value => value + 1)
    setGlowing(true)
    const timeout = window.setTimeout(() => setGlowing(false), 650)
    return () => window.clearTimeout(timeout)
  }, [pulseKey])

  const count = Number.isFinite(activeCount) ? Math.max(0, Math.floor(activeCount)) : 0

  return (
    <>
      {/* React 19 hoists this into <head> once, even with multiple bubbles. */}
      <style href="ui-sandwich-bubble" precedence="default">
        {css}
      </style>
      <button
        type="button"
        className="ui-swb"
        aria-label={count ? `Open hoochi, ${count} enabled items` : 'Open hoochi'}
        title="Open hoochi · drag to move"
        data-glowing={glowing ? '' : undefined}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0 || pointer.current) return
          pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          suppressClick.current = false
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          const start = pointer.current
          if (!start || start.id !== event.pointerId) return
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4) return
          // Clear tracking before the host takes over; a native drag may cancel capture.
          pointer.current = null
          suppressClick.current = true
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          onDragStart()
        }}
        onPointerUp={event => {
          if (pointer.current?.id === event.pointerId) pointer.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={event => {
          if (pointer.current?.id !== event.pointerId) return
          pointer.current = null
          suppressClick.current = true
        }}
        onLostPointerCapture={event => {
          if (pointer.current?.id !== event.pointerId) return
          pointer.current = null
          suppressClick.current = true
        }}
        onContextMenu={event => {
          event.preventDefault()
          onMenu?.()
        }}
        onClick={event => {
          // Native button activation supplies Enter/Space and assistive-technology clicks.
          if (event.detail !== 0 && suppressClick.current) {
            event.preventDefault()
            return
          }
          onOpen()
        }}
      >
        {glowing && <span key={pulse} className="ui-swb__pulse" aria-hidden="true" />}
        <svg className="ui-swb__sandwich" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
          {/* Two slices of loaf bread with HOOK as the filling (assets/icon.svg) */}
          <g transform="translate(1.4 6.2) scale(.05)">
            <g fill="#f6e4c0" stroke="#b9793a" strokeWidth="10" strokeLinejoin="round">
              <path d="M84 5H724Q739 5 739 20V66Q739 72 733 77L661 137Q655 141 646 141H20Q5 141 5 126V78Q5 71 12 65L74 10Q79 5 84 5Z" />
              <path d="M8 75H656L736 10M656 75V140" fill="none" strokeWidth="8" />
            </g>
            <g
              transform="translate(10 168) scale(1 1.075)"
              fill="#3fa34d"
              stroke="#1f5c2b"
              strokeWidth="9"
              strokeLinejoin="round"
              paintOrder="stroke fill"
              fillRule="evenodd"
            >
              <path d="M0 0H45V75H101V0H146V208H101V133H45V208H0Z" />
              <path d="M225 0H279Q337 0 337 58V150Q337 208 279 208H225Q167 208 167 150V58Q167 0 225 0ZM233 46Q214 46 214 67V141Q214 162 233 162H271Q290 162 290 141V67Q290 46 271 46Z" />
              <path d="M415 0H469Q527 0 527 58V150Q527 208 469 208H415Q357 208 357 150V58Q357 0 415 0ZM423 46Q404 46 404 67V141Q404 162 423 162H461Q480 162 480 141V67Q480 46 461 46Z" />
              <path d="M549 0H595V78L657 0H716L635 99L724 208H664L605 136L595 149V208H549Z" />
            </g>
            <g transform="translate(0 406)">
              <g fill="#f6e4c0" stroke="#b9793a" strokeWidth="10" strokeLinejoin="round">
                <path d="M84 5H724Q739 5 739 20V66Q739 72 733 77L661 137Q655 141 646 141H20Q5 141 5 126V78Q5 71 12 65L74 10Q79 5 84 5Z" />
                <path d="M8 75H656L736 10M656 75V140" fill="none" strokeWidth="8" />
              </g>
            </g>
          </g>
        </svg>
        {chatColor && (
          <span
            key={chatColor}
            className="ui-swb__chat"
            style={{ background: chatColor }}
            title={chatName}
            aria-hidden="true"
          />
        )}
        {count > 0 && (
          <span className="ui-swb__count" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
    </>
  )
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-swb {
  --ui-swb-ink: var(--aui-ink, #171717);
  --ui-swb-surface: var(--aui-surface, #ffffff);
  --ui-swb-line: var(--aui-border-strong, #d9d9d9);
  --ui-swb-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-swb-bun: var(--aui-warning-soft, #fff1e0);
  --ui-swb-crust: var(--aui-warning, #b25e00);
  --ui-swb-filling: var(--aui-success, #1e8a4f);
  --ui-swb-shadow: 0 3px 8px rgba(0, 0, 0, 0.12), 0 10px 24px rgba(0, 0, 0, 0.1);
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: none;
  box-sizing: border-box;
  width: 56px;
  height: 56px;
  padding: 8px;
  margin: 0;
  border: 1px solid var(--ui-swb-line);
  border-radius: 50%;
  background: var(--ui-swb-surface);
  color: var(--ui-swb-ink);
  box-shadow: var(--ui-swb-shadow);
  font-family: var(--aui-font, "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  -webkit-font-smoothing: antialiased;
  transition: border-color 160ms ease, background-color 160ms ease;
}
.ui-swb *, .ui-swb *::before, .ui-swb *::after { box-sizing: border-box; }
.ui-swb:hover { border-color: var(--ui-swb-crust); }
.ui-swb:focus-visible { outline: 2px solid var(--ui-swb-focus); outline-offset: 3px; }
.ui-swb__sandwich { display: block; width: 38px; height: 38px; pointer-events: none; }
.ui-swb__chat {
  position: absolute;
  bottom: -2px;
  left: -2px;
  width: 16px;
  height: 16px;
  border: 2px solid var(--ui-swb-surface);
  border-radius: 999px;
  animation: ui-swb-chat 900ms cubic-bezier(0.25, 1, 0.5, 1);
}
@keyframes ui-swb-chat {
  0% { transform: scale(0.2); }
  45% { transform: scale(1.5); }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .ui-swb__chat { animation: none; }
}
.ui-swb__count {
  position: absolute;
  top: -3px;
  right: -3px;
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border: 2px solid var(--ui-swb-surface);
  border-radius: 999px;
  background: var(--ui-swb-ink);
  color: var(--ui-swb-surface);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.ui-swb__pulse {
  position: absolute;
  inset: -1px;
  border: 2px solid var(--ui-swb-focus);
  border-radius: inherit;
  box-shadow: 0 0 12px var(--ui-swb-focus);
  pointer-events: none;
  animation: ui-swb-pulse 650ms ease-out both;
}
@keyframes ui-swb-pulse {
  from { transform: scale(1); opacity: 0.9; }
  to { transform: scale(1.18); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-swb { transition: none; }
  .ui-swb__pulse { animation: none; opacity: 0.65; }
}
@media (forced-colors: active) {
  .ui-swb { border-color: ButtonText; }
  .ui-swb__bun, .ui-swb__seeds { stroke: ButtonText; }
  .ui-swb__filling { fill: ButtonText; }
  .ui-swb__count { background: Highlight; color: HighlightText; }
}
:where(.dark, [data-theme="dark"]) .ui-swb {
  --ui-swb-ink: var(--aui-ink, #ededed);
  --ui-swb-surface: var(--aui-surface, #19191b);
  --ui-swb-line: var(--aui-border-strong, #3a3a40);
  --ui-swb-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
  --ui-swb-bun: var(--aui-warning-soft, #3a2610);
  --ui-swb-crust: var(--aui-warning, #ffb35c);
  --ui-swb-filling: var(--aui-success, #5fc88a);
  --ui-swb-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 4px 12px rgba(0, 0, 0, 0.4), 0 12px 28px rgba(0, 0, 0, 0.3);
}
`
