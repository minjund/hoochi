/**
 * A sentence the person types becomes one thing to do with their rules: a new rule ("don't say
 * it's done before the tests pass": a moment and what goes in there), or a change to the rules
 * already put in (reword one, move it or copy it to another place or AI, switch some off or on,
 * delete some). The window asks this computer's Claude Code once (`ask_claude` in the app), with
 * the instructions, the rules already put in and the answer's shape built here. Without Claude
 * Code (or in the browser demo) a few ready-made rules, and switching off, on or deleting by a
 * rule's words, are matched instead.
 */
import type { Target } from './edit.ts'
import { CODEX_SLOTS, itemLabel, slotOf, type Agent, type Item, type ItemKind, type Scope, type Slot } from './lifecycle.ts'

/** `codex`: Codex has this moment too, so a rule made for it can go in for both. */
export type Moment = { event: string; name: string; hint: string; canInject: boolean; hasTools: boolean; codex?: boolean }

/** What one sentence turned into. `scope` "global": about the person, everywhere; "here": this place. */
export type Rule = {
  event: string
  kind: Exclude<ItemKind, 'rules'>
  text: string
  command: string
  skill: string
  mode: 'always' | 'onFail'
  tools: string
  once: boolean
  scope: 'here' | 'global'
  /** one sentence: why this moment */
  why: string
}

/** A new rule made of a sentence, or why not. */
export type RuleAnswer = { ok: true; rule: Rule } | { ok: false; say: string }

/** A rule already put in, as the instructions list it: `ref` is its short name there ("r3"). */
export type Known = Target & { ref: string; place: string }
/** A place a rule can go: `ref` "g" is everywhere, "p1" a project, "t1" a terminal (which belongs to one AI). */
export type PlaceOpt = { ref: string; scope: Scope; key: string; words: string; agent?: Agent }

/** What one sentence turned into. */
export type Understood =
  | { ok: true; action: 'add'; rule: Rule; place?: PlaceOpt }
  /** `item` is the rule after the change; `to` where it ends up (null place: where it is) */
  | { ok: true; action: 'change'; target: Known; item: Item; to: { agent: Agent; place: PlaceOpt | null } }
  /** `to.agent` null: each one's own AI; `to.place` null: each one's own place */
  | { ok: true; action: 'copy'; targets: Known[]; to: { agent: Agent | null; place: PlaceOpt | null } }
  | { ok: true; action: 'off' | 'on' | 'delete'; targets: Known[] }
  | { ok: false; say: string }

export const ACTIONS = ['add', 'change', 'copy', 'off', 'on', 'delete'] as const

export const MODEL = 'sonnet'

/** `extra`: more moments a rule already put in may name (Codex's own ones). */
export function schemaFor(moments: readonly Moment[], extra: readonly string[] = []): string {
  return JSON.stringify({
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      action: { type: 'string', enum: ACTIONS },
      targets: { type: 'array', items: { type: 'string' } },
      place: { type: 'string' },
      agent: { type: 'string', enum: ['', 'claude', 'codex'] },
      event: { type: 'string', enum: [...new Set([...moments.map(m => m.event), ...extra])] },
      kind: { type: 'string', enum: ['text', 'command', 'skill'] },
      text: { type: 'string' },
      command: { type: 'string' },
      skill: { type: 'string' },
      mode: { type: 'string', enum: ['always', 'onFail'] },
      tools: { type: 'string' },
      once: { type: 'boolean' },
      scope: { type: 'string', enum: ['here', 'global'] },
      why: { type: 'string' },
      say: { type: 'string' },
    },
    required: ['ok', 'action', 'targets', 'place', 'agent', 'event', 'kind', 'text', 'command', 'skill', 'mode', 'tools', 'once', 'scope', 'why', 'say'],
    additionalProperties: false,
  })
}

const LANG_NAME: Record<string, string> = { en: 'English', ko: 'Korean', ja: 'Japanese', zh: 'Chinese' }

export function systemFor(o: {
  agent: Agent
  moments: readonly Moment[]
  skills: readonly string[]
  lang: string
  /** the rules already put in, and the places they can go; without them, only new rules */
  known?: readonly Known[]
  places?: readonly PlaceOpt[]
  /** the ref of the place picked in the window */
  here?: string
}): string {
  const ai = o.agent === 'codex' ? 'Codex' : 'Claude Code'
  const both = o.agent === 'claude' && o.moments.some(m => m.codex)
  const list = o.moments
    .map(m => `- ${m.event}: "${m.name}". ${m.hint}${m.canInject ? '' : ' (words do not reach the AI here; only a command runs)'}${m.hasTools ? ' (can be limited to tools)' : ''}${both && m.codex ? ' (Codex too)' : ''}`)
    .join('\n')
  const edits = o.known !== undefined
  const head = edits
    ? `You turn one thing a person says about their AI coding agents (${ai}${both ? ', and Codex' : ''}) into ONE action on their hoochi rules: a new rule (a moment, and what goes in at that moment), or a change to the rules already put in. You never run anything; you only answer in the JSON shape.`
    : `You turn one wish a person has about their AI coding agent (${ai}${both ? ', and Codex' : ''}) into ONE hoochi rule: a moment, and what goes in at that moment. You never run anything; you only answer in the JSON shape.`
  return `${head}

Moments:
${list}
${both ? '\nThe person can put the rule in for Claude Code, Codex or both. When two moments fit equally well, pick one marked (Codex too).\n' : ''}
What can go in:
- kind "text": words handed to the AI at that moment, put in "text". For instructions and preferences (a language, a habit, "explain before deleting"). Only at moments where words reach the AI.
- kind "command": a shell command run on the person's computer at that moment, put in "command". mode "onFail": the AI sees the output only when the command fails, so use it for checks (tests, lint, type checks) so the AI fixes what fails, and for side effects (notifications, sounds, logging) so a successful run puts nothing in. mode "always": the AI always gets the output, for giving it context (git status, today's date). At "Stop" an output given to the AI makes it keep going once, so use onFail there unless the person wants that.
- kind "skill": one of the person's skills, by exact name in "skill": ${o.skills.length ? o.skills.join(', ') : '(none installed; do not use kind "skill")'}.
- "tools": only for moments that can be limited to tools; comma-separated tool names, e.g. "Bash" for shell commands, "Edit, Write" for file edits; "" for all.
- "once": true only if the person wants it once per chat.
- "scope": "global" when the wish is about the person (language, tone, notifications); "here" when it is about this project (its tests, lint, rules).

Examples:
- "don't say it's done before the tests pass" -> Stop, command "npm test", onFail, scope here.
- "always answer in Korean" -> UserPromptSubmit, text "한국어로 답해 줘.", scope global.
- "explain why before deleting anything" -> PreToolUse, tools "Bash", text "Before a command that deletes or overwrites, say why first.", scope global.
- "lint files right after editing them" -> PostToolUse, tools "Edit, Write", command "npm run lint", onFail, scope here.
- "tell me with a sound when you're done" -> Stop, command "say done" (macOS), onFail, scope global.
- "show me the branch status when a chat starts" -> SessionStart, command "git status -sb", always, scope here.

${edits ? editPart(o.known ?? [], o.places ?? [], o.here ?? '') : ''}
Write "text", "why" and "say" in ${LANG_NAME[o.lang] ?? 'English'}. "why" is one short sentence saying why this moment fits. If no rule can do what the person asks, answer ok false with a short "say" explaining what hoochi can do instead, and fill the other fields with any valid value. Otherwise ok true and "say" "".`
}

const AI_NAME: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex' }
const clip = (t: string, n = 160) => {
  const one = t.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n)}…` : one
}

/** One rule already put in, on one line, as the instructions list it. */
export function knownLine(k: Known): string {
  const i = k.item
  const what =
    i.kind === 'text'
      ? `text "${clip(i.text)}"`
      : i.kind === 'command'
        ? `command "${clip(i.command)}"${i.mode === 'onFail' ? ', only when it fails' : ', always'}`
        : i.kind === 'skill'
          ? `skill "${i.skill}"`
          : `skill rules ${clip(itemLabel(i))} (can be moved, copied, switched or deleted, not reworded)`
  const extra = [i.tools ? `tools "${i.tools}"` : '', i.once ? 'once per chat' : ''].filter(Boolean).join(', ')
  return `${k.ref} | ${AI_NAME[k.agent]} | ${k.place} | ${i.event} | ${what}${extra ? ` | ${extra}` : ''} | ${i.enabled ? 'on' : 'off'}`
}

function editPart(known: readonly Known[], places: readonly PlaceOpt[], here: string): string {
  const rules = known.length ? known.map(knownLine).join('\n') : '(none yet)'
  const where = places.map(p => `${p.ref}: ${p.words}${p.agent ? ` (a ${AI_NAME[p.agent]} chat; only ${AI_NAME[p.agent]} rules go here)` : ''}`).join('\n')
  return `
Rules already put in (ref | AI | place | moment | what | on or off):
${rules}

Places (ref: what it is):
${where}
The place picked in the window now: ${here || 'g'}.

"action" says what to do:
- "add": a new rule, as above. "targets" []. "place": "" to go by "scope", or a place ref when the person names a place.
- "change": the person wants ONE rule above different: its words, command, moment, tools, "only when it fails", "once", its place or its AI. "targets" [its ref]. "event", "kind", "text", "command", "skill", "mode", "tools", "once" are the whole rule as it should be after the change: copy over everything they did not ask to change. "event" must be a moment of the AI it ends up with. "place": "" to keep it where it is, or the ref of the place to move it to. "agent": "" to keep its AI, or "claude"/"codex" to move it to the other AI.
- "copy": put copies of rules above in another place or for the other AI too ("put this in Codex too", "use the same in project shop"). "targets": their refs. "place": "" for each one's own place, or a place ref. "agent": "" for each one's own AI, or "claude"/"codex".
- "off" / "on": switch rules off (they stay, but nothing goes in) or back on. "delete": remove rules for good. "targets": every ref meant, one or many ("all the lint ones", "everything in project shop", "all of them").
For any action but "add" and "change", fill the content fields with any valid value. Only use refs listed above. Refs are for you only: never write them in "say"; name a rule by what it does. When it is not clear which rule the person means, answer ok false and ask in "say" which one, naming the candidates in a few words.

Examples:
- "turn off the test rule" -> off, targets [the ref of the "npm test" rule].
- "use pnpm instead of npm for the tests" -> change, targets [that ref], command "pnpm test", the rest as it was.
- "put the Korean rule in Codex too" -> copy, targets [that ref], agent "codex".
- "delete everything in project shop" -> delete, targets [every ref whose place is project shop].
`
}

/** A rule's words, checked against one moment: what an answer or a change puts in, or null. */
function contentOf(
  a: Partial<Rule>,
  m: { event: string; canInject: boolean; hasTools: boolean },
  skills: readonly string[],
): Omit<Rule, 'scope' | 'why'> | null {
  let kind: Rule['kind'] = a.kind === 'command' || a.kind === 'skill' ? a.kind : 'text'
  if (!m.canInject) kind = 'command'
  if (kind === 'skill' && !skills.includes(a.skill ?? '')) return null
  const c = {
    event: m.event,
    kind,
    text: kind === 'text' ? (a.text ?? '').trim() : '',
    command: kind === 'command' ? (a.command ?? '').trim() : '',
    skill: kind === 'skill' ? (a.skill ?? '') : '',
    mode: a.mode === 'onFail' ? ('onFail' as const) : ('always' as const),
    tools: m.hasTools ? toolList(a.tools ?? '') : '',
    once: a.once === true,
  }
  return c.text || c.command || c.skill ? c : null
}

/** The rule in an answer, checked against the moments; anything off becomes "not understood". */
export function ruleOf(answer: unknown, moments: readonly Moment[], skills: readonly string[]): RuleAnswer {
  const a = answer as Partial<Rule & { ok: boolean; say: string }> | null
  if (!a || typeof a !== 'object') return { ok: false, say: '' }
  if (a.ok !== true) return { ok: false, say: typeof a.say === 'string' ? a.say : '' }
  const m = moments.find(x => x.event === a.event)
  if (!m) return { ok: false, say: '' }
  const c = contentOf(a, m, skills)
  if (!c) return { ok: false, say: '' }
  return { ok: true, rule: { ...c, scope: a.scope === 'global' ? 'global' : 'here', why: (a.why ?? '').trim() } }
}

type Answer = Partial<Rule & { ok: boolean; say: string; action: string; targets: unknown; place: string; agent: string }>

/**
 * What an answer says to do, checked against the rules put in and the places: a new rule (as
 * `ruleOf`), or a change to rules that exist. Refs that are not listed are dropped; when none is
 * left, or a change cannot be made for the AI it would end up with, it is not understood.
 */
export function interpret(
  answer: unknown,
  o: { moments: readonly Moment[]; skills: readonly string[]; known: readonly Known[]; places: readonly PlaceOpt[] },
): Understood {
  const a = answer as Answer | null
  if (!a || typeof a !== 'object') return { ok: false, say: '' }
  if (a.ok !== true) return { ok: false, say: typeof a.say === 'string' ? a.say : '' }
  const action = ACTIONS.find(x => x === a.action) ?? 'add'
  const place = o.places.find(p => p.ref === a.place) ?? null
  const agent: Agent | null = a.agent === 'claude' || a.agent === 'codex' ? a.agent : null
  if (action === 'add') {
    const r = ruleOf(a, o.moments, o.skills)
    return r.ok ? { ok: true, action, rule: r.rule, ...(place ? { place } : {}) } : r
  }
  const refs = Array.isArray(a.targets) ? a.targets.filter((x): x is string => typeof x === 'string') : []
  const targets = o.known.filter(k => refs.includes(k.ref))
  const say = typeof a.say === 'string' ? a.say : ''
  if (targets.length === 0) return { ok: false, say }
  if (action === 'off' || action === 'on' || action === 'delete') return { ok: true, action, targets }
  if (action === 'copy') {
    if (!place && !agent) return { ok: false, say }
    return { ok: true, action, targets, to: { agent, place } }
  }
  // change: one rule, its words (unless they are skill rules), place and AI
  const target = targets[0]
  const to = agent ?? target.agent
  let item: Item = target.item
  if (target.item.kind !== 'rules') {
    const s = slotOf(a.event ?? '', to)
    if (!s) return { ok: false, say }
    const c = contentOf(a, s, o.skills)
    if (!c) return { ok: false, say }
    item = { ...target.item, ...c }
  }
  const fit = itemFor(item, to)
  if (!fit.ok) return { ok: false, say }
  return { ok: true, action, target, item: fit.item, to: { agent: to, place } }
}

/** Tool names as the hooks compare them: comma-separated ("Edit|Write" too, as a matcher writes it). */
function toolList(tools: string): string {
  return [...new Set(tools.split(/[,|]/).map(s => s.trim()).filter(Boolean))].join(', ')
}

/** Claude Code's tool names as Codex calls the same tools (its hooks get `apply_patch` for any edit). */
const CODEX_TOOL: Record<string, string> = {
  Edit: 'apply_patch',
  Write: 'apply_patch',
  MultiEdit: 'apply_patch',
  NotebookEdit: 'apply_patch',
  Agent: 'spawn_agent',
  Task: 'spawn_agent',
}

/** And back: what Codex calls a tool, as Claude Code's names. */
const CLAUDE_TOOL: Record<string, string> = { apply_patch: 'Edit, Write', spawn_agent: 'Agent' }

/** A tool filter in one agent's own tool names. */
function toolsFor(tools: string, agent: Agent): string {
  const names = toolList(tools).split(', ').filter(Boolean)
  return toolList(names.map(n => (agent === 'codex' ? CODEX_TOOL : CLAUDE_TOOL)[n] ?? n).join(','))
}

type Fit<T> = { ok: true } & T | { ok: false; why: 'no-moment' | 'no-words' }

/** Whether one agent has a moment for this, and words reach it there (else only a command). */
function fitOf(event: string, kind: ItemKind, agent: Agent): Fit<{ slot: Slot }> {
  const slot = slotOf(event, agent)
  if (!slot) return { ok: false, why: 'no-moment' }
  if (!slot.canInject && kind !== 'command') return { ok: false, why: 'no-words' }
  return { ok: true, slot }
}

/**
 * A rule (made in Claude Code's terms) as it goes in for one agent, or why it cannot:
 * "no-moment" when that agent has no such moment, "no-words" when words do not reach it there.
 */
export function ruleFor(rule: Rule, agent: Agent): Fit<{ rule: Rule }> {
  const f = fitOf(rule.event, rule.kind, agent)
  if (!f.ok) return f
  return { ok: true, rule: { ...rule, tools: f.slot.hasTools ? toolsFor(rule.tools, agent) : '' } }
}

/** An item put in for one agent, as it goes in for that agent (or the other one), or why not. */
export function itemFor(item: Item, agent: Agent): Fit<{ item: Item }> {
  const f = fitOf(item.event, item.kind, agent)
  if (!f.ok) return f
  return { ok: true, item: { ...item, tools: f.slot.hasTools ? toolsFor(item.tools, agent) : '' } }
}

/** The moments only Codex has, which a Codex rule put in may name. */
export const CODEX_ONLY: readonly string[] = CODEX_SLOTS.map(s => s.event).filter(e => !slotOf(e, 'claude'))

/** A rule as an item for the config (a new id and time are the caller's). */
export function itemOf(rule: Rule, id: string, now: number): Item {
  return {
    id,
    event: rule.event,
    kind: rule.kind,
    text: rule.text,
    command: rule.command,
    mode: rule.mode,
    skill: rule.skill,
    tools: rule.tools,
    enabled: true,
    once: rule.once,
    added: now,
  }
}

type Recipe = { words: RegExp; rule: Omit<Rule, 'text' | 'why'> & { text?: Record<string, string> }; why: Record<string, string> }

/** Ready-made rules, matched by their words when Claude Code cannot be asked. */
const RECIPES: Recipe[] = [
  {
    words: /테스트|test|テスト|测试/i,
    rule: { event: 'Stop', kind: 'command', command: 'npm test', skill: '', mode: 'onFail', tools: '', once: false, scope: 'here' },
    why: {
      ko: 'AI가 “다 했어요”라고 하기 직전에 테스트를 돌려, 실패하면 한 번 더 고치게 해요.',
      en: 'Right before the AI says it is done, the tests run; if they fail it fixes them once more.',
      ja: 'AI が「できました」と言う直前にテストを走らせ、失敗したらもう一度直させます。',
      zh: '在 AI 说“完成”之前先跑测试，失败就让它再修一次。',
    },
  },
  {
    words: /린트|lint|リント/i,
    rule: { event: 'PostToolUse', kind: 'command', command: 'npm run lint', skill: '', mode: 'onFail', tools: 'Edit, Write', once: false, scope: 'here' },
    why: {
      ko: '파일을 고친 직후라, 린트가 실패하면 그 자리에서 다시 고칠 수 있어요.',
      en: 'Right after a file is edited, so a failing lint gets fixed on the spot.',
      ja: 'ファイルを直した直後なので、リントが失敗したらその場で直せます。',
      zh: '刚改完文件，lint 失败就能当场再改。',
    },
  },
  {
    words: /한국어|korean|英語|영어로|english|日本語|中文|chinese|japanese/i,
    rule: {
      event: 'UserPromptSubmit',
      kind: 'text',
      command: '',
      skill: '',
      mode: 'always',
      tools: '',
      once: false,
      scope: 'global',
      text: { ko: '한국어로 답해 줘.', en: 'Please answer in English.', ja: '日本語で答えてください。', zh: '请用中文回答。' },
    },
    why: {
      ko: '메시지를 보낼 때마다 함께 가서, 매번 말하지 않아도 돼요.',
      en: 'It goes with every message you send, so you never have to say it again.',
      ja: 'メッセージを送るたびに一緒に届くので、毎回言わなくて済みます。',
      zh: '每次发消息都会一起带上，不用每次再说。',
    },
  },
  {
    words: /지우|삭제|delete|remove|\brm\b|消す|删除/i,
    rule: {
      event: 'PreToolUse',
      kind: 'text',
      command: '',
      skill: '',
      mode: 'always',
      tools: 'Bash',
      once: false,
      scope: 'global',
      text: {
        ko: '지우거나 덮어쓰는 명령은 이유를 먼저 말해.',
        en: 'Before a command that deletes or overwrites, say why first.',
        ja: '消したり上書きしたりするコマンドは、先に理由を言ってください。',
        zh: '删除或覆盖之前，先说明理由。',
      },
    },
    why: {
      ko: '셸 명령을 쓰기 직전에만 들어가서, 위험한 명령 앞에서 멈추게 해요.',
      en: 'It goes in right before a shell command, so risky ones stop to explain first.',
      ja: 'シェルコマンドの直前だけに入るので、危ないコマンドの前で立ち止まります。',
      zh: '只在执行命令前加入，让危险命令先停下来说明。',
    },
  },
  {
    words: /소리|알려|알림|sound|notify|let me know|音|通知|提醒/i,
    rule: { event: 'Stop', kind: 'command', command: 'say "끝났어요"', skill: '', mode: 'onFail', tools: '', once: false, scope: 'global' },
    why: {
      ko: '답이 끝날 때마다 소리로 알려요. 잘 울리면 AI에게는 아무것도 가지 않아요.',
      en: 'A sound each time an answer ends; when it plays fine, nothing goes to the AI.',
      ja: '答えが終わるたびに音で知らせます。鳴れば AI には何も届きません。',
      zh: '每次回答结束都会响一声；正常响时不会给 AI 任何内容。',
    },
  },
  {
    words: /상태|브랜치|branch|git status|状態|状态/i,
    rule: { event: 'SessionStart', kind: 'command', command: 'git status -sb', skill: '', mode: 'always', tools: '', once: false, scope: 'here' },
    why: {
      ko: '대화를 열 때 지금 브랜치와 바뀐 파일을 AI가 먼저 알고 시작해요.',
      en: 'When a chat opens, the AI starts knowing the branch and the changed files.',
      ja: '会話を開いたとき、AI がブランチと変更ファイルを先に知ってから始めます。',
      zh: '对话一开始，AI 就先知道当前分支和改动的文件。',
    },
  },
]

/** The ready-made rule whose words appear in the sentence, if any. */
export function matchRecipe(text: string, lang: string, moments: readonly Moment[]): RuleAnswer {
  for (const r of RECIPES) {
    if (!r.words.test(text) || !moments.some(m => m.event === r.rule.event)) continue
    const { text: words, ...rest } = r.rule
    return { ok: true, rule: { ...rest, text: words ? (words[lang] ?? words.en) : '', why: r.why[lang] ?? r.why.en } }
  }
  return { ok: false, say: '' }
}

/** Words that switch off, back on, or delete; checked in this order ("비활성화" is off, not on). */
const VERBS: [Exclude<Understood & { ok: true }, { action: 'add' | 'change' | 'copy' }>['action'], RegExp][] = [
  ['delete', /지워\s*줘|지워\s*주|지우자|삭제해|삭제\s*$|없애|빼\s*줘|delete|remove|消して|削除|删除|删掉/i],
  ['off', /꺼\s*줘|꺼\s*주|끄자|끄고|끌래|비활성|turn (it |them |that )?off|switch (it |them |that )?off|disable|オフ|止めて|关掉|关闭/i],
  ['on', /켜\s*줘|켜\s*주|다시\s*켜|활성화|turn (it |them |that )?on|switch (it |them |that )?on|enable|オンに|打开|开启/i],
]
const STOP = new Set(['규칙', '규칙을', '규칙은', '거', '것', '걸', '다시', 'rule', 'rules', 'the', 'it', 'that', 'please', 'ルール', '规则'])
const ALL = /전부|모두|다\s*(꺼|켜|지워)|everything|all of (them|it)|all the rules|全部|すべて/i

/**
 * Without Claude Code: switching off, on or deleting the rules put in, by their words ("테스트
 * 규칙 꺼 줘" finds the rule that runs the tests). Null when the sentence is not one of these, or
 * no rule matches; "before deleting" is a wish for a new rule, not a delete.
 */
export function matchEdit(text: string, known: readonly Known[]): Understood | null {
  if (/전에|before|前に|之前/i.test(text)) return null
  const verb = VERBS.find(([, w]) => w.test(text))
  if (!verb) return null
  const [action] = verb
  const words = RECIPES.filter(r => r.words.test(text)).map(r => r.words)
  const quoted = [...text.matchAll(/["“'‘「]([^"”'’」]+)["”'’」]/g)].map(m => m[1].toLowerCase())
  const labelOf = (k: Known) => `${itemLabel(k.item)} ${k.item.text}`.toLowerCase()
  // A word of the sentence that a rule has as it is ("한국어") picks that rule over the ready-made
  // rules' broader words (which take any language).
  const plain = text
    .toLowerCase()
    .split(/[\s,.!?]+/)
    .filter(w => w.length >= 2 && !STOP.has(w) && !VERBS.some(([, v]) => v.test(w)) && !ALL.test(w))
  const exact = known.filter(k => plain.some(w => labelOf(k).includes(w)))
  const targets = ALL.test(text) && words.length === 0 && quoted.length === 0 && exact.length === 0
    ? [...known]
    : quoted.length
      ? known.filter(k => quoted.some(q => labelOf(k).includes(q)))
      : exact.length
        ? exact
        : known.filter(k => words.some(w => w.test(labelOf(k))))
  const fit = targets.filter(k => (action === 'off' ? k.item.enabled : action === 'on' ? !k.item.enabled : true))
  return fit.length ? { ok: true, action, targets: fit } : null
}

/** The moments as the instructions list them, from the slots and their plain names. */
export function momentsOf(slots: readonly Slot[], name: (e: string) => string, hint: (e: string) => string): Moment[] {
  return slots.map(s => ({ event: s.event, name: name(s.event), hint: hint(s.event), canInject: s.canInject, hasTools: s.hasTools }))
}
