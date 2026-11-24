import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Item } from '../src/lib/lifecycle.ts'
import {
  interpret,
  itemFor,
  itemOf,
  knownLine,
  matchEdit,
  matchRecipe,
  ruleFor,
  ruleOf,
  schemaFor,
  systemFor,
  type Known,
  type Moment,
  type PlaceOpt,
  type Rule,
} from '../src/lib/understand.ts'

const moments: Moment[] = [
  { event: 'UserPromptSubmit', name: '내가 메시지를 보낼 때', hint: '', canInject: true, hasTools: false },
  { event: 'PreToolUse', name: '도구를 쓰기 전', hint: '', canInject: true, hasTools: true },
  { event: 'Stop', name: '답을 마칠 때', hint: '', canInject: true, hasTools: false },
  { event: 'SessionEnd', name: '대화 끝', hint: '', canInject: false, hasTools: false },
]

test('the shape lists only the moments given', () => {
  const s = JSON.parse(schemaFor(moments))
  assert.deepEqual(s.properties.event.enum, ['UserPromptSubmit', 'PreToolUse', 'Stop', 'SessionEnd'])
  assert.equal(s.additionalProperties, false)
  const sys = systemFor({ agent: 'claude', moments, skills: ['code-review'], lang: 'ko' })
  assert.ok(sys.includes('Stop: "답을 마칠 때"') && sys.includes('code-review') && sys.includes('Korean'))
})

const answer = (over: object) => ({
  ok: true, event: 'Stop', kind: 'command', text: 'x', command: 'npm test', skill: '', mode: 'onFail',
  tools: 'Bash', once: false, scope: 'here', why: '이유', say: '', ...over,
})

test('an answer becomes a rule, cleaned against the moment', () => {
  const r = ruleOf(answer({}), moments, [])
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.rule.command, 'npm test')
  assert.equal(r.rule.text, '', 'a command keeps no words')
  assert.equal(r.rule.tools, '', 'Stop takes no tool filter')
  // where words cannot reach the AI, only a command
  const end = ruleOf(answer({ event: 'SessionEnd', kind: 'text', text: 'bye', command: 'say bye' }), moments, [])
  assert.ok(end.ok && end.rule.kind === 'command' && end.rule.command === 'say bye')
  // a moment or skill that does not exist is not understood
  assert.equal(ruleOf(answer({ event: 'Nope' }), moments, []).ok, false)
  assert.equal(ruleOf(answer({ kind: 'skill', skill: 'ghost' }), moments, ['real']).ok, false)
  // ok false keeps what it says
  assert.deepEqual(ruleOf(answer({ ok: false, say: '그건 못 해요' }), moments, []), { ok: false, say: '그건 못 해요' })
  const item = itemOf(r.rule, 'id1', 5)
  assert.equal(item.enabled, true)
  assert.equal(item.added, 5)
})

test('without Claude Code, ready-made rules match by their words', () => {
  const t = matchRecipe('테스트 안 돌리고 다 했다고 하지 마', 'ko', moments)
  assert.ok(t.ok && t.rule.event === 'Stop' && t.rule.command === 'npm test' && t.rule.mode === 'onFail')
  const k = matchRecipe('답은 늘 한국어로', 'ko', moments)
  assert.ok(k.ok && k.rule.text === '한국어로 답해 줘.' && k.rule.scope === 'global')
  assert.equal(matchRecipe('날씨 알려 줘?', 'ko', []).ok, false)
  assert.equal(matchRecipe('아무 말', 'ko', moments).ok, false)
})

test('tools come out comma-separated, as the hooks compare them', () => {
  const r = ruleOf(answer({ event: 'PreToolUse', kind: 'text', text: 'x', tools: 'Edit|Write, Edit' }), moments, [])
  assert.ok(r.ok && r.rule.tools === 'Edit, Write')
  const lint = matchRecipe('수정하면 린트 돌려', 'ko', [{ event: 'PostToolUse', name: '', hint: '', canInject: true, hasTools: true }])
  assert.ok(lint.ok && lint.rule.tools === 'Edit, Write')
})

const rule = (over: Partial<Rule>): Rule => ({
  event: 'Stop', kind: 'command', text: '', command: 'npm test', skill: '', mode: 'onFail', tools: '',
  once: false, scope: 'here', why: '', ...over,
})

test('a rule goes in for each AI on its own terms', () => {
  // the same moment for both
  assert.deepEqual(ruleFor(rule({}), 'codex'), { ok: true, rule: rule({}) })
  // Codex's hooks name any file edit apply_patch, and a subagent spawn_agent
  const edit = ruleFor(rule({ event: 'PostToolUse', tools: 'Edit, Write' }), 'codex')
  assert.ok(edit.ok && edit.rule.tools === 'apply_patch')
  const bash = ruleFor(rule({ event: 'PreToolUse', kind: 'text', text: 'x', command: '', tools: 'Bash, Agent' }), 'codex')
  assert.ok(bash.ok && bash.rule.tools === 'Bash, spawn_agent')
  assert.ok(ruleFor(rule({ event: 'PostToolUse', tools: 'Edit, Write' }), 'claude').ok)
  // a moment Codex does not have, and one where words do not reach it
  assert.deepEqual(ruleFor(rule({ event: 'PostToolUseFailure' }), 'codex'), { ok: false, why: 'no-moment' })
  assert.deepEqual(ruleFor(rule({ event: 'SessionEnd', kind: 'text', text: 'bye', command: '' }), 'codex'), { ok: false, why: 'no-words' })
  assert.ok(ruleFor(rule({ event: 'SessionEnd' }), 'codex').ok, 'a command still runs there')
})

test('the instructions mark the moments Codex has too', () => {
  const both = moments.map(m => ({ ...m, codex: m.event !== 'PreToolUse' }))
  const sys = systemFor({ agent: 'claude', moments: both, skills: [], lang: 'en' })
  const line = (e: string) => sys.split('\n').find(l => l.startsWith(`- ${e}:`)) ?? ''
  assert.ok(line('Stop').endsWith('(Codex too)'))
  assert.ok(!line('PreToolUse').includes('Codex too'))
  assert.ok(sys.includes('Claude Code, Codex or both'))
})

const it = (id: string, over: Partial<Item> = {}): Item => ({
  id, event: 'Stop', kind: 'command', text: '', command: 'npm test', mode: 'onFail', skill: '', tools: '',
  enabled: true, once: false, ...over,
})
const known: Known[] = [
  { ref: 'r1', agent: 'claude', scope: 'global', key: '', index: 0, place: 'everywhere', item: it('a') },
  { ref: 'r2', agent: 'claude', scope: 'global', key: '', index: 1, place: 'everywhere', item: it('b', { event: 'UserPromptSubmit', kind: 'text', command: '', text: '한국어로 답해 줘.' }) },
  { ref: 'r3', agent: 'codex', scope: 'project', key: '/shop', index: 0, place: 'project shop', item: it('c', { event: 'PostToolUse', command: 'npm run lint', tools: 'apply_patch', enabled: false }) },
]
const places: PlaceOpt[] = [
  { ref: 'g', scope: 'global', key: '', words: 'everywhere' },
  { ref: 'p1', scope: 'project', key: '/shop', words: 'project shop' },
  { ref: 't1', scope: 'terminal', key: 'term', words: 'terminal 1', agent: 'codex' },
]
const ctx = { moments, skills: [], known, places }
const act = (over: object) => ({ ...answer({}), action: 'add', targets: [], place: '', agent: '', ...over })

test('the instructions list the rules put in and the places, the shape asks for an action', () => {
  const sys = systemFor({ agent: 'claude', moments, skills: [], lang: 'ko', known, places, here: 'p1' })
  assert.ok(sys.includes(knownLine(known[0])) && sys.includes('r3 | Codex | project shop | PostToolUse'))
  assert.ok(sys.includes('p1: project shop') && sys.includes('t1: terminal 1 (a Codex chat'))
  assert.ok(sys.includes('The place picked in the window now: p1.'))
  assert.ok(!systemFor({ agent: 'claude', moments, skills: [], lang: 'ko' }).includes('"action"'), 'without them, only new rules')
  const shape = JSON.parse(schemaFor(moments, ['Interrupt']))
  assert.ok(shape.required.includes('action') && shape.required.includes('targets'))
  assert.ok(shape.properties.event.enum.includes('Interrupt'))
})

test('off, on, delete: the refs listed, nothing else', () => {
  const off = interpret(act({ action: 'off', targets: ['r1', 'r9'] }), ctx)
  assert.ok(off.ok && off.action === 'off' && off.targets.length === 1 && off.targets[0].item.id === 'a')
  const del = interpret(act({ action: 'delete', targets: ['r1', 'r2', 'r3'] }), ctx)
  assert.ok(del.ok && del.action === 'delete' && del.targets.length === 3)
  assert.deepEqual(interpret(act({ action: 'on', targets: ['nope'], say: '어느 거요?' }), ctx), { ok: false, say: '어느 거요?' })
})

const change = (ref: string, over: object = {}) => ({
  ref, event: 'Stop', kind: 'command', text: '', command: 'npm test', skill: '', mode: 'onFail', tools: '', once: false, ...over,
})

test('a change keeps the rule, checked against the AI it ends up with', () => {
  const ch = interpret(act({ action: 'change', targets: ['r1'], changes: [change('r1', { command: 'pnpm test' })] }), ctx)
  assert.ok(ch.ok && ch.action === 'change')
  if (!ch.ok || ch.action !== 'change') return
  assert.equal(ch.changes.length, 1)
  assert.equal(ch.changes[0].item.id, 'a')
  assert.equal(ch.changes[0].item.command, 'pnpm test')
  assert.deepEqual(ch.to, { agent: null, place: null })
  // moved to Codex in project shop: Codex's tool names, the place named
  const mv = interpret(
    act({ action: 'change', changes: [change('r1', { event: 'PreToolUse', tools: 'Edit, Write' })], agent: 'codex', place: 'p1' }),
    ctx,
  )
  assert.ok(mv.ok && mv.action === 'change' && mv.to.agent === 'codex' && mv.to.place?.key === '/shop')
  assert.ok(mv.ok && mv.action === 'change' && mv.changes[0].item.tools === 'apply_patch')
  // only moved: no new words, the rule stays as it is
  const only = interpret(act({ action: 'change', targets: ['r2'], changes: [], place: 'p1' }), ctx)
  assert.ok(only.ok && only.action === 'change' && only.changes[0].item.text === '한국어로 답해 줘.')
  // nothing to change at all is not understood
  assert.equal(interpret(act({ action: 'change', targets: ['r2'], changes: [] }), ctx).ok, false)
})

test('several rules changed at once, each checked on its own', () => {
  const many = interpret(
    act({ action: 'change', targets: ['r1', 'r3'], changes: [change('r1', { mode: 'always' }), change('r3', { event: 'PostToolUse', command: 'npm run lint', mode: 'always', tools: 'apply_patch' })] }),
    ctx,
  )
  assert.ok(many.ok && many.action === 'change' && many.changes.length === 2)
  assert.ok(many.ok && many.action === 'change' && many.changes.every(c => c.item.mode === 'always'))
  // one that cannot be made (no such moment for Codex) is left out, the other stays
  const some = interpret(
    act({ action: 'change', changes: [change('r1', { mode: 'always' }), change('r3', { event: 'PostToolUseFailure' })] }),
    ctx,
  )
  assert.ok(some.ok && some.action === 'change' && some.changes.map(c => c.target.ref).join() === 'r1')
})

test('find lists the rules that match, or says there are none', () => {
  const f = interpret(act({ action: 'find', targets: ['r1', 'r3'] }), ctx)
  assert.ok(f.ok && f.action === 'find' && f.targets.length === 2)
  assert.deepEqual(interpret(act({ action: 'find', targets: [], say: '그런 규칙은 없어요.' }), ctx), { ok: false, say: '그런 규칙은 없어요.' })
})

test('the card just shown is in the instructions, so "these" means its rules', () => {
  const sys = systemFor({ agent: 'claude', moments, skills: [], lang: 'ko', known, places, here: 'g', recent: { said: '린트 규칙 보여 줘', refs: ['r3', 'r1'] } })
  assert.ok(sys.includes('Just before, the person said: "린트 규칙 보여 줘"'))
  assert.ok(sys.includes('1. r3, 2. r1'))
})

test('a copy names another place or AI', () => {
  const cp = interpret(act({ action: 'copy', targets: ['r2'], agent: 'codex' }), ctx)
  assert.ok(cp.ok && cp.action === 'copy' && cp.to.agent === 'codex' && cp.to.place === null)
  assert.equal(interpret(act({ action: 'copy', targets: ['r2'] }), ctx).ok, false, 'a copy to where it already is')
  const add = interpret(act({ place: 'p1' }), ctx)
  assert.ok(add.ok && add.action === 'add' && add.place?.ref === 'p1')
})

test('an item converts between the two AIs', () => {
  const back = itemFor(known[2].item, 'claude')
  assert.ok(back.ok && back.item.tools === 'Edit, Write')
  assert.deepEqual(itemFor(it('x', { event: 'PostToolUseFailure' }), 'codex'), { ok: false, why: 'no-moment' })
})

test('without Claude Code, switching off, on or deleting by a rule\'s words', () => {
  const off = matchEdit('테스트 규칙 꺼 줘', known)
  assert.ok(off?.ok && off.action === 'off' && off.targets.map(k => k.ref).join() === 'r1')
  const on = matchEdit('린트 다시 켜 줘', known)
  assert.ok(on?.ok && on.action === 'on' && on.targets[0].ref === 'r3')
  const withEnglish = [...known, { ...known[1], ref: 'r4', item: it('e', { event: 'UserPromptSubmit', kind: 'text', command: '', text: 'Answer in English.' }) }]
  const del = matchEdit('한국어 규칙 지워 줘', withEnglish)
  assert.ok(del?.ok && del.action === 'delete' && del.targets.map(k => k.ref).join() === 'r2', 'the word as it is, not every language')
  const all = matchEdit('전부 지워 줘', known)
  assert.ok(all?.ok && all.targets.length === 3)
  assert.equal(matchEdit('지우기 전에 이유부터', known), null, 'a wish for a new rule')
  assert.equal(matchEdit('삭제하기 전에 물어봐', known), null)
  assert.equal(matchEdit('날씨 꺼 줘', known), null, 'no rule with those words')
  // a list to act on, and "these" after it
  const found = matchEdit('테스트 규칙 보여 줘', known)
  assert.ok(found?.ok && found.action === 'find' && found.targets.map(k => k.ref).join() === 'r1')
  assert.equal(matchEdit('대화 시작할 때 브랜치 상태 보여 줘', known), null, 'a wish for a new rule, not a search')
  const those = matchEdit('이거 다 꺼 줘', known, [known[0], known[1]])
  assert.ok(those?.ok && those.action === 'off' && those.targets.map(k => k.ref).join() === 'r1,r2')
})

test('without Claude Code, "why doesn\'t it run?" finds the rule meant, else the ones not working', () => {
  const lint = matchEdit('린트 왜 안 돌아?', known)
  assert.ok(lint?.ok && lint.action === 'find' && lint.targets.map(k => k.ref).join() === 'r3')
  const marked = known.map(k => (k.ref === 'r2' ? { ...k, trouble: true, health: 'not working: hidden' } : k))
  const broken = matchEdit('뭐가 안 돌아?', marked)
  assert.ok(broken?.ok && broken.action === 'find' && broken.targets.map(k => k.ref).join() === 'r2')
  const none = matchEdit('why is nothing running?', known)
  assert.ok(none?.ok && none.action === 'find' && none.targets.length === 3, 'nothing marked: all of them, each with its state')
  // "when it fails" is a wish for a new rule, not a question.
  assert.equal(matchEdit('테스트가 실패하면 고치게 해 줘', known), null)
  // The instructions carry each rule's state.
  assert.match(knownLine(marked[1]), /\| not working: hidden$/)
})
