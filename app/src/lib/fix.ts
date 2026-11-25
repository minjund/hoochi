/**
 * The one button that makes a hook run again, picked from the reason it does not: put a hidden
 * rule in the place that hides it, connect Codex, write its tools the way they match, give a hook
 * in a settings file a longer time limit, open the rule to fill it in or fix its command. What the
 * window cannot fix (a plugin's own hook failing) gets the diagnosis to copy for its owner.
 */
import type { Scope } from './lifecycle.ts'
import { toolNames, type Week, type Why } from './why.ts'

export type Fix =
  /** put a copy in the narrower place that hides it */
  | { do: 'add-there'; to: { scope: Scope; key: string } }
  /** open the rule's popup: fill it in, or fix its command */
  | { do: 'open' }
  | { do: 'connect-codex' }
  /** its tools, written so they match */
  | { do: 'set-tools'; tools: string }
  /** a hook in a settings file: a longer time limit, in seconds */
  | { do: 'raise-timeout'; seconds: number }
  /** a hook the window cannot change (a plugin's): its diagnosis, for whoever looks after it */
  | { do: 'copy-report' }

/** Tools written apart with commas, the way hoochi reads them. */
const splitTools = (tools: string) =>
  tools
    .split(/[|;,]/)
    .map(s => s.trim())
    .filter(Boolean)
    .join(', ')

/** The fix for a rule put in with hoochi, from the reason it is stuck or failing. */
export function ruleFix(r: { why: Why; hiddenBy?: { scope: Scope; key: string }; tools: string }): Fix | undefined {
  const c = r.why.reason?.check
  if (!c) return undefined
  switch (c.key) {
    case 'hidden':
      return r.hiddenBy ? { do: 'add-there', to: r.hiddenBy } : undefined
    case 'codex-off':
      return c.installed ? { do: 'connect-codex' } : undefined
    case 'tools-format':
      return { do: 'set-tools', tools: splitTools(r.tools) }
    case 'tools-ai':
    case 'tools-case':
      return { do: 'set-tools', tools: toolNames(r.tools).map(n => (n === c.name ? c.right : n)).join(', ') }
    case 'empty':
    case 'mute':
    case 'not-found':
    case 'exit':
    case 'broken':
    case 'timeout':
      return { do: 'open' }
    default:
      return undefined
  }
}

/** A longer time limit: twice the one it has, at least 30 s more, at most an hour. */
export const longerLimit = (limitMs: number) => Math.min(3600, Math.max(Math.ceil((limitMs * 2) / 1000), Math.ceil(limitMs / 1000) + 30))

/** The fix for a hook set up outside hoochi. Only a hook in a settings file can be changed here. */
export function hookFix(o: { why: Why; editable: boolean; limitMs: number }): Fix | undefined {
  const c = o.why.reason?.check
  if (!c || (o.why.verdict !== 'failing' && o.why.verdict !== 'stuck')) return undefined
  const timedOut = c.key === 'timeout' || (c.key === 'often' && weekTimedOut(c.w))
  if (timedOut && o.editable) return { do: 'raise-timeout', seconds: longerLimit(o.limitMs) }
  return { do: 'copy-report' }
}

/** Most of its failures were timeouts. */
const weekTimedOut = (w: Week) => w.timeouts * 2 >= w.fails
