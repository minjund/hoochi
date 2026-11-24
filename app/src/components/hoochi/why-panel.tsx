import type { Lang } from '../../lib/i18n'
import { outputOf, type Why } from '../../lib/why'
import { WHY_UI, whyWords, type WhyHelp } from '../../lib/why-words'

const ICON = { ok: '✓', bad: '✕', warn: '!', idle: '·' } as const

/** Every check a hook went through, in order, the first one that stops it marked; then what it printed. */
export function WhyPanel({ lang, why, help }: { lang: Lang; why: Why; help: WhyHelp }) {
  const t = WHY_UI[lang]
  const out = outputOf(why)
  return (
    <section className="hw-why" data-verdict={why.verdict} aria-label={t.checks}>
      <h4>{t.checks}</h4>
      <ol className="hw-why-steps">
        {why.steps.map((s, i) => (
          <li key={i} data-s={s.status} data-reason={s === why.reason || undefined}>
            <i aria-hidden="true">{ICON[s.status]}</i>
            <span>{whyWords(lang, s.check, help)}</span>
          </li>
        ))}
      </ol>
      {out && (
        <>
          <h5>{t.output}</h5>
          <pre className="hw-why-out">{out}</pre>
        </>
      )}
    </section>
  )
}
