import assert from 'node:assert/strict'
import { test } from 'node:test'

import { itemOf, matchRecipe, ruleOf, schemaFor, systemFor, type Moment } from '../src/lib/understand.ts'

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
