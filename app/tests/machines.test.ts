// node --test (Node 23.6+ runs TypeScript as is): npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  afterChange,
  createSaver,
  followState,
  noticePlace,
  pluginNote,
  updateFlow,
  versionAtLeast,
  type Notice,
  type SaveStatus,
  type Timers,
  type UpdateFlow,
  type UpdateInfo,
} from '../src/lib/machines.ts'

/** Timers that run only when told to. */
function fakeTimers() {
  let next = 1
  const due = new Map<number, () => void>()
  const timers: Timers = {
    set(run) {
      due.set(next, run)
      return next++
    },
    clear(id) {
      if (id !== undefined) due.delete(id)
    },
  }
  const runAll = () => {
    const now = [...due.values()]
    due.clear()
    for (const run of now) run()
  }
  return { timers, runAll, waiting: () => due.size }
}

/** A write you finish (or fail) by hand. */
function slowWrites() {
  const calls: { value: string; done(): void; fail(e: string): void }[] = []
  const write = (value: string) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ value, done: resolve, fail: e => reject(new Error(e)) })
    })
  return { calls, write }
}

const tick = () => new Promise(r => setImmediate(r))

function saverWith() {
  const t = fakeTimers()
  const w = slowWrites()
  const seen: { status: SaveStatus; error?: string }[] = []
  const saver = createSaver<string>({
    write: w.write,
    key: v => v,
    delay: 350,
    onStatus: (status, error) => seen.push({ status, error }),
    timers: t.timers,
  })
  return { saver, t, w, seen }
}

test('an edit waits, is written, then the disk may replace it again', async () => {
  const { saver, t, w } = saverWith()
  saver.save('a')
  assert.equal(saver.status(), 'waiting')
  assert.equal(saver.fromDisk('old'), false, 'the disk must not replace an edit that waits')
  t.runAll()
  assert.equal(saver.status(), 'writing')
  assert.equal(saver.fromDisk('old'), false)
  w.calls[0]!.done()
  await tick()
  assert.equal(saver.status(), 'saved')
  assert.equal(saver.fromDisk('a'), false, 'what was just written is not news')
  assert.equal(saver.fromDisk('b'), true, 'a change made elsewhere is shown')
})

test('quick edits are written once, the newest', async () => {
  const { saver, t, w } = saverWith()
  saver.save('a')
  saver.save('b')
  saver.save('c')
  assert.equal(t.waiting(), 1)
  t.runAll()
  assert.deepEqual(
    w.calls.map(c => c.value),
    ['c'],
  )
})

test('an edit made while writing is written after, never before', async () => {
  const { saver, t, w } = saverWith()
  saver.save('a')
  t.runAll()
  saver.save('b')
  t.runAll() // b's delay runs out while a is still being written
  assert.equal(w.calls.length, 1, 'one write at a time')
  w.calls[0]!.done()
  await tick()
  assert.deepEqual(
    w.calls.map(c => c.value),
    ['a', 'b'],
  )
  assert.equal(saver.status(), 'writing')
  assert.equal(saver.fromDisk('a'), false, 'b still waits: the disk holding a must not undo it')
  w.calls[1]!.done()
  await tick()
  assert.equal(saver.status(), 'saved')
})

test('a failed write keeps your edit on screen until a retry writes it', async () => {
  const { saver, t, w, seen } = saverWith()
  saver.save('a')
  t.runAll()
  w.calls[0]!.fail('disk full')
  await tick()
  assert.equal(saver.status(), 'failed')
  assert.match(seen.at(-1)!.error ?? '', /disk full/)
  assert.equal(saver.fromDisk('old'), false, 'the old file must not quietly replace the edit')
  saver.retry()
  assert.equal(w.calls.length, 2)
  w.calls[1]!.done()
  await tick()
  assert.equal(saver.status(), 'saved')
})

test('retry does nothing unless the last write failed', () => {
  const { saver, w } = saverWith()
  saver.retry()
  saver.save('a')
  saver.retry()
  assert.equal(w.calls.length, 0)
})

const info = (latest: string | null, current = '0.1.15'): UpdateInfo => ({
  current,
  latest,
  available: latest !== null && latest !== current,
})

test('update: look, find one, install, reopen', () => {
  let s: UpdateFlow = { step: 'unknown' }
  s = updateFlow(s, { type: 'checked', info: info('0.1.15') })
  assert.equal(s.step, 'current')
  s = updateFlow(s, { type: 'install' })
  assert.equal(s.step, 'current', 'nothing to install')
  s = updateFlow(s, { type: 'checked', info: info('0.1.16') })
  assert.equal(s.step, 'available')
  s = updateFlow(s, { type: 'install' })
  assert.equal(s.step, 'installing')
  s = updateFlow(s, { type: 'checked', info: info('0.1.15') })
  assert.equal(s.step, 'installing', 'a look that comes back mid-update changes nothing')
  s = updateFlow(s, { type: 'installed' })
  assert.equal(s.step, 'reopening')
})

test('update: a failure says why, until a newer version is out', () => {
  let s: UpdateFlow = updateFlow({ step: 'unknown' }, { type: 'checked', info: info('0.1.16') })
  s = updateFlow(updateFlow(s, { type: 'install' }), { type: 'failed', error: 'offline' })
  assert.deepEqual(s, { step: 'available', info: info('0.1.16'), error: 'offline' })
  s = updateFlow(s, { type: 'checked', info: info('0.1.16') })
  assert.equal(s.step === 'available' && s.error, 'offline', 'same version: the reason stays')
  s = updateFlow(s, { type: 'checked', info: info('0.1.17') })
  assert.equal(s.step === 'available' && s.error, undefined, 'a newer one: a fresh start')
})

test('update: a window that did not reopen can be tried again', () => {
  let s: UpdateFlow = updateFlow({ step: 'unknown' }, { type: 'checked', info: info('0.1.16') })
  s = updateFlow(updateFlow(s, { type: 'install' }), { type: 'installed' })
  s = updateFlow(s, { type: 'failed', error: 'did not reopen' })
  assert.equal(s.step, 'available')
})

test('an undo ends when anything else changes; an error does not', () => {
  const undo: Notice<number> = { kind: 'undo', message: 'Deleted', before: 1, near: 'list' }
  const error: Notice<number> = { kind: 'error', message: 'Could not' }
  assert.equal(afterChange(undo), null)
  assert.equal(afterChange(error), error)
  assert.equal(afterChange(null), null)
})

test('a notice shows inside an open popup, else where it belongs', () => {
  const undo: Notice<number> = { kind: 'undo', message: 'Deleted', before: 1, near: 'list' }
  const error: Notice<number> = { kind: 'error', message: 'Could not' }
  assert.equal(noticePlace(error, 'skills'), 'modal')
  assert.equal(noticePlace(undo, null), 'list')
  assert.equal(noticePlace(error, null), 'controls')
  assert.equal(noticePlace(null, 'mine'), null)
})

test('following pauses while a moment is open, and holds where you moved it', () => {
  assert.equal(followState(true, false), 'on')
  assert.equal(followState(true, true), 'paused')
  assert.equal(followState(true, false, true), 'held')
  assert.equal(followState(false, true), 'off')
  assert.equal(followState(false, false, true), 'off', 'a switch you turned off stays off')
})

test('after an update, open chats reload by themselves only when they already could', () => {
  assert.equal(versionAtLeast('0.1.16', '0.1.9'), true)
  assert.equal(versionAtLeast('0.1.16', '0.1.16'), true)
  assert.equal(versionAtLeast('0.1.15', '0.1.16'), false)
  assert.equal(pluginNote({ from: '0.1.15', plugin: true }), 'once')
  assert.equal(pluginNote({ from: '0.1.16', plugin: true }), 'auto')
  assert.equal(pluginNote({ from: '0.1.16', plugin: false }), 'by-hand')
})

import { modelName } from '../src/lib/names.ts'

test('a model id reads as its family and version', () => {
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5')
  assert.equal(modelName('claude-sonnet-4-5-20250929'), 'Sonnet 4.5')
  assert.equal(modelName('claude-fable-5-2[1m]'), 'Fable 5.2')
  assert.equal(modelName('claude-haiku-4'), 'Haiku 4')
  assert.equal(modelName('gpt-5-codex'), 'gpt-5-codex')
})
