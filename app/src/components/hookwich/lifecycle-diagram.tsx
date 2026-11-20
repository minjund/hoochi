import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { eventHint, eventName, subtitleOf, UI, type Lang } from '../../lib/i18n'
import { type Activity, type Item } from '../../lib/lifecycle'

export type LifecycleDiagramProps = {
  /** whose picture it is; wording says Codex on the Codex picture */
  agent?: 'claude' | 'codex'
  layout: DiagramLayout
  items: Item[]
  activity: Activity
  selectedEvent: string | null
  onSelect(event: string): void
  /** the language the labels are drawn in */
  lang: Lang
  /** hooks already set up outside hookwich, per event: drawn as a grey number at the top left */
  existing?: Readonly<Record<string, number>>
  /** what a moment holds, shown in a card while the pointer rests on its box */
  describe?(event: string): ReactNode
  /** what /context shows for the chat in view, drawn at the moments it fills up */
  context?: ContextFill
  /** moments that cannot run on this account (sec-default passes their classic hook by): dimmed */
  unreachable?: ReadonlySet<string>
}

/** The context window at a glance: what is in it, what came in at the start, what the talk took. */
export type ContextFill = {
  used: number
  max: number
  percent: number
  /** the token count where it compacts itself; absent when auto-compaction is off */
  compactAt?: number
  /** what the chat starts with: system prompt, tools, memory files, skills, agents */
  loaded: number
  /** what was said and what the tools gave back */
  messages: number
}

/** 61400 → "61.4k", 1000000 → "1M" */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

type Tone = 'neutral' | 'green' | 'yellow' | 'pink' | 'side' | 'tool'
type Box = {
  x: number
  y: number
  width: number
  height?: number
  events: readonly string[]
  tone: Tone
  /** Non-event boxes display a localized UI label and have no click target. */
  labelKey?: 'toolRuns' | 'modelThinks'
}

type DiagramLabel = {
  key: 'turn' | 'loop' | 'resumed' | 'anytime'
  tone: 'turn' | 'agent' | 'resume' | 'anytime'
  x: number
  y: number
  lineHeight?: number
  rotation?: number
  textAnchor?: 'start' | 'middle' | 'end'
}

/** All figure-specific geometry; coordinates are SVG drawing units. */
export type DiagramLayout = {
  viewBox: readonly [x: number, y: number, width: number, height: number]
  title: string
  boxes: readonly Box[]
  downward: readonly { x: number; start: number; tip: number }[]
  /** Optional toY/bendX route a dashed side arrow into a nearby row. */
  sideArrows: readonly { from: number; to: number; y: number; toY?: number; bendX?: number }[]
  loops: readonly { tone: 'orange' | 'blue' | 'resume'; path: string; head: string }[]
  containers: readonly {
    tone: 'turn' | 'agent' | 'anytime'
    x: number
    y: number
    width: number
    height: number
  }[]
  /** Label keys reference UI[lang], including the rotated resumed label. */
  labels: readonly DiagramLabel[]
  /** Where the context figures go: beside the start, under the loop, in the compaction box. */
  context?: {
    total: readonly [x: number, y: number]
    loaded: readonly [x: number, y: number]
    messages: readonly [x: number, y: number]
    compact: {
      box: readonly [x: number, y: number, width: number, height: number]
      text: readonly [x: number, y: number]
    }
  }
}

// The original Claude figure's 520 × 1336 geometry, with the "anytime" moments moved into a band below.
export const CLAUDE_LAYOUT: DiagramLayout = {
  viewBox: [0, 0, 520, 1400],
  title: 'Claude Code hooks lifecycle',
  boxes: [
    { x: 15, y: 25, width: 115, events: ['Setup'], tone: 'side' },
    { x: 160, y: 25, width: 190, events: ['SessionStart'], tone: 'green' },
    { x: 160, y: 98, width: 190, events: ['UserPromptSubmit'], tone: 'neutral' },
    {
      x: 15,
      y: 98,
      width: 127,
      events: ['UserPromptExpansion'],
      tone: 'side',
    },
    { x: 160, y: 210, width: 190, events: ['PreToolUse'], tone: 'yellow' },
    { x: 160, y: 283, width: 190, events: ['PermissionRequest'], tone: 'yellow' },
    {
      x: 15,
      y: 283,
      width: 115,
      events: ['PermissionDenied'],
      tone: 'side',
    },
    { x: 15, y: 332, width: 115, events: ['Elicitation'], tone: 'side' },
    { x: 15, y: 380, width: 115, events: ['ElicitationResult'], tone: 'side' },
    { x: 160, y: 356, width: 190, events: [], labelKey: 'toolRuns', tone: 'tool' },
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
    // Moments with no fixed place in the order: the official figure stacks them at the bottom
    // left, which reads as if they came after Stop. hookwich gathers them in an "anytime" band.
    { x: 24, y: 1206, width: 150, events: ['InstructionsLoaded'], tone: 'side' },
    { x: 186, y: 1206, width: 150, events: ['WorktreeCreate'], tone: 'side' },
    { x: 348, y: 1206, width: 150, events: ['ConfigChange'], tone: 'side' },
    { x: 24, y: 1262, width: 150, events: ['Notification'], tone: 'side' },
    { x: 186, y: 1262, width: 150, events: ['MessageDisplay'], tone: 'side' },
    { x: 348, y: 1262, width: 150, events: ['PreModelSwitch'], tone: 'side' },
    { x: 24, y: 1318, width: 150, events: ['PostModelSwitch'], tone: 'side' },
    {
      x: 186,
      y: 1318,
      width: 150,
      height: 54,
      events: ['CwdChanged', 'FileChanged', 'DirectoryAdded'],
      tone: 'side',
    },
    { x: 348, y: 1318, width: 150, events: ['WorktreeRemove'], tone: 'side' },
  ],
  downward: [
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
  ].map(([start, tip]) => ({ x: 255, start, tip })),
  sideArrows: [
    { from: 130, to: 160, y: 46 },
    { from: 160, to: 138, y: 119 },
    { from: 160, to: 126, y: 304 },
    { from: 130, to: 160, y: 377 },
  ],
  loops: [
    { tone: 'orange', path: 'M350 742H410V231H362', head: 'M350 231l12-7v14Z' },
    { tone: 'blue', path: 'M350 831H450V119H362', head: 'M350 119l12-7v14Z' },
    { tone: 'resume', path: 'M350 1123H475V46H362', head: 'M350 46l12-8v16Z' },
  ],
  containers: [
    { tone: 'turn', x: 44, y: 88, width: 420, height: 775 },
    { tone: 'agent', x: 60, y: 158, width: 380, height: 610 },
    { tone: 'anytime', x: 8, y: 1170, width: 504, height: 216 },
  ],
  labels: [
    { key: 'loop', tone: 'agent', x: 85, y: 185, lineHeight: 17 },
    { key: 'turn', tone: 'turn', x: 69, y: 785, lineHeight: 17 },
    { key: 'anytime', tone: 'anytime', x: 24, y: 1194 },
    { key: 'resumed', tone: 'resume', x: 483, y: 564, rotation: -90, textAnchor: 'middle' },
  ],
  context: {
    total: [366, 64],
    loaded: [248, 81],
    messages: [72, 228],
    compact: { box: [160, 956, 190, 42], text: [358, 974] },
  },
}

/** Codex flow: https://learn.chatgpt.com/docs/hooks (no official figure). */
export const CODEX_LAYOUT: DiagramLayout = {
  viewBox: [0, 0, 520, 1065],
  title: 'Codex CLI hooks lifecycle',
  boxes: [
    { x: 160, y: 25, width: 190, events: ['SessionStart'], tone: 'green' },
    { x: 160, y: 98, width: 190, events: ['UserPromptSubmit'], tone: 'yellow' },
    { x: 160, y: 210, width: 190, events: ['PreModelRequest'], tone: 'neutral' },
    { x: 160, y: 283, width: 190, events: [], labelKey: 'modelThinks', tone: 'tool' },
    { x: 160, y: 356, width: 190, events: ['PostModelRequest'], tone: 'neutral' },
    { x: 160, y: 429, width: 190, events: ['PreToolUse'], tone: 'yellow' },
    { x: 160, y: 502, width: 190, events: ['PermissionRequest'], tone: 'neutral' },
    { x: 160, y: 575, width: 190, events: [], labelKey: 'toolRuns', tone: 'tool' },
    { x: 160, y: 648, width: 190, events: ['PostToolUse'], tone: 'yellow' },
    { x: 15, y: 393, width: 115, events: ['SubagentStart'], tone: 'side' },
    { x: 15, y: 447, width: 115, events: ['SubagentStop'], tone: 'side' },
    { x: 160, y: 766, width: 190, events: ['Stop'], tone: 'pink' },
    { x: 15, y: 766, width: 115, events: ['Interrupt'], tone: 'side' },
    { x: 160, y: 852, width: 190, events: ['PreCompact'], tone: 'neutral' },
    { x: 160, y: 925, width: 190, events: ['PostCompact'], tone: 'neutral' },
    { x: 160, y: 998, width: 190, events: ['SessionEnd'], tone: 'neutral' },
  ],
  downward: [
    [67, 96],
    [140, 208],
    [252, 281],
    [325, 354],
    [398, 427],
    [471, 500],
    [544, 573],
    [617, 646],
    [690, 764],
    [808, 850],
    [894, 923],
    [967, 996],
  ].map(([start, tip]) => ({ x: 255, start, tip })),
  sideArrows: [
    { from: 130, to: 160, y: 414, toY: 440, bendX: 145 },
    { from: 130, to: 160, y: 468, toY: 460, bendX: 145 },
    { from: 130, to: 160, y: 787 },
  ],
  loops: [
    { tone: 'orange', path: 'M350 669H410V231H362', head: 'M350 231l12-7v14Z' },
    { tone: 'blue', path: 'M350 787H450V119H362', head: 'M350 119l12-7v14Z' },
    { tone: 'resume', path: 'M350 1019H475V46H362', head: 'M350 46l12-8v16Z' },
  ],
  containers: [
    { tone: 'turn', x: 2, y: 88, width: 462, height: 731 },
    { tone: 'agent', x: 8, y: 158, width: 432, height: 537 },
  ],
  labels: [
    { key: 'loop', tone: 'agent', x: 30, y: 185, lineHeight: 17 },
    { key: 'turn', tone: 'turn', x: 30, y: 719, lineHeight: 17 },
    { key: 'resumed', tone: 'resume', x: 483, y: 532, rotation: -90, textAnchor: 'middle' },
  ],
}

const styles = `
.ui-lcd-diagram {
  --ui-lcd-bg: #F9F9F7; --ui-lcd-ink: #1E1E1E;
  --ui-lcd-neutral: #EDEDEB; --ui-lcd-border: #D5D5D0;
  --ui-lcd-muted: #757575; --ui-lcd-subtle: #9E9E9E; --ui-lcd-side-border: #B0B0B0;
  --ui-lcd-green: #B8D8BE; --ui-lcd-green-border: #8FBF97; --ui-lcd-green-ink: #2D5A34;
  --ui-lcd-yellow: #FFF8E1; --ui-lcd-orange: #D4A27F;
  --ui-lcd-blue: #4A8DB8; --ui-lcd-tool: #6AABD2;
  --ui-lcd-pink: #F8D0D0; --ui-lcd-pink-border: #E0A0A0; --ui-lcd-resume: #333333;
  --ui-lcd-hover: #4A8DB8; --ui-lcd-glow: #429EFF; --ui-lcd-badge-ink: #FFFFFF; --ui-lcd-card-bg: #FFFFFF;
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
  --ui-lcd-hover: #8BCBFF; --ui-lcd-glow: #69B6FF; --ui-lcd-badge-ink: #191B1D; --ui-lcd-card-bg: #24262B;
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
.ui-lcd-anytime { stroke: var(--ui-lcd-side-border); }
.ui-lcd-container-label { font-size: 14px; font-weight: 800; letter-spacing: 2px; pointer-events: none; }
.ui-lcd-turn-label { fill: var(--ui-lcd-blue); }
.ui-lcd-agent-label { fill: var(--ui-lcd-orange); }
.ui-lcd-anytime-label { fill: var(--ui-lcd-muted); font-size: 12px; letter-spacing: 1px; }
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
.ui-lcd-off { opacity: .38; }
.ui-lcd-wrap { position: relative; }
.ui-lcd-card {
  position: fixed; box-sizing: border-box; z-index: 30; width: min(300px, calc(100vw - 16px)); padding: 10px 12px; border-radius: 12px;
  pointer-events: auto;
  /* cut to the room beside its box when it is placed; only then would it scroll */
  max-height: calc(100vh - 16px); overflow-y: auto; overscroll-behavior: contain;
  background: var(--hw-card, #ffffff); color: var(--hw-ink, #191b1d);
  border: 1px solid var(--hw-line-strong, rgba(0,0,0,.16)); box-shadow: 0 8px 24px rgba(0,0,0,.22);
  font: 12px/1.45 system-ui, -apple-system, sans-serif; text-align: left;
}
.ui-lcd-badge-existing { fill: var(--ui-lcd-muted); stroke: var(--ui-lcd-bg); stroke-width: 1.5; pointer-events: none; }
.ui-lcd-badge-text { fill: var(--ui-lcd-badge-ink); font-size: 10px; font-weight: 700; pointer-events: none; }
.ui-lcd-badge-text-disabled { fill: var(--ui-lcd-muted); }
.ui-lcd-ctx { fill: var(--ui-lcd-muted); font-size: 12.5px; pointer-events: none; }
.ui-lcd-ctx-strong { fill: var(--ui-lcd-ink); font-size: 14px; font-weight: 700; pointer-events: none; }
.ui-lcd-ctx-track { fill: var(--ui-lcd-border); pointer-events: none; }
.ui-lcd-ctx-fill { fill: var(--ui-lcd-blue); pointer-events: none; transition: width 400ms ease-out; }
.ui-lcd-ctx[data-near], .ui-lcd-ctx-strong[data-near] { fill: #C2410C; }
.ui-lcd-ctx-fill[data-near] { fill: #EA580C; }
:where(.dark, [data-theme="dark"]) .ui-lcd-ctx[data-near], :where(.dark, [data-theme="dark"]) .ui-lcd-ctx-strong[data-near] { fill: #FDBA74; }
@keyframes ui-lcd-fired { 0%, 20% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .ui-lcd-hover, .ui-lcd-ctx-fill { transition: none; }
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

const NONE: ReadonlySet<string> = new Set()

export function LifecycleDiagram({
  layout,
  items,
  activity,
  selectedEvent,
  onSelect,
  lang,
  agent = 'claude',
  existing = {},
  describe,
  context,
  unreachable: off = NONE,
}: LifecycleDiagramProps) {
  // The hover card floats over the whole window (not inside the scrolling picture), so it is
  // never cut off and never scrolls: it is measured, then put where all of it fits.
  const wrap = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [hover, setHover] = useState<{ event: string; cx: number; top: number; bottom: number } | null>(null)
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number } | null>(null)
  // The card stays while the pointer is on it, so what is in it can be read and pressed.
  const closing = useRef<number | undefined>(undefined)
  const keepCard = () => window.clearTimeout(closing.current)
  const closeCard = (event?: string) => {
    keepCard()
    closing.current = window.setTimeout(
      () => setHover(h => (event === undefined || h?.event === event ? null : h)),
      220,
    )
  }
  useEffect(() => () => window.clearTimeout(closing.current), [])
  const showCard = (event: string, el: Element) => {
    keepCard()
    if (!describe) return
    const box = el.getBoundingClientRect()
    setHover({ event, cx: box.left + box.width / 2, top: box.top, bottom: box.bottom })
  }
  // Below the box when it fits there, else above; when it fits on neither side, on the side with
  // more room, cut to that room (it scrolls inside), so it never covers the box and the box can
  // still be pressed. Again whenever the card changes size (its figures update while it is open).
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!hover || !el) {
      setPlace(null)
      return
    }
    const fit = () => {
      const card = el.getBoundingClientRect()
      const gap = 6
      const edge = 8
      // the card's whole height, even while it is cut short (scrollHeight leaves out the border)
      const whole = el.scrollHeight + (card.height - el.clientHeight)
      const roomBelow = window.innerHeight - edge - (hover.bottom + gap)
      const roomAbove = hover.top - gap - edge
      const side = whole <= roomBelow ? 'below' : whole <= roomAbove || roomAbove > roomBelow ? 'above' : 'below'
      const maxHeight = Math.max(0, Math.floor(side === 'below' ? roomBelow : roomAbove))
      const height = Math.min(whole, maxHeight)
      const top = side === 'below' ? hover.bottom + gap : hover.top - gap - height
      const left = Math.max(edge, Math.min(hover.cx - card.width / 2, window.innerWidth - edge - card.width))
      setPlace(p =>
        p && Math.abs(p.left - left) < 0.5 && Math.abs(p.top - top) < 0.5 && p.maxHeight === maxHeight
          ? p
          : { left, top, maxHeight },
      )
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(el)
    return () => watch.disconnect()
  }, [hover])
  // The picture scrolling under a card that floats would leave it pointing at nothing.
  useEffect(() => {
    if (!hover) return
    const scroller = wrap.current?.closest('.hw-body')
    const close = () => setHover(null)
    scroller?.addEventListener('scroll', close, { passive: true })
    return () => scroller?.removeEventListener('scroll', close)
  }, [hover])
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
      `${eventName(event, lang, agent)} (${event})${note ? ` · ${note}` : ''}`,
      eventHint(event, lang, agent),
      t.fired(activity.counts[event] ?? 0),
      existing[event] ? `${t.existingTitle}: ${existing[event]}` : '',
      off.has(event) ? t.blockedShort : '',
    ]
      .filter(Boolean)
      .join('\n')
    const disabledOnly = count?.enabled === 0
    const badgeText = String(count?.enabled ?? 0)
    const badgeRadius = compact ? 5 : Math.max(7, badgeText.length * 2.7 + 2)
    const badgeX = x + width - (compact ? 6 : 7)
    const badgeY = y + (compact ? 4 : 6)
    const already = existing[event] ?? 0
    const alreadyText = String(already)
    const alreadyRadius = compact ? 5 : Math.max(7, alreadyText.length * 2.7 + 2)
    const alreadyX = x + (compact ? 6 : 7)
    return (
      <g
        key={event}
        className={`ui-lcd-target${off.has(event) ? ' ui-lcd-off' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={title}
        aria-pressed={selectedEvent === event}
        data-event={event}
        onClick={() => onSelect(event)}
        onMouseEnter={e => showCard(event, e.currentTarget)}
        onMouseLeave={() => closeCard(event)}
        onFocus={e => showCard(event, e.currentTarget)}
        onBlur={() => closeCard(event)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (!e.repeat) onSelect(event)
          }
        }}
      >
        {!describe && <title>{title}</title>}
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
        {already > 0 && (
          <g aria-hidden="true">
            <circle className="ui-lcd-badge-existing" cx={alreadyX} cy={badgeY} r={alreadyRadius} />
            <text
              className="ui-lcd-badge-text"
              x={alreadyX}
              y={badgeY}
              dy=".35em"
              textAnchor="middle"
              style={compact ? { fontSize: 7 } : undefined}
            >
              {alreadyText}
            </text>
          </g>
        )}
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
              style={compact ? { fontSize: 7 } : undefined}
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
    const size = narrow ? 12 : 13
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
      <g key={events[0] ?? box.labelKey} className={`ui-lcd-${box.tone}`}>
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
                  className={`ui-lcd-label${off.has(event) ? ' ui-lcd-off' : ''}`}
                  style={{ fontSize: 10.5 }}
                  x={center}
                  y={y + 11 + index * 12.5}
                  textAnchor="middle"
                >
                  {wrapLabel(eventName(event, lang, agent), width - 8, 10.5, 1)[0]}
                </text>
              ))
            : events.length === 0
              ? labelLines(
                  box.labelKey === 'modelThinks' ? t.modelThinks : t.toolRuns,
                  center,
                  y,
                  height,
                  width,
                  false,
                )
              : events.map((event, index) => {
                  const w = width / events.length
                  return (
                    <g key={event} className={off.has(event) ? 'ui-lcd-off' : undefined}>
                      {labelLines(
                        eventName(event, lang, agent),
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

  function renderLabel({ key, tone, x, y, lineHeight = 17, rotation, textAnchor }: DiagramLabel) {
    const value = t[key]
    const lines = typeof value === 'string' ? [value] : value
    return (
      <text
        key={key}
        className={tone === 'resume' ? 'ui-lcd-resume-label' : `ui-lcd-container-label ui-lcd-${tone}-label`}
        x={x}
        y={y}
        textAnchor={textAnchor}
        transform={rotation === undefined ? undefined : `rotate(${rotation} ${x} ${y})`}
      >
        {lines[0]}
        {lines.slice(1).map((line, index) => (
          <tspan key={index} x={x} dy={lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    )
  }

  /** The context figures, laid on the picture where the window fills up. */
  function renderContext() {
    const at = layout.context
    if (!at || !context) return null
    const goal = context.compactAt ?? context.max
    const near = context.used >= goal * 0.9 || undefined
    const [bx, by, bw, bh] = at.compact.box
    const track = bw - 16
    return (
      <g aria-hidden="true" pointerEvents="none">
        <text className="ui-lcd-ctx-strong" data-near={near} x={at.total[0]} y={at.total[1]}>
          {context.percent}%
        </text>
        <text className="ui-lcd-ctx" x={at.total[0]} y={at.total[1] + 15}>
          {tokens(context.used)} / {tokens(context.max)}
        </text>
        <text className="ui-lcd-ctx" x={at.loaded[0]} y={at.loaded[1]} textAnchor="end">
          {t.ctxLoaded(tokens(context.loaded))}
        </text>
        <text className="ui-lcd-ctx" x={at.messages[0]} y={at.messages[1]}>
          {t.ctxMessagesShort}
        </text>
        <text className="ui-lcd-ctx-strong" x={at.messages[0]} y={at.messages[1] + 17}>
          {tokens(context.messages)}
        </text>
        <rect className="ui-lcd-ctx-track" x={bx + 8} y={by + bh - 7} width={track} height={3.5} rx={1.75} />
        <rect
          className="ui-lcd-ctx-fill"
          data-near={near}
          x={bx + 8}
          y={by + bh - 7}
          width={track * Math.min(1, context.used / Math.max(goal, 1))}
          height={3.5}
          rx={1.75}
        />
        <text className="ui-lcd-ctx-strong" data-near={near} x={at.compact.text[0]} y={at.compact.text[1]}>
          {tokens(context.used)} / {tokens(goal)}
        </text>
        <text className="ui-lcd-ctx" x={at.compact.text[0]} y={at.compact.text[1] + 16}>
          {context.compactAt === undefined ? t.ctxCompactOff : t.ctxCompactHere}
        </text>
      </g>
    )
  }

  return (
    <div className="ui-lcd-wrap" ref={wrap}>
      <style href="ui-lcd-lifecycle-diagram" precedence="default">
        {styles}
      </style>
      <svg
        className="ui-lcd-diagram"
        viewBox={layout.viewBox.join(' ')}
        width={layout.viewBox[2]}
        height={layout.viewBox[3]}
        xmlns="http://www.w3.org/2000/svg"
        role="group"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
      >
        <title id={`${id}-title`}>{layout.title}</title>
        <desc id={`${id}-description`}>
          Select a hook event to edit its items. Tab moves between events; Enter or Space selects one. Badges
          count enabled items. A hollow badge means all items are disabled. A grey badge at the top left
          counts hooks already set up outside hookwich.
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
        <rect
          className="ui-lcd-backdrop"
          x={layout.viewBox[0]}
          y={layout.viewBox[1]}
          width={layout.viewBox[2]}
          height={layout.viewBox[3]}
          rx={8}
        />
        <g aria-hidden="true" pointerEvents="none">
          {layout.containers.map(({ tone, ...rect }) => (
            <rect key={tone} className={`ui-lcd-container ui-lcd-${tone}`} {...rect} rx={8} />
          ))}
          {layout.labels.filter(label => label.tone !== 'resume').map(renderLabel)}
          {layout.downward.map(({ x, start, tip }) => (
            <g key={`${x}-${start}`}>
              <path className="ui-lcd-arrow" d={`M${x} ${start}V${tip - 8}`} />
              <path className="ui-lcd-arrow-head" d={`M${x - 7} ${tip - 12}l7 12 7-12Z`} />
            </g>
          ))}
          {layout.sideArrows.map(({ from, to, y, toY = y, bendX = (from + to) / 2 }) => {
            const direction = to > from ? 1 : -1
            const bend = toY === y ? '' : `H${bendX}V${toY}`
            return (
              <g key={`${from}-${y}-${to}-${toY}`}>
                <path
                  className="ui-lcd-arrow ui-lcd-side-arrow"
                  d={`M${from} ${y}${bend}H${to - direction * 4}`}
                />
                <path className="ui-lcd-side-head" d={`M${to} ${toY}l${-direction * 10}-5v10Z`} />
              </g>
            )
          })}
          {layout.loops.map(({ tone, path, head }) => (
            <g key={tone}>
              <path className={`ui-lcd-loop-arrow ui-lcd-loop-${tone}`} d={path} />
              <path className={`ui-lcd-head-${tone}`} d={head} />
            </g>
          ))}
          {layout.labels.filter(label => label.tone === 'resume').map(renderLabel)}
        </g>
        {layout.boxes.map(renderBox)}
        {renderContext()}
      </svg>
      {hover && describe && (
        <div
          ref={cardRef}
          className="ui-lcd-card"
          role="tooltip"
          style={
            place
              ? { left: place.left, top: place.top, maxHeight: place.maxHeight }
              : { left: 0, top: 0, visibility: 'hidden' }
          }
          onMouseEnter={keepCard}
          onMouseLeave={() => closeCard()}
          onFocus={keepCard}
          onBlur={() => closeCard()}
        >
          {describe(hover.event)}
        </div>
      )}
    </div>
  )
}

export default LifecycleDiagram
