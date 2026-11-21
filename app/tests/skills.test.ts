// node --test (Node 23.6+ runs TypeScript as is): npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SkillGroup } from '../src/lib/backend.ts'
import { switchableGroups, switchablePlugin } from '../src/lib/skills.ts'

const plugins = [
  { name: 'Notion', key: 'Notion@official', on: true },
  { name: 'hoochi', key: 'hoochi@hoochi', on: true },
]

test('only skills the window can switch are counted', () => {
  const groups: SkillGroup[] = [
    { kind: 'plugin', name: 'notion', skills: 5, tokens: 500 },
    { kind: 'plugin', name: 'hoochi', skills: 1, tokens: 50 },
    { kind: 'plugin', name: 'not-installed', skills: 3, tokens: 300 },
    { kind: 'user', name: '', skills: 4, tokens: 400 },
    { kind: 'project', name: '', skills: 2, tokens: 200 },
    { kind: 'builtin', name: '', skills: 6, tokens: 600 },
    { kind: 'synced', name: '', skills: 70, tokens: 7000 },
    { kind: 'other', name: 'somewhere', skills: 5, tokens: 500 },
  ]
  const kept = switchableGroups(groups, plugins)
  assert.deepEqual(
    kept.map(g => `${g.kind}:${g.name}`),
    ['plugin:notion', 'user:', 'project:', 'builtin:'],
  )
  assert.equal(
    kept.reduce((n, g) => n + g.skills, 0),
    17,
  )
})

test('a plugin is matched without case, and hoochi is never one to switch', () => {
  assert.equal(switchablePlugin('NOTION', plugins)?.key, 'Notion@official')
  assert.equal(switchablePlugin('hoochi', plugins), undefined)
  assert.equal(switchablePlugin('missing', plugins), undefined)
})
