// node --test (Node 23.6+ runs TypeScript as is): npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { CLASSIC_ONLY, CLAUDE_SLOTS, parseReach, reachFor, unreachable } from '../src/lib/lifecycle.ts'

test('only where the classic hooks are found blocked are moments dimmed, and only for Claude', () => {
  assert.equal(unreachable('claude', 'unknown').size, 0)
  assert.equal(unreachable('claude', 'open').size, 0)
  assert.equal(unreachable('codex', 'blocked').size, 0)
  const off = unreachable('claude', 'blocked')
  assert.ok(off.has('PreModelSwitch'))
  // served from Claude Code's own events, so they run on every account
  for (const event of ['PostModelSwitch', 'PreCompact', 'PostCompact', 'StopFailure', 'SubagentStart', 'Stop'])
    assert.ok(!off.has(event), event)
})

test("the window dims exactly the moments the plugin serves from their classic hook alone", () => {
  const source = readFileSync(new URL('../../plugin/hooks/register.ts', import.meta.url), 'utf8')
  const block = /export const CLASSIC_ONLY = \[([^\]]*)\]/.exec(source)?.[1] ?? ''
  const plugin = [...block.matchAll(/'([A-Za-z]+)'/g)].map(m => m[1])
  assert.ok(plugin.length > 0)
  assert.deepEqual(new Set(plugin), CLASSIC_ONLY)
  for (const event of CLASSIC_ONLY) assert.ok(CLAUDE_SLOTS.some(s => s.event === event), event)
})

test("the chat followed decides: its own entry, else the latest any chat wrote", () => {
  const r = parseReach(
    JSON.stringify({
      reach: 'open',
      at: 9,
      chats: { old: { reach: 'blocked', at: 1, version: '2.1.329' }, new: { reach: 'open', at: 9 }, odd: { reach: 'x' } },
    }),
  )
  assert.deepEqual(r, { latest: 'open', chats: { old: 'blocked', new: 'open' } })
  assert.equal(reachFor(r, 'old'), 'blocked')
  assert.equal(reachFor(r, 'new'), 'open')
  assert.equal(reachFor(r, 'unheard'), 'open')
  assert.equal(reachFor(r, undefined), 'open')
  // a file an older plugin wrote has no chats
  assert.deepEqual(parseReach('{"reach":"blocked","at":1}'), { latest: 'blocked', chats: {} })
  assert.deepEqual(parseReach('nope'), { latest: 'unknown', chats: {} })
  assert.deepEqual(parseReach('null'), { latest: 'unknown', chats: {} })
})
