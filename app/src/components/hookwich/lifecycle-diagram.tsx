import { useEffect, useId, useMemo, useReducer } from 'react'
import { eventHint, eventName, subtitleOf, UI, type Lang } from '../../lib/i18n'
import { type Activity, type Item } from '../../lib/lifecycle'

export type LifecycleDiagramProps = {
  items: Item[]
  activity: Activity
  selectedEvent: string | null
  onSelect(event: string): void
  /** the language the labels are drawn in */
  lang: Lang
}

type Tone = 'neutral' | 'green' | 'yellow' | 'pink' | 'side' | 'tool'
type Box = {
  x: number
  y: number
  width: number
  height?: number
  events: readonly string[]
  tone: Tone
  label?: string
  subtitle?: string
  lines?: readonly string[]
}

// Coordinates are in the reference figure's 520 × 1336 drawing space.
// The drawing is built from boxes and connectors, independently of its SVG source.
const boxes: readonly Box[] = [
  { x: 15, y: 25, width: 115, events: ['Setup'], tone: 'side', subtitle: '(Opt-in)' },
  { x: 160, y: 25, width: 190, events: ['SessionStart'], label: 'Session Start', tone: 'green' },
  { x: 160, y: 98, width: 190, events: ['UserPromptSubmit'], tone: 'neutral' },
  {
    x: 15,
    y: 98,
    width: 127,
    events: ['UserPromptExpansion'],
    lines: ['UserPrompt', 'Expansion'],
    subtitle: '(slash commands)',
    tone: 'side',
  },
  { x: 160, y: 210, width: 190, events: ['PreToolUse'], tone: 'yellow' },
  { x: 160, y: 283, width: 190, events: ['PermissionRequest'], tone: 'yellow' },
  {
    x: 15,
    y: 283,
    width: 115,
    events: ['PermissionDenied'],
    lines: ['Permission', 'Denied'],
    subtitle: '(auto-mode deny)',
    tone: 'side',
  },
  { x: 15, y: 332, width: 115, events: ['Elicitation'], subtitle: '(MCP input)', tone: 'side' },
  { x: 15, y: 380, width: 115, events: ['ElicitationResult'], subtitle: '(MCP input)', tone: 'side' },
  { x: 160, y: 356, width: 190, events: [], label: '[tool executes]', tone: 'tool' },
  { x: 110, y: 429, width: 290, events: ['PostToolUse', 'PostToolUseFailure'], tone: 'yellow' },
  { x: 160, y: 502, width: 190, events: ['PostToolBatch'], tone: 'yellow' },
  { x: 115, y: 575, width: 280, events: ['SubagentStart', 'SubagentStop'], tone: 'yellow' },
  { x: 160, y: 648, width: 190, events: ['TaskCreated'], tone: 'yellow' },
  { x: 160, y: 721, width: 190, events: ['TaskCompleted'], tone: 'yellow' },
  { x: 160, y: 810, width: 190, events: ['Stop', 'StopFailure'], tone: 'pink' },
  { x: 160, y: 883, width: 190, events: ['TeammateIdle'], tone: 'neutral' },
  { x: 160, y: 956, width: 190, events: ['PreCompact'], tone: 'neutral' },
  { x: 160, y: 1029, width: 190, events: ['PostCompact'], tone: 'neutral' },
  { x: 160, y: 1102, width: 190, events: ['SessionEnd'], tone: 'neutral' },
  { x: 15, y: 818, width: 115, events: ['Notification'], subtitle: '(Async)', tone: 'side' },
  { x: 15, y: 872, width: 115, events: ['ConfigChange'], subtitle: '(Async)', tone: 'side' },
  { x: 15, y: 926, width: 115, events: ['PreModelSwitch'], subtitle: '(Sequential)', tone: 'neutral' },
  { x: 15, y: 980, width: 115, events: ['PostModelSwitch'], subtitle: '(Async)', tone: 'side' },
  { x: 15, y: 1034, width: 115, events: ['WorktreeCreate'], subtitle: '(Isolation)', tone: 'side' },
  { x: 15, y: 1088, width: 115, events: ['WorktreeRemove'], subtitle: '(Teardown)', tone: 'side' },
  {
    x: 15,
    y: 1142,
    width: 115,
    height: 54,
    events: ['CwdChanged', 'FileChanged', 'DirectoryAdded'],
    subtitle: '(Env reactive)',
    tone: 'side',
  },
  { x: 15, y: 1215, width: 115, events: ['InstructionsLoaded'], subtitle: '(Async)', tone: 'side' },
  { x: 15, y: 1269, width: 115, events: ['MessageDisplay'], subtitle: '(Display)', tone: 'side' },
]

const downward = [
  [67, 96],
  [140, 182],
  [252, 281],
  [325, 354],
  [398, 427],
  [471, 500],
  [544, 573],
  [617, 646],
  [690, 719],
  [763, 808],
  [852, 881],
  [925, 954],
  [998, 1027],
  [1071, 1100],
] as const

const styles = `
.ui-lcd-diagram {
  --ui-lcd-bg: #F9F9F7; --ui-lcd-ink: #1E1E1E;
  --ui-lcd-neutral: #EDEDEB; --ui-lcd-border: #D5D5D0;
  --ui-lcd-muted: #757575; --ui-lcd-subtle: #9E9E9E; --ui-lcd-side-border: #B0B0B0;
  --ui-lcd-green: #B8D8BE; --ui-lcd-green-border: #8FBF97; --ui-lcd-green-ink: #2D5A34;
  --ui-lcd-yellow: #FFF8E1; --ui-lcd-orange: #D4A27F;
  --ui-lcd-blue: #4A8DB8; --ui-lcd-tool: #6AABD2;
  --ui-lcd-pink: #F8D0D0; --ui-lcd-pink-border: #E0A0A0; --ui-lcd-resume: #333333;
  --ui-lcd-hover: #4A8DB8; --ui-lcd-glow: #429EFF; --ui-lcd-badge-ink: #FFFFFF;
  display: block; width: 100%; height: auto; font-family: system-ui, -apple-system, sans-serif;
  isolation: isolate; color-scheme: light;
}
:where(.dark, [data-theme="dark"]) .ui-lcd-diagram {
  --ui-lcd-bg: #191B1D; --ui-lcd-ink: #F0F0EB;
  --ui-lcd-neutral: #2B2E30; --ui-lcd-border: #505458;
  --ui-lcd-muted: #BDC2C7; --ui-lcd-subtle: #A6ADB3; --ui-lcd-side-border: #737C85;
  --ui-lcd-green: #2B4935; --ui-lcd-green-border: #6F9C79; --ui-lcd-green-ink: #C8E8CE;
  --ui-lcd-yellow: #3C3524; --ui-lcd-orange: #C69A78;
  --ui-lcd-blue: #79B4DA; --ui-lcd-tool: #315F7B;
  --ui-lcd-pink: #503237; --ui-lcd-pink-border: #BF858D; --ui-lcd-resume: #D0D4D8;
  --ui-lcd-hover: #8BCBFF; --ui-lcd-glow: #69B6FF; --ui-lcd-badge-ink: #191B1D;
  color-scheme: dark;
}
.ui-lcd-backdrop { fill: var(--ui-lcd-bg); }
.ui-lcd-box { fill: var(--ui-lcd-neutral); stroke: var(--ui-lcd-border); stroke-width: 1; }
.ui-lcd-green .ui-lcd-box { fill: var(--ui-lcd-green); stroke: var(--ui-lcd-green-border); }
.ui-lcd-yellow .ui-lcd-box { fill: var(--ui-lcd-yellow); stroke: var(--ui-lcd-orange); stroke-width: 1.5; }
.ui-lcd-pink .ui-lcd-box { fill: var(--ui-lcd-pink); stroke: var(--ui-lcd-pink-border); stroke-width: 1.5; }
.ui-lcd-side .ui-lcd-box { fill: var(--ui-lcd-bg); stroke: var(--ui-lcd-side-border); stroke-width: 1.5; stroke-dasharray: 5 3; }
.ui-lcd-tool .ui-lcd-box { fill: var(--ui-lcd-tool); stroke: var(--ui-lcd-blue); }
.ui-lcd-label { fill: var(--ui-lcd-ink); font-size: 13px; font-weight: 600; pointer-events: none; }
.ui-lcd-green .ui-lcd-label { fill: var(--ui-lcd-green-ink); }
.ui-lcd-tool .ui-lcd-label { fill: #FFFFFF; }
.ui-lcd-small-label { font-size: 11px; }
.ui-lcd-side .ui-lcd-label { fill: var(--ui-lcd-muted); }
.ui-lcd-subtitle { fill: var(--ui-lcd-muted); font-size: 10px; font-weight: 400; }
.ui-lcd-side .ui-lcd-subtitle { fill: var(--ui-lcd-subtle); }
.ui-lcd-tiny-label { font-size: 10px; }
.ui-lcd-tiny-subtitle { font-size: 9px; }
.ui-lcd-container { fill: none; stroke-width: 2.5; stroke-dasharray: 6 4; }
.ui-lcd-turn { stroke: var(--ui-lcd-blue); }
.ui-lcd-agent { stroke: var(--ui-lcd-orange); }
.ui-lcd-container-label { font-size: 14px; font-weight: 800; letter-spacing: 2px; pointer-events: none; }
.ui-lcd-turn-label { fill: var(--ui-lcd-blue); }
.ui-lcd-agent-label { fill: var(--ui-lcd-orange); }
.ui-lcd-arrow { fill: none; stroke: var(--ui-lcd-muted); stroke-width: 2; }
.ui-lcd-arrow-head { fill: var(--ui-lcd-muted); }
.ui-lcd-side-arrow { stroke: var(--ui-lcd-side-border); stroke-width: 1.5; stroke-dasharray: 5 3; }
.ui-lcd-side-head { fill: var(--ui-lcd-side-border); }
.ui-lcd-loop-arrow { fill: none; stroke-width: 2; }
.ui-lcd-loop-orange { stroke: var(--ui-lcd-orange); }
.ui-lcd-loop-blue { stroke: var(--ui-lcd-blue); }
.ui-lcd-loop-resume { stroke: var(--ui-lcd-resume); stroke-width: 2.5; stroke-dasharray: 8 5; }
.ui-lcd-head-orange { fill: var(--ui-lcd-orange); }
.ui-lcd-head-blue { fill: var(--ui-lcd-blue); }
.ui-lcd-head-resume { fill: var(--ui-lcd-resume); }
.ui-lcd-split { stroke: var(--ui-lcd-orange); stroke-width: 1; opacity: .45; }
.ui-lcd-pink .ui-lcd-split { stroke: var(--ui-lcd-pink-border); }
.ui-lcd-resume-label { fill: var(--ui-lcd-muted); font-size: 11px; pointer-events: none; }
.ui-lcd-target { cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
.ui-lcd-hit { fill: transparent; pointer-events: all; }
.ui-lcd-hover { fill: var(--ui-lcd-hover); opacity: 0; transition: opacity 120ms ease; pointer-events: none; }
.ui-lcd-target:hover .ui-lcd-hover { opacity: .13; }
.ui-lcd-selection { fill: none; stroke: var(--ui-lcd-ink); stroke-width: 2; pointer-events: none; }
.ui-lcd-focus { fill: none; stroke: var(--ui-lcd-blue); stroke-width: 2.5; opacity: 0; pointer-events: none; }
.ui-lcd-target:focus-visible .ui-lcd-focus { opacity: 1; }
.ui-lcd-flash { fill: none; stroke: var(--ui-lcd-glow); stroke-width: 3; pointer-events: none; animation: ui-lcd-fired 2500ms linear both; }
.ui-lcd-badge { fill: var(--ui-lcd-ink); stroke: var(--ui-lcd-bg); stroke-width: 1.5; pointer-events: none; }
.ui-lcd-badge-disabled { fill: var(--ui-lcd-bg); stroke: var(--ui-lcd-subtle); }
.ui-lcd-badge-text { fill: var(--ui-lcd-badge-ink); font-size: 9px; font-weight: 700; pointer-events: none; }
.ui-lcd-badge-text-disabled { fill: var(--ui-lcd-muted); }
@keyframes ui-lcd-fired { 0%, 20% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .ui-lcd-hover { transition: none; }
  .ui-lcd-flash { animation: none; opacity: .8; }
}
`

/** Rough text width for system-ui: CJK glyphs are square, Latin ones about half. */
function textWidth(text: string, size: number): number {
  let w = 0
  for (const ch of text) w += ch.codePointAt(0)! >= 0x2e80 ? size : size * 0.58
  return w
}

/** Breaks a label into at most `max` lines that fit `width`, ending in … if it must. */
export function wrapLabel(text: string, width: number, size: number, max = 2): string[] {
  const hasSpaces = text.includes(' ')
  const tokens = hasSpaces ? text.split(' ') : Array.from(text)
  const glue = hasSpaces ? ' ' : ''
  const lines: string[] = []
  let line = ''
  for (const token of tokens) {
    const next = line ? line + glue + token : token
    if (textWidth(next, size) <= width || !line) {
      line = next
      continue
    }
    lines.push(line)
    line = token
  }
  if (line) lines.push(line)
  // Two lines: split where both halves are closest in width, so no word is left alone.
  if (lines.length === 2 && max >= 2 && tokens.length > 1) {
    let best: string[] = lines
    let bestWidth = Infinity
    for (let cut = 1; cut < tokens.length; cut++) {
      const a = tokens.slice(0, cut).join(glue)
      const b = tokens.slice(cut).join(glue)
      const widest = Math.max(textWidth(a, size), textWidth(b, size))
      if (widest <= width && widest < bestWidth) {
        best = [a, b]
        bestWidth = widest
      }
    }
    return best
  }
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  let last = kept[max - 1]!
  while (last.length > 1 && textWidth(last + '…', size) > width) last = last.slice(0, -1)
  kept[max - 1] = last + '…'
  return kept
}

export function LifecycleDiagram({ items, activity, selectedEvent, onSelect, lang }: LifecycleDiagramProps) {
  const t = UI[lang]
  const id = `ui-lcd-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [, redraw] = useReducer((value: number) => value + 1, 0)
  const now = Date.now()
  const elapsed = now - activity.lastAt
  const recentEvent = elapsed >= 0 && elapsed < 2500 ? activity.lastEvent : null
  const itemCounts = useMemo(() => {
    const counts = new Map<string, { total: number; enabled: number }>()
    for (const item of items) {
      const count = counts.get(item.event) ?? { total: 0, enabled: 0 }
      count.total += 1
      if (item.enabled) count.enabled += 1
      counts.set(item.event, count)
    }
    return counts
  }, [items])

  useEffect(() => {
    const remaining = activity.lastAt + 2500 - Date.now()
    if (!activity.lastEvent || remaining <= 0) return
    const timer = window.setTimeout(redraw, Math.min(remaining + 1, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [activity.lastAt, activity.lastEvent])

  function target(event: string, x: number, y: number, width: number, height: number, compact = false) {
    const count = itemCounts.get(event)
    const note = subtitleOf(event, lang)
    const title = [
      `${eventName(event, lang)} (${event})${note ? ` · ${note}` : ''}`,
      eventHint(event, lang),
      t.fired(activity.counts[event] ?? 0),
    ]
      .filter(Boolean)
      .join('\n')
    const disabledOnly = count?.enabled === 0
    const badgeText = String(count?.enabled ?? 0)
    const badgeRadius = compact ? 5 : Math.max(7, badgeText.length * 2.7 + 2)
    const badgeX = x + width - (compact ? 6 : 7)
    const badgeY = y + (compact ? 4 : 6)
    return (
      <g
        key={event}
        className="ui-lcd-target"
        role="button"
        tabIndex={0}
        aria-label={title}
        aria-pressed={selectedEvent === event}
        data-event={event}
        onClick={() => onSelect(event)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (!e.repeat) onSelect(event)
          }
        }}
      >
        <title>{title}</title>
        <rect className="ui-lcd-hit" x={x} y={y} width={width} height={height} rx={compact ? 2 : 6} />
        <rect className="ui-lcd-hover" x={x} y={y} width={width} height={height} rx={compact ? 2 : 6} />
        {recentEvent === event && (
          <rect
            key={`${event}-${activity.lastAt}`}
            className="ui-lcd-flash"
            x={x}
            y={y}
            width={width}
            height={height}
            rx={compact ? 2 : 6}
            filter={`url(#${id}-glow)`}
            style={{ animationDelay: `${-elapsed}ms` }}
          />
        )}
        {selectedEvent === event && (
          <rect className="ui-lcd-selection" x={x} y={y} width={width} height={height} rx={compact ? 2 : 6} />
        )}
        <rect
          className="ui-lcd-focus"
          x={x - 3}
          y={y - 3}
          width={width + 6}
          height={height + 6}
          rx={compact ? 3 : 8}
        />
        {count && (
          <g aria-hidden="true">
            <circle
              className={`ui-lcd-badge${disabledOnly ? ' ui-lcd-badge-disabled' : ''}`}
              cx={badgeX}
              cy={badgeY}
              r={badgeRadius}
            />
            <text
              className={`ui-lcd-badge-text${disabledOnly ? ' ui-lcd-badge-text-disabled' : ''}`}
              x={badgeX}
              y={badgeY}
              dy=".35em"
              textAnchor="middle"
              style={compact ? { fontSize: 6 } : undefined}
            >
              {badgeText}
            </text>
          </g>
        )}
      </g>
    )
  }

  /** Centered lines of a label inside one area of a box. */
  function labelLines(text: string, cx: number, top: number, height: number, width: number, narrow: boolean) {
    const size = narrow ? 11.5 : 12.5
    const lines = wrapLabel(text, width - 10, size)
    const step = size + 2
    const block = lines.length * step
    const first = top + (height - block) / 2 + size - 1
    return lines.map((line, i) => (
      <text
        key={i}
        className="ui-lcd-label"
        style={{ fontSize: size }}
        x={cx}
        y={first + i * step}
        textAnchor="middle"
      >
        {line}
      </text>
    ))
  }

  function renderBox(box: Box) {
    const { x, y, width, events } = box
    const height = box.height ?? 42
    const center = x + width / 2
    const threeLines = events.length === 3
    const offsets = [0, 15, 28, 54]
    return (
      <g key={events[0] ?? 'tool'} className={`ui-lcd-${box.tone}`}>
        <rect className="ui-lcd-box" x={x} y={y} width={width} height={height} rx={6} />
        {events.map((event, index) =>
          threeLines
            ? target(event, x, y + offsets[index]!, width, offsets[index + 1]! - offsets[index]!, true)
            : target(event, x + (index * width) / events.length, y, width / events.length, height),
        )}
        <g aria-hidden="true" pointerEvents="none">
          {threeLines
            ? events.map((event, index) => (
                <text
                  key={event}
                  className="ui-lcd-label"
                  style={{ fontSize: 9.5 }}
                  x={center}
                  y={y + 11 + index * 12.5}
                  textAnchor="middle"
                >
                  {wrapLabel(eventName(event, lang), width - 8, 9.5, 1)[0]}
                </text>
              ))
            : events.length === 0
              ? labelLines(t.toolRuns, center, y, height, width, false)
              : events.map((event, index) => {
                  const w = width / events.length
                  return (
                    <g key={event}>
                      {labelLines(
                        eventName(event, lang),
                        x + w * index + w / 2,
                        y,
                        height,
                        w,
                        box.tone === 'side',
                      )}
                      {index > 0 && (
                        <path className="ui-lcd-split" d={`M${x + w * index} ${y + 9}V${y + height - 9}`} />
                      )}
                    </g>
                  )
                })}
        </g>
      </g>
    )
  }

  return (
    <>
      <style href="ui-lcd-lifecycle-diagram" precedence="default">
        {styles}
      </style>
      <svg
        className="ui-lcd-diagram"
        viewBox="0 0 520 1336"
        width="520"
        height="1336"
        xmlns="http://www.w3.org/2000/svg"
        role="group"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
      >
        <title id={`${id}-title`}>Claude Code hooks lifecycle</title>
        <desc id={`${id}-description`}>
          Select a hook event to edit its items. Tab moves between events; Enter or Space selects one. Badges
          count enabled items. A hollow badge means all items are disabled.
        </desc>
        <defs>
          <filter
            id={`${id}-glow`}
            x="-50%"
            y="-100%"
            width="200%"
            height="300%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <rect className="ui-lcd-backdrop" width={520} height={1336} rx={8} />
        <g aria-hidden="true" pointerEvents="none">
          <rect className="ui-lcd-container ui-lcd-turn" x={44} y={88} width={420} height={775} rx={8} />
          <rect className="ui-lcd-container ui-lcd-agent" x={60} y={158} width={380} height={610} rx={8} />
          <text className="ui-lcd-container-label ui-lcd-agent-label" x={85} y={185}>
            {t.loop[0]}
            <tspan x={85} dy={17}>
              {t.loop[1]}
            </tspan>
          </text>
          <text className="ui-lcd-container-label ui-lcd-turn-label" x={69} y={785}>
            {t.turn[0]}
            <tspan x={69} dy={17}>
              {t.turn[1]}
            </tspan>
          </text>
          {downward.map(([start, tip]) => (
            <g key={start}>
              <path className="ui-lcd-arrow" d={`M255 ${start}V${tip - 8}`} />
              <path className="ui-lcd-arrow-head" d={`M248 ${tip - 12}l7 12 7-12Z`} />
            </g>
          ))}
          {[
            { from: 130, to: 160, y: 46 },
            { from: 160, to: 138, y: 119 },
            { from: 160, to: 126, y: 304 },
            { from: 130, to: 160, y: 377 },
          ].map(({ from, to, y }) => {
            const direction = to > from ? 1 : -1
            return (
              <g key={y}>
                <path className="ui-lcd-arrow ui-lcd-side-arrow" d={`M${from} ${y}H${to - direction * 4}`} />
                <path className="ui-lcd-side-head" d={`M${to} ${y}l${-direction * 10}-5v10Z`} />
              </g>
            )
          })}
          <path className="ui-lcd-loop-arrow ui-lcd-loop-orange" d="M350 742H410V231H362" />
          <path className="ui-lcd-head-orange" d="M350 231l12-7v14Z" />
          <path className="ui-lcd-loop-arrow ui-lcd-loop-blue" d="M350 831H450V119H362" />
          <path className="ui-lcd-head-blue" d="M350 119l12-7v14Z" />
          <path className="ui-lcd-loop-arrow ui-lcd-loop-resume" d="M350 1123H475V46H362" />
          <path className="ui-lcd-head-resume" d="M350 46l12-8v16Z" />
          <text
            className="ui-lcd-resume-label"
            x={483}
            y={564}
            textAnchor="middle"
            transform="rotate(-90 483 564)"
          >
            {t.resumed}
          </text>
        </g>
        {boxes.map(renderBox)}
      </svg>
    </>
  )
}

export default LifecycleDiagram
