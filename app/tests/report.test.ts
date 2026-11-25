import assert from 'node:assert/strict'
import { test } from 'node:test'

import { reportOf } from '../src/lib/report.ts'
import { whyOutside, type HookStat, type RecordedRun } from '../src/lib/why.ts'

const help = { ago: () => 'just now', place: () => 'everywhere' }

test('the diagnosis says what the hook is, every check in order, its week and its latest failures', () => {
  const hook = { event: 'UserPromptSubmit', matcher: '', off: false, command: 'sync', timeout: 20 }
  const fail: RecordedRun = {
    at: Date.UTC(2026, 10, 25, 0, 0), session: 's', event: 'UserPromptSubmit', on: '', command: 'sync', result: 'timeout',
    ms: 20031, limitMs: 20000, version: '2.1.326', cwd: '/Users/me/p',
  }
  const stat: HookStat = {
    event: 'UserPromptSubmit', command: 'sync', runs: 46, ok: 0, fails: 46, timeouts: 46, fails24: 5, chats: 16, allChats: 16,
    days: [9, 0, 7, 2, 18, 5, 5], timed: 0, p50: 0, p90: 0, max: 0, limitMs: 20000, lastFailAt: fail.at, version: '2.1.326', recordsOk: false,
  }
  const why = whyOutside('claude', hook, { activity: { lastEvent: '', lastAt: 1, counts: {}, recent: [] }, runs: [fail], stats: [stat] })
  const text = reportOf({
    lang: 'ko', agent: 'claude', name: 'sync', where: 'plugin:project@ubion', event: 'UserPromptSubmit', limitMs: 20000,
    body: 'python3 auto.py ensure', why, week: why.steps.find(s => s.check.key === 'often') ? weekFrom(stat) : undefined,
    runs: [fail], help, app: '0.1.46', now: Date.UTC(2026, 10, 25, 3, 0),
  })
  assert.match(text, /^# 훅 진단: sync/)
  assert.match(text, /상태: 실패 — 계속 실패해요: 지난 24시간 5번/)
  assert.match(text, /✕ 계속 실패해요/)
  assert.match(text, /날마다 실패: .* 18 · .* 5 · .* 5$/m)
  assert.match(text, /시간 초과 20s · Claude Code 2\.1\.326 · \/Users\/me\/p/)
  assert.match(text, /hoochi 0\.1\.46 · Claude Code 2\.1\.326/)
})

const weekFrom = (s: HookStat) => s
