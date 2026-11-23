/**
 * A sentence the person types ("don't say it's done before the tests pass") becomes one rule: a
 * moment and what goes in there. The window asks this computer's Claude Code once (`ask_claude`
 * in the app), with the instructions and the answer's shape built here. Without Claude Code (or
 * in the browser demo) a few ready-made rules are matched by their words instead.
 */
import type { Agent, Item, ItemKind, Slot } from './lifecycle.ts'

export type Moment = { event: string; name: string; hint: string; canInject: boolean; hasTools: boolean }

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

export type Understood = { ok: true; rule: Rule } | { ok: false; say: string }

export const MODEL = 'sonnet'

export function schemaFor(moments: readonly Moment[]): string {
  return JSON.stringify({
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      event: { type: 'string', enum: moments.map(m => m.event) },
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
    required: ['ok', 'event', 'kind', 'text', 'command', 'skill', 'mode', 'tools', 'once', 'scope', 'why', 'say'],
    additionalProperties: false,
  })
}

const LANG_NAME: Record<string, string> = { en: 'English', ko: 'Korean', ja: 'Japanese', zh: 'Chinese' }

export function systemFor(o: {
  agent: Agent
  moments: readonly Moment[]
  skills: readonly string[]
  lang: string
}): string {
  const ai = o.agent === 'codex' ? 'Codex' : 'Claude Code'
  const list = o.moments
    .map(m => `- ${m.event}: "${m.name}". ${m.hint}${m.canInject ? '' : ' (words do not reach the AI here; only a command runs)'}${m.hasTools ? ' (can be limited to tools)' : ''}`)
    .join('\n')
  return `You turn one wish a person has about their AI coding agent (${ai}) into ONE hoochi rule: a moment, and what goes in at that moment. You never run anything; you only answer in the JSON shape.

Moments:
${list}

What can go in:
- kind "text": words handed to the AI at that moment, put in "text". For instructions and preferences (a language, a habit, "explain before deleting"). Only at moments where words reach the AI.
- kind "command": a shell command run on the person's computer at that moment, put in "command". mode "onFail": the AI sees the output only when the command fails, so use it for checks (tests, lint, type checks) so the AI fixes what fails, and for side effects (notifications, sounds, logging) so a successful run puts nothing in. mode "always": the AI always gets the output, for giving it context (git status, today's date). At "Stop" an output given to the AI makes it keep going once, so use onFail there unless the person wants that.
- kind "skill": one of the person's skills, by exact name in "skill": ${o.skills.length ? o.skills.join(', ') : '(none installed; do not use kind "skill")'}.
- "tools": only for moments that can be limited to tools; e.g. "Bash" for shell commands, "Edit|Write" for file edits; "" for all.
- "once": true only if the person wants it once per chat.
- "scope": "global" when the wish is about the person (language, tone, notifications); "here" when it is about this project (its tests, lint, rules).

Examples:
- "don't say it's done before the tests pass" -> Stop, command "npm test", onFail, scope here.
- "always answer in Korean" -> UserPromptSubmit, text "한국어로 답해 줘.", scope global.
- "explain why before deleting anything" -> PreToolUse, tools "Bash", text "Before a command that deletes or overwrites, say why first.", scope global.
- "lint files right after editing them" -> PostToolUse, tools "Edit|Write", command "npm run lint", onFail, scope here.
- "tell me with a sound when you're done" -> Stop, command "say done" (macOS), onFail, scope global.
- "show me the branch status when a chat starts" -> SessionStart, command "git status -sb", always, scope here.

Write "text", "why" and "say" in ${LANG_NAME[o.lang] ?? 'English'}. "why" is one short sentence saying why this moment fits. If no rule can do what the person asks, answer ok false with a short "say" explaining what hoochi can do instead, and fill the other fields with any valid value. Otherwise ok true and "say" "".`
}

/** The rule in an answer, checked against the moments; anything off becomes "not understood". */
export function ruleOf(answer: unknown, moments: readonly Moment[], skills: readonly string[]): Understood {
  const a = answer as Partial<Rule & { ok: boolean; say: string }> | null
  if (!a || typeof a !== 'object') return { ok: false, say: '' }
  if (a.ok !== true) return { ok: false, say: typeof a.say === 'string' ? a.say : '' }
  const m = moments.find(x => x.event === a.event)
  if (!m) return { ok: false, say: '' }
  let kind: Rule['kind'] = a.kind === 'command' || a.kind === 'skill' ? a.kind : 'text'
  if (!m.canInject) kind = 'command'
  if (kind === 'skill' && !skills.includes(a.skill ?? '')) return { ok: false, say: '' }
  const rule: Rule = {
    event: m.event,
    kind,
    text: kind === 'text' ? (a.text ?? '').trim() : '',
    command: kind === 'command' ? (a.command ?? '').trim() : '',
    skill: kind === 'skill' ? (a.skill ?? '') : '',
    mode: a.mode === 'onFail' ? 'onFail' : 'always',
    tools: m.hasTools ? (a.tools ?? '').trim() : '',
    once: a.once === true,
    scope: a.scope === 'global' ? 'global' : 'here',
    why: (a.why ?? '').trim(),
  }
  if (!rule.text && !rule.command && !rule.skill) return { ok: false, say: '' }
  return { ok: true, rule }
}

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
    rule: { event: 'PostToolUse', kind: 'command', command: 'npm run lint', skill: '', mode: 'onFail', tools: 'Edit|Write', once: false, scope: 'here' },
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
export function matchRecipe(text: string, lang: string, moments: readonly Moment[]): Understood {
  for (const r of RECIPES) {
    if (!r.words.test(text) || !moments.some(m => m.event === r.rule.event)) continue
    const { text: words, ...rest } = r.rule
    return { ok: true, rule: { ...rest, text: words ? (words[lang] ?? words.en) : '', why: r.why[lang] ?? r.why.en } }
  }
  return { ok: false, say: '' }
}

/** The moments as the instructions list them, from the slots and their plain names. */
export function momentsOf(slots: readonly Slot[], name: (e: string) => string, hint: (e: string) => string): Moment[] {
  return slots.map(s => ({ event: s.event, name: name(s.event), hint: hint(s.event), canInject: s.canInject, hasTools: s.hasTools }))
}
