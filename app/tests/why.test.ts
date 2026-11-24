import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Activity, Item } from '../src/lib/lifecycle.ts'
import { matcherMatches, runsOf, toolCheck, whyOutside, whyRule, type RecordedRun, type RuleContext } from '../src/lib/why.ts'

const item = (over: Partial<Item> = {}): Item => ({
  id: 'i', event: 'PreToolUse', kind: 'text', text: 'careful', command: '', mode: 'always', skill: '', tools: '',
  enabled: true, once: false, ...over,
})
const alive: Activity = { lastEvent: 'Stop', lastAt: 100, counts: {}, recent: [] }
const ctx = (over: Partial<RuleContext> = {}, act: Partial<Activity> = {}): RuleContext => ({
  activity: { ...alive, ...act }, codexOn: true, codexInstalled: true, blocked: new Set(), ...over,
})
const reasonOf = (agent: 'claude' | 'codex', i: Item, c: RuleContext) => whyRule(agent, i, c).reason?.check.key

test('a rule that came and ran is working; one that has not run yet is waiting', () => {
  const seen = { PreToolUse: { at: 90, tools: ['Bash'] } }
  const runs = { i: { runs: 3, fails: 0, last: { at: 95 } } }
  assert.equal(whyRule('claude', item(), ctx({}, { seen, runs })).verdict, 'working')
  assert.equal(whyRule('claude', item(), ctx({}, { seen })).verdict, 'waiting')
  // A switched-off rule says only that.
  assert.equal(whyRule('claude', item({ enabled: false }), ctx({}, { seen, runs })).verdict, 'off')
})

test('the first check that fails is the reason, in the order the plugin checks', () => {
  assert.equal(reasonOf('codex', item(), ctx({ codexOn: false })), 'codex-off')
  assert.equal(reasonOf('claude', item({ event: 'PostToolBatch' }), ctx({ blocked: new Set(['PostToolBatch']) })), 'blocked')
  assert.equal(reasonOf('claude', item(), ctx({ reach: 'hidden', hiddenBy: { scope: 'project', key: '/p' } })), 'hidden')
  // Words where nothing reaches the model: only commands run there.
  assert.equal(reasonOf('claude', item({ event: 'SessionEnd' }), ctx()), 'mute')
  assert.equal(whyRule('claude', item({ event: 'SessionEnd', kind: 'command', command: 'log' }), ctx()).reason, undefined)
  // No word from the plugin yet: likely trouble, not proof.
  const quiet = whyRule('claude', item(), ctx({}, { lastAt: 0 }))
  assert.equal(quiet.verdict, 'warn')
  assert.equal(quiet.reason?.check.key, 'no-plugin')
})

test('tool filters: another AI\'s names, "|" in a name, the wrong case, or none of the tools that came', () => {
  assert.deepEqual(toolCheck('Edit', 'codex', ['shell']).check, { key: 'tools-ai', name: 'Edit', right: 'apply_patch' })
  assert.deepEqual(toolCheck('apply_patch', 'claude', ['Bash']).check, { key: 'tools-ai', name: 'apply_patch', right: 'Edit, Write' })
  assert.deepEqual(toolCheck('Edit|Write', 'claude', ['Edit']).check, { key: 'tools-format', name: 'Edit|Write' })
  assert.deepEqual(toolCheck('bash', 'claude', ['Read', 'Bash']).check, { key: 'tools-case', name: 'bash', right: 'Bash' })
  assert.equal(toolCheck('Edit, Bash', 'claude', ['Read', 'Bash']).status, 'ok')
  assert.deepEqual(toolCheck('Write', 'claude', ['Read', 'Bash']), { status: 'warn', check: { key: 'tools-miss', want: ['Write'], came: ['Read', 'Bash'] } })
  assert.equal(toolCheck('Write', 'claude', []).check.key, 'tools-unknown')
  // The tools that came at the moment are the plugin's record.
  const seen = { PreToolUse: { at: 90, tools: ['Read'] } }
  assert.equal(reasonOf('claude', item({ tools: 'read' }), ctx({}, { seen })), 'tools-case')
})

test('how a command ended: not found, timed out, a code other than 0, or a failure "only when it fails" told', () => {
  const cmd = item({ event: 'Stop', kind: 'command', command: 'npm run lint' })
  const runs = (last: object, more: object = {}) => ({ i: { runs: 2, fails: 1, last: { at: 9, ...last }, ...more } })
  const failing = whyRule('claude', cmd, ctx({}, { runs: runs({ exit: 127, out: 'npm: command not found' }) }))
  assert.equal(failing.verdict, 'failing')
  assert.equal(failing.reason?.check.key, 'not-found')
  assert.equal(reasonOf('claude', cmd, ctx({}, { runs: runs({ error: 'timed out after 30000ms' }) })), 'timeout')
  assert.equal(reasonOf('claude', cmd, ctx({}, { runs: runs({ error: 'spawn failed' }) })), 'broken')
  assert.equal(whyRule('claude', cmd, ctx({}, { runs: runs({ exit: 1 }) })).verdict, 'warn')
  const told = whyRule('claude', { ...cmd, mode: 'onFail' }, ctx({}, { runs: runs({ exit: 1 }) }))
  assert.equal(told.verdict, 'working')
  assert.ok(told.steps.some(s => s.check.key === 'reported'))
  // Passing now, failed before: said, but it is working.
  const fail = { at: 5, exit: 2, out: 'x' }
  const healed = whyRule('claude', cmd, ctx({}, { runs: runs({ exit: 0 }, { fail }) }))
  assert.equal(healed.verdict, 'working')
  assert.deepEqual(healed.steps.at(-1), { status: 'idle', check: { key: 'failed-before', run: fail, fails: 1, runs: 2 } })
})

const run = (over: Partial<RecordedRun>): RecordedRun => ({
  at: 1, session: 's', event: 'Stop', on: '', command: 'sync', result: 'ok', exit: 0, ...over,
})

test("an outside hook's runs are found by its command, or the line it shows while running", () => {
  const runs = [run({ at: 1 }), run({ at: 3, command: 'Syncing…' }), run({ at: 2, event: 'PreToolUse' }), run({ at: 4, command: 'other' })]
  assert.deepEqual(runsOf({ event: 'Stop', matcher: '', off: false, command: 'sync', status: 'Syncing…' }, runs).map(r => r.at), [3, 1])
  assert.deepEqual(runsOf({ event: 'Stop', matcher: '', off: false }, runs), [])
})

test('an outside hook: how its last run ended, or no record of it, or a matcher no tool matched', () => {
  const hook = { event: 'Stop', matcher: '', off: false, command: 'sync' }
  const o = (runs: RecordedRun[], act: Partial<Activity> = {}) => ({ activity: { ...alive, ...act }, runs })
  assert.equal(whyOutside('claude', hook, o([run({})])).verdict, 'working')
  const failed = whyOutside('claude', hook, o([run({ at: 5, result: 'error', exit: 1, out: 'no server' }), run({})]))
  assert.equal(failed.verdict, 'failing')
  assert.equal(failed.reason?.check.key, 'exit')
  assert.equal(whyOutside('claude', hook, o([run({ result: 'timeout', exit: undefined, limitMs: 20000 })])).reason?.check.key, 'timeout')
  // Ended with 2: it stopped Claude on purpose.
  assert.equal(whyOutside('claude', hook, o([run({ result: 'blocked', exit: 2 })])).verdict, 'working')
  assert.equal(whyOutside('claude', hook, o([])).steps.at(-1)?.check.key, 'no-record')
  assert.equal(whyOutside('codex', hook, o([])).steps.at(-1)?.check.key, 'codex-no-record')
  assert.equal(whyOutside('claude', { ...hook, off: true }, o([])).verdict, 'off')

  const guard = { event: 'PreToolUse', matcher: 'Write|Edit', off: false, command: 'guard' }
  const miss = whyOutside('claude', guard, o([], { seen: { PreToolUse: { at: 1, tools: ['Bash', 'Read'] } } }))
  assert.equal(miss.reason?.check.key, 'matcher-miss')
  const hit = whyOutside('claude', guard, o([], { seen: { PreToolUse: { at: 1, tools: ['Edit'] } } }))
  assert.ok(hit.steps.some(s => s.check.key === 'matcher-ok'))
})

test('a matcher is matched as Claude Code does: all, a name, or a whole regex', () => {
  assert.ok(matcherMatches('', 'Bash') && matcherMatches('*', 'Bash'))
  assert.ok(matcherMatches('Edit|Write', 'Write'))
  assert.ok(!matcherMatches('Edit', 'NotebookEdit'), 'a whole match, not a part')
  assert.ok(matcherMatches('mcp__.*', 'mcp__github__search'))
  assert.ok(matcherMatches('(', '('), 'a broken regex falls back to names')
})
