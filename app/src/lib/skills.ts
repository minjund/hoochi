import type { SkillGroup, SkillState } from './backend'

/** Kinds of skill that can be switched one by one (skillOverrides); plugins go whole. */
export const ONE_BY_ONE: ReadonlySet<SkillGroup['kind']> = new Set(['user', 'project', 'builtin'])

/**
 * The installed plugin a group of skills belongs to, when it can be switched from the window:
 * a plugin found in the settings that is not hoochi itself. Names match without case
 * (a manifest may say "Notion" and the settings "notion").
 */
export function switchablePlugin(name: string, plugins: SkillState['plugins']) {
  const plugin = plugins.find(p => p.name.toLowerCase() === name.toLowerCase())
  return plugin && plugin.name !== 'hoochi' && !plugin.key.startsWith('hoochi@') ? plugin : undefined
}

/**
 * Only the skills the window can turn on and off: yours, the project's and built-in ones one by
 * one, and installed plugins as a whole. Skills synced from claude.ai, ones of unknown origin and
 * hoochi's own are left out, as the skills popup leaves them out.
 */
export function switchableGroups(groups: SkillGroup[], plugins: SkillState['plugins']): SkillGroup[] {
  return groups.filter(g =>
    g.kind === 'plugin' ? switchablePlugin(g.name, plugins) !== undefined : ONE_BY_ONE.has(g.kind),
  )
}
