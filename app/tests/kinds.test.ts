import assert from 'node:assert/strict'
import { test } from 'node:test'

import { onlyKind, splitAgent, splitKinds, type Item } from '../src/lib/lifecycle.ts'

const item = (extra: Partial<Item> = {}): Item => ({
  id: 'a1',
  event: 'UserPromptSubmit',
  kind: 'text',
  text: '',
  command: '',
  mode: 'always',
  skill: '',
  tools: '',
  enabled: true,
  once: false,
  ...extra,
})

test('an item puts in only what its kind does', () => {
  const mixed = item({ kind: 'command', text: 'answer in Korean', command: 'npm test', skill: 'grill-me' })
  assert.deepEqual(onlyKind(mixed), item({ kind: 'command', command: 'npm test' }))
  assert.deepEqual(onlyKind(item({ text: 'hi', rules: [{ when: 'vague', skill: 'grill-me' }] })), item({ text: 'hi', rules: [] }))
})

test('words and skill rules saved as one item come apart: the rules beside it, switched off', () => {
  const rules = [{ when: 'when I am vague', skill: 'grill-me' }]
  const [words, apart, ...rest] = splitKinds(item({ text: 'move images to the Desktop', rules }), 'claude')
  assert.equal(rest.length, 0)
  assert.deepEqual(words, item({ text: 'move images to the Desktop', rules: [] }))
  assert.deepEqual(apart, item({ id: 'a1-rules', kind: 'rules', rules, enabled: false }))
  // the same on every read, so the row it makes keeps its id
  assert.deepEqual(splitKinds(item({ text: 'move images to the Desktop', rules }), 'claude')[1], apart)
})

test('a clean item and an empty leftover stay one item', () => {
  const clean = item({ text: 'hi' })
  assert.equal(splitKinds(clean, 'claude')[0], clean)
  assert.equal(splitKinds(item({ text: 'hi', command: '   ', rules: [{ when: 'half', skill: '' }] }), 'claude').length, 1)
})

test('words left on a moment that takes only commands are dropped, not split out', () => {
  const at = item({ event: 'SessionEnd', kind: 'command', command: 'say bye', text: 'old words' })
  assert.deepEqual(splitKinds(at, 'claude'), [item({ event: 'SessionEnd', kind: 'command', command: 'say bye' })])
})

test('every place of a config is split', () => {
  const mixed = item({ text: 'w', skill: 'review' })
  const c = splitAgent({ global: [mixed], projects: { '/p': [mixed] }, terminals: {} }, 'claude')
  assert.deepEqual(
    c.global.map(i => [i.id, i.kind, i.enabled]),
    [
      ['a1', 'text', true],
      ['a1-skill', 'skill', false],
    ],
  )
  assert.equal(c.projects['/p'].length, 2)
})
