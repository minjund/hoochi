import assert from 'node:assert/strict'
import { test } from 'node:test'

import { emptyAgent, type Activity, type Config, type Item } from '../src/lib/lifecycle.ts'

const EMPTY_ACTIVITY: Activity = { lastEvent: '', lastAt: 0, counts: {}, recent: [] }
import { byMoment, filterRows, momentOrder, placesOf, rowsOf, type View } from '../src/lib/rules-view.ts'

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id, event: 'UserPromptSubmit', kind: 'text', text: id, command: '', mode: 'always', skill: '', tools: '',
  enabled: true, once: false, ...over,
})
const config: Config = {
  version: 2,
  claude: {
    global: [item('english'), item('stop', { event: 'Stop', kind: 'command', command: 'say done', text: '' })],
    projects: { '/shop': [item('korean')], '/blog': [item('blog', { event: 'Stop', kind: 'command', command: 'npm test', text: '' })] },
    terminals: {},
  },
  codex: { ...emptyAgent(), global: [item('cx', { event: 'PreModelRequest', kind: 'command', command: 'log', text: '' })] },
}
const activity = { claude: { ...EMPTY_ACTIVITY, recent: [{ event: 'UserPromptSubmit', at: 5, kind: 'text' as const, label: '', tool: '', id: 'korean' }, { event: 'UserPromptSubmit', at: 9, kind: 'text' as const, label: '', tool: '', id: 'korean' }] }, codex: EMPTY_ACTIVITY }
const chat = { agent: 'claude' as const, project: '/shop', terminal: 't1' }
const rows = rowsOf(config, { chat, activity, codexOn: false, blocked: new Set(['Stop']) })
const of = (id: string) => rows.find(r => r.item.id === id)!

test('what reaches the chat you are in, and what a narrower place hides', () => {
  assert.equal(of('korean').reach, 'in')
  assert.equal(of('korean').lastRun, 9)
  assert.equal(of('english').reach, 'hidden', 'shop has its own rule at that moment')
  assert.deepEqual(of('english').hiddenBy, { scope: 'project', key: '/shop' })
  assert.equal(of('english').problem, 'hidden')
  assert.equal(of('stop').reach, 'in')
  assert.equal(of('blog').reach, 'other', 'another project')
  assert.equal(of('cx').reach, 'other', 'another AI')
})

test('problems: Codex not connected, a moment this account never gets', () => {
  assert.equal(of('cx').problem, 'codex-off')
  assert.equal(of('stop').problem, 'blocked')
  assert.equal(of('korean').problem, undefined)
  // without a chat, nothing is hidden or other
  const free = rowsOf(config, { activity, codexOn: true, blocked: new Set() })
  assert.ok(free.every(r => r.reach === undefined && r.problem === undefined))
})

test('views: this chat, every AI and place, the off ones, the ones with a problem, a search', () => {
  const v: View = { mode: 'chat', ai: 'all', place: '', off: false, problems: false }
  const ids = (rs: { item: Item }[]) => rs.map(r => r.item.id).sort().join()
  assert.equal(ids(filterRows(rows, v, '', () => '')), 'english,korean,stop')
  assert.equal(ids(filterRows(rows, { ...v, mode: 'all' }, '', () => '')), 'blog,cx,english,korean,stop')
  assert.equal(ids(filterRows(rows, { ...v, mode: 'all', ai: 'codex' }, '', () => '')), 'cx')
  assert.equal(ids(filterRows(rows, { ...v, mode: 'all', place: 'project:/blog' }, '', () => '')), 'blog')
  assert.equal(ids(filterRows(rows, { ...v, mode: 'all', problems: true }, '', () => '')), 'blog,cx,english,stop')
  assert.equal(ids(filterRows(rows, { ...v, mode: 'all' }, 'TEST', r => r.item.command)), 'blog')
})

test('by moment in a chat\'s order, Codex\'s own moments in their place', () => {
  const order = momentOrder()
  assert.ok(order.indexOf('UserPromptSubmit') < order.indexOf('PreModelRequest'))
  assert.ok(order.indexOf('PreModelRequest') < order.indexOf('PreToolUse'))
  assert.ok(order.includes('Interrupt') && order.indexOf('Stop') < order.indexOf('SessionEnd'))
  assert.deepEqual(byMoment(rows).map(([e]) => e), ['UserPromptSubmit', 'PreModelRequest', 'Stop'])
  assert.deepEqual(placesOf(rows).map(p => p.scope), ['global', 'project', 'project'])
})
