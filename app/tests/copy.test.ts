import assert from 'node:assert/strict'
import { test } from 'node:test'

import { alsoIn, broaderThan, hasAll, hiddenHere, sendTo } from '../src/lib/copy.ts'
import type { Config, Item } from '../src/lib/lifecycle.ts'

const item = (id: string, event: string, text: string, extra: Partial<Item> = {}): Item => ({
  id,
  event,
  kind: 'text',
  text,
  command: '',
  mode: 'always',
  skill: '',
  tools: '',
  enabled: true,
  once: false,
  ...extra,
})

const config = (): Config => ({
  version: 2,
  claude: {
    global: [item('g1', 'UserPromptSubmit', 'Answer in Korean'), item('g2', 'Stop', 'Run the tests')],
    projects: {
      '/p/shop': [item('s1', 'UserPromptSubmit', 'Do not touch payments')],
      '/p/api': [],
    },
    terminals: { t1: [item('t1', 'Stop', 'Review first')] },
  },
  codex: { global: [], projects: {}, terminals: {} },
})
let n = 0
const makeId = () => `new${++n}`

test('the places above a place, nearest first', () => {
  assert.deepEqual(broaderThan('global', ''), [])
  assert.deepEqual(broaderThan('project', ''), [{ scope: 'global', key: '' }])
  assert.deepEqual(broaderThan('terminal', '/p/shop'), [
    { scope: 'project', key: '/p/shop' },
    { scope: 'global', key: '' },
  ])
})

test('what everywhere has for a moment is hidden where this place has its own', () => {
  const c = config()
  const shop = { scope: 'project' as const, key: '/p/shop' }
  const hidden = hiddenHere(c, 'claude', shop, '', 'UserPromptSubmit')
  assert.deepEqual(hidden.map(h => h.items.map(i => i.id)), [['g1']])
  // nothing of its own for this moment: everywhere's reaches it, nothing hidden
  assert.deepEqual(hiddenHere(c, 'claude', shop, '', 'Stop'), [])
  // a terminal in shop hides shop's and everywhere's for Stop
  const t = hiddenHere(c, 'claude', { scope: 'terminal', key: 't1' }, '/p/shop', 'Stop')
  assert.deepEqual(t.map(h => [h.place.scope, h.items.map(i => i.id)]), [['global', ['g2']]])
  // switched off ones are not mentioned
  c.claude.global[0].enabled = false
  assert.deepEqual(hiddenHere(c, 'claude', shop, '', 'UserPromptSubmit'), [])
})

test('sending copies into each chosen place once and skips what is there', () => {
  const c = config()
  const tests = c.claude.global[1]
  const r = sendTo(c, 'claude', [tests], [
    { scope: 'project', key: '/p/shop' },
    { scope: 'project', key: '/p/api' },
    { scope: 'global', key: '' },
  ], makeId)
  assert.equal(r.added, 2)
  assert.equal(r.places, 2)
  assert.ok(r.config.claude.projects['/p/api'].some(i => i.text === 'Run the tests'))
  assert.equal(r.config.claude.global.length, 2, 'everywhere already had it')
  assert.ok(hasAll(r.config, 'claude', { scope: 'project', key: '/p/shop' }, [tests]))
  assert.equal(c.claude.projects['/p/api'].length, 0, 'the config passed in is not changed')
  const where = alsoIn(r.config, 'claude', { scope: 'project', key: '/p/shop' }, tests)
  assert.deepEqual(where.map(p => p.key).sort(), ['', '/p/api'])
})
