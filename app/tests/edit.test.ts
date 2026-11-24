import assert from 'node:assert/strict'
import { test } from 'node:test'

import { allTargets, applyEdit, revertEdit, type Edit } from '../src/lib/edit.ts'
import { emptyAgent, listOf, type Config, type Item } from '../src/lib/lifecycle.ts'

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id, event: 'Stop', kind: 'command', text: '', command: `cmd ${id}`, mode: 'onFail', skill: '', tools: '',
  enabled: true, once: false, ...over,
})
const config = (): Config => ({
  version: 2,
  claude: { ...emptyAgent(), global: [item('a'), item('b'), item('c')], projects: { '/shop': [item('p')] } },
  codex: emptyAgent(),
})
const ids = (c: Config, agent: 'claude' | 'codex', scope: 'global' | 'project', key = '') =>
  listOf(c[agent], scope, key).map(i => i.id)

test('every item is found with where it stands', () => {
  const all = allTargets(config())
  assert.equal(all.length, 4)
  assert.deepEqual(all.find(t => t.item.id === 'b'), { agent: 'claude', scope: 'global', key: '', index: 1, item: item('b') })
  assert.equal(all.find(t => t.item.id === 'p')?.scope, 'project')
})

test('off, on and delete, each taken back by itself', () => {
  const c0 = config()
  const [a, , c] = allTargets(c0)
  const off: Edit = { action: 'off', targets: [a, c] }
  const c1 = applyEdit(c0, off)
  assert.deepEqual(c1.claude.global.map(i => i.enabled), [false, true, false])
  // something else changed meanwhile stays changed
  const c2 = { ...c1, claude: { ...c1.claude, global: [...c1.claude.global, item('new')] } }
  const c3 = revertEdit(c2, off)
  assert.deepEqual(c3.claude.global.map(i => i.enabled), [true, true, true, true])

  const del: Edit = { action: 'delete', targets: [a, c] }
  const d1 = applyEdit(c0, del)
  assert.deepEqual(ids(d1, 'claude', 'global'), ['b'])
  assert.deepEqual(ids(revertEdit(d1, del), 'claude', 'global'), ['a', 'b', 'c'], 'back where they stood')
})

test('a change in place, and a move to another place and AI', () => {
  const c0 = config()
  const b = allTargets(c0)[1]
  const inPlace: Edit = { action: 'change', target: b, item: { ...b.item, command: 'pnpm test' }, to: { agent: 'claude', scope: 'global', key: '' } }
  const c1 = applyEdit(c0, inPlace)
  assert.deepEqual(c1.claude.global.map(i => i.command), ['cmd a', 'pnpm test', 'cmd c'])
  assert.deepEqual(revertEdit(c1, inPlace), c0)

  const move: Edit = { action: 'change', target: b, item: b.item, to: { agent: 'codex', scope: 'project', key: '/shop' } }
  const m1 = applyEdit(c0, move)
  assert.deepEqual(ids(m1, 'claude', 'global'), ['a', 'c'])
  assert.deepEqual(ids(m1, 'codex', 'project', '/shop'), ['b'])
  const m2 = revertEdit(m1, move)
  assert.deepEqual(ids(m2, 'claude', 'global'), ['a', 'b', 'c'])
  assert.deepEqual(ids(m2, 'codex', 'project', '/shop'), [])
})

test('copies go in, and come back out', () => {
  const c0 = config()
  const copy: Edit = { action: 'copy', copies: [{ item: item('x'), to: { agent: 'codex', scope: 'global', key: '' } }] }
  const c1 = applyEdit(c0, copy)
  assert.deepEqual(ids(c1, 'codex', 'global'), ['x'])
  assert.deepEqual(ids(c1, 'claude', 'global'), ['a', 'b', 'c'], 'the original stays')
  assert.deepEqual(ids(revertEdit(c1, copy), 'codex', 'global'), [])
})
