import { useState } from 'react'

import { copyText } from '../../lib/clipboard'
import type { Lang } from '../../lib/i18n'
import { outputOf, type Week, type Why } from '../../lib/why'
import { WHY_UI, whyWords, type WhyHelp } from '../../lib/why-words'

const ICON = { ok: '✓', bad: '✕', warn: '!', idle: '·' } as const

/** A hook's last 7 days: how often it failed, in how many chats, and a bar for each day. */
function WeekStrip({ lang, w, now }: { lang: Lang; w: Week; now: number }) {
  const t = WHY_UI[lang]
  const top = Math.max(1, ...w.days)
  const label = (i: number) => {
    const d = new Date(now - (w.days.length - 1 - i) * 86_400_000)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  return (
    <div className="hw-week">
      <h5>{t.week}</h5>
      <div className="hw-week-nums">
        <span data-hot={w.fails > 0 || undefined}>
          <b>{w.fails}</b> {t.wFails}
        </span>
        {w.timeouts > 0 && (
          <span data-hot>
            <b>{w.timeouts}</b> {t.wTimeouts}
          </span>
        )}
        <span>
          <b>{w.chats}</b> {t.wChats}
        </span>
        <span data-hot={w.fails24 > 0 || undefined}>
          <b>{w.fails24}</b> {t.w24}
        </span>
      </div>
      {w.fails > 0 && (
        <div className="hw-week-bars" role="img" aria-label={w.days.map((n, i) => `${label(i)} ${n}`).join(', ')}>
          {w.days.map((n, i) => (
            <span key={i} title={`${label(i)} · ${n}`}>
              <i style={{ height: n ? `${20 + (80 * n) / top}%` : '3px' }} data-n={n || undefined} />
              <small>{label(i)}</small>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Every check a hook went through, in order, the first one that stops it marked; its last 7 days;
 * then what it printed. With `report`, a button copies the whole diagnosis as text. */
export function WhyPanel({
  lang,
  why,
  help,
  week,
  report,
  fix,
}: {
  lang: Lang
  why: Why
  help: WhyHelp
  week?: Week
  report?: () => string
  /** the button that makes it run again, when there is one */
  fix?: { label: string; run(): void }
}) {
  const t = WHY_UI[lang]
  const out = outputOf(why)
  const [copied, setCopied] = useState(false)
  return (
    <section className="hw-why" data-verdict={why.verdict} aria-label={t.checks}>
      <div className="hw-why-head">
        <h4>{t.checks}</h4>
        {report && (
          <button
            type="button"
            className="hw-link hw-why-copy"
            title={t.copyHint}
            onClick={() =>
              copyText(report(), () => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1800)
              })
            }
          >
            {copied ? `✓ ${t.copied}` : t.copy}
          </button>
        )}
      </div>
      <ol className="hw-why-steps">
        {why.steps.map((s, i) => (
          <li key={i} data-s={s.status} data-reason={s === why.reason || undefined}>
            <i aria-hidden="true">{ICON[s.status]}</i>
            <span>{whyWords(lang, s.check, help)}</span>
          </li>
        ))}
      </ol>
      {fix && (
        <button type="button" className="hw-rl-fix hw-why-fix" onClick={fix.run}>
          {fix.label}
        </button>
      )}
      {week && (week.fails > 0 || week.timed > 0) && <WeekStrip lang={lang} w={week} now={Date.now()} />}
      {out && (
        <>
          <h5>{t.output}</h5>
          <pre className="hw-why-out">{out}</pre>
        </>
      )}
    </section>
  )
}
