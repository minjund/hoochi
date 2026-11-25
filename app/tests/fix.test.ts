import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hookFix, longerLimit, ruleFix } from '../src/lib/fix.ts'
import type { Check, Why } from '../src/lib/why.ts'

const stuck = (check: Check, verdict: Why['verdict'] = 'stuck'): Why => ({ verdict, steps: [], reason: { status: 'bad', check } })

test('a rule gets the button its reason needs', () => {
  const shop = { scope: 'project' as const, key: '/shop' }
  assert.deepEqual(ruleFix({ why: stuck({ key: 'hidden', by: shop }), hiddenBy: shop, tools: '' }), { do: 'add-there', to: shop })
  assert.deepEqual(ruleFix({ why: stuck({ key: 'codex-off', installed: true }), tools: '' }), { do: 'connect-codex' })
  assert.equal(ruleFix({ why: stuck({ key: 'codex-off', installed: false }), tools: '' }), undefined, 'nothing to connect')
  assert.deepEqual(ruleFix({ why: stuck({ key: 'tools-format', name: 'Edit|Write' }), tools: 'Edit|Write; Bash' }), { do: 'set-tools', tools: 'Edit, Write, Bash' })
  assert.deepEqual(ruleFix({ why: stuck({ key: 'tools-case', name: 'bash', right: 'Bash' }), tools: 'Read, bash' }), { do: 'set-tools', tools: 'Read, Bash' })
  assert.deepEqual(ruleFix({ why: stuck({ key: 'empty' }), tools: '' }), { do: 'open' })
  assert.equal(ruleFix({ why: stuck({ key: 'blocked' }), tools: '' }), undefined, "an account's policy is not ours to change")
})

test('a hook set up elsewhere: a longer limit when it is in a settings file and times out, else its diagnosis', () => {
  const run = { at: 1 }
  const timeout = stuck({ key: 'timeout', run, limitMs: 20000 }, 'failing')
  assert.deepEqual(hookFix({ why: timeout, editable: true, limitMs: 20000 }), { do: 'raise-timeout', seconds: 50 })
  assert.deepEqual(hookFix({ why: timeout, editable: false, limitMs: 20000 }), { do: 'copy-report' }, "a plugin's hook comes back on update")
  assert.deepEqual(hookFix({ why: stuck({ key: 'exit', run }, 'failing'), editable: true, limitMs: 20000 }), { do: 'copy-report' })
  assert.equal(hookFix({ why: { verdict: 'working', steps: [] }, editable: true, limitMs: 1 }), undefined)
  assert.equal(longerLimit(600_000), 1200)
  assert.equal(longerLimit(3_000_000), 3600)
})
