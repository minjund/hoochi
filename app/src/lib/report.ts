/**
 * One hook's diagnosis as plain text, to paste where its owner will read it (an issue, a chat): what
 * it is and where it is set, every check it went through in order, its last 7 days, its latest
 * failures with what they printed, and where the numbers come from. Pure: the popups copy it.
 */
import type { Lang } from './i18n.ts'
import type { Agent } from './lifecycle.ts'
import type { RecordedRun, Week, Why } from './why.ts'
import { VERDICT, whyWords, type WhyHelp } from './why-words.ts'

const ICON = { ok: '✓', bad: '✕', warn: '!', idle: '·' } as const

const UI = {
  en: {
    title: 'Hook diagnosis',
    state: 'State',
    where: 'Set in',
    moment: 'Moment',
    limit: 'limit',
    async: "async (Claude Code doesn't wait)",
    runs: 'Runs',
    checks: 'Checks, in order',
    week: 'Last 7 days',
    days: 'Failures by day',
    took: 'Time',
    fails: 'Latest failures',
    output: 'printed',
    env: 'Where this comes from',
    source:
      "Claude Code's transcripts (~/.claude/projects). Failures are always recorded; runs that went well only at some moments (never at UserPromptSubmit), so only the failure count is exact everywhere.",
    timeout: 'timed out',
    exit: (n: number) => `exit ${n}`,
  },
  ko: {
    title: '훅 진단',
    state: '상태',
    where: '설정된 곳',
    moment: '순간',
    limit: '한도',
    async: 'async(Claude Code가 기다리지 않음)',
    runs: '실행하는 것',
    checks: '확인한 것(순서대로)',
    week: '최근 7일',
    days: '날마다 실패',
    took: '걸린 시간',
    fails: '최근 실패',
    output: '출력',
    env: '근거',
    source:
      'Claude Code 대화 기록(~/.claude/projects). 실패는 늘 기록되고, 성공한 실행은 일부 순간에만 기록돼요(UserPromptSubmit은 기록 안 됨). 그래서 어디서나 정확한 건 실패 수예요.',
    timeout: '시간 초과',
    exit: (n: number) => `exit ${n}로 끝남`,
  },
  ja: {
    title: 'フック診断',
    state: '状態',
    where: '設定場所',
    moment: 'タイミング',
    limit: '制限',
    async: 'async(Claude Code は待たない)',
    runs: '実行するもの',
    checks: '確認したこと(順に)',
    week: '直近 7 日',
    days: '日ごとの失敗',
    took: 'かかった時間',
    fails: '最近の失敗',
    output: '出力',
    env: '根拠',
    source:
      'Claude Code の会話記録(~/.claude/projects)。失敗は必ず記録され、うまくいった実行は一部のタイミングだけ記録されます(UserPromptSubmit は記録なし)。どこでも正確なのは失敗の数です。',
    timeout: 'タイムアウト',
    exit: (n: number) => `exit ${n} で終了`,
  },
  zh: {
    title: '钩子诊断',
    state: '状态',
    where: '设置位置',
    moment: '时刻',
    limit: '限制',
    async: 'async(Claude Code 不等待)',
    runs: '运行的内容',
    checks: '检查项(按顺序)',
    week: '最近 7 天',
    days: '每天的失败',
    took: '耗时',
    fails: '最近的失败',
    output: '输出',
    env: '依据',
    source:
      'Claude Code 的对话记录(~/.claude/projects)。失败总会被记录,成功的运行只在部分时刻记录(UserPromptSubmit 不记录),所以各处都准确的只有失败次数。',
    timeout: '超时',
    exit: (n: number) => `以 exit ${n} 结束`,
  },
} satisfies Record<Lang, unknown>

export type ReportInput = {
  lang: Lang
  agent: Agent
  /** what the hook is called, and where it is set (a plugin, a settings file, a hoochi place) */
  name: string
  where: string
  event: string
  matcher?: string
  limitMs?: number
  async?: boolean
  /** what it runs */
  body?: string
  why: Why
  week?: Week
  /** its recorded runs, newest first */
  runs?: readonly RecordedRun[]
  help: WhyHelp
  /** for the last section: hoochi's version, and now (for the day labels) */
  app?: string
  now: number
}

const secs = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}s`)
const stamp = (at: number) => {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const day = (at: number) => {
  const d = new Date(at)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The diagnosis of one hook, as text. */
export function reportOf(r: ReportInput): string {
  const u = UI[r.lang]
  const out: string[] = []
  const reason = r.why.reason ? whyWords(r.lang, r.why.reason.check, r.help) : ''
  out.push(`# ${u.title}: ${r.name}`)
  out.push(`- ${u.state}: ${VERDICT[r.lang][r.why.verdict]}${reason ? ` — ${reason}` : ''}`)
  out.push(`- ${u.where}: ${r.where} (${r.agent === 'codex' ? 'Codex' : 'Claude Code'})`)
  const moment = [r.event, r.matcher ? `matcher ${r.matcher}` : '', r.limitMs ? `${u.limit} ${secs(r.limitMs)}` : '', r.async ? u.async : '']
  out.push(`- ${u.moment}: ${moment.filter(Boolean).join(' · ')}`)
  if (r.body) out.push(`- ${u.runs}: \`${r.body}\``)

  out.push('', `## ${u.checks}`)
  for (const s of r.why.steps) out.push(`${ICON[s.status]} ${whyWords(r.lang, s.check, r.help)}`)

  const w = r.week
  if (w) {
    out.push('', `## ${u.week}`)
    out.push(whyWords(r.lang, { key: 'week', w }, r.help))
    const labels = w.days.map((_, i) => day(r.now - (w.days.length - 1 - i) * 86_400_000))
    out.push(`- ${u.days}: ${w.days.map((n, i) => `${labels[i]} ${n}`).join(' · ')}`)
    if (w.timed > 0)
      out.push(
        `- ${u.took}: p50 ${secs(w.p50)} · p90 ${secs(w.p90)} · max ${secs(w.max)}${r.limitMs ? ` (${u.limit} ${secs(r.limitMs)})` : ''} · n=${w.timed}`,
      )
  }

  const fails = (r.runs ?? []).filter(x => x.result === 'error' || x.result === 'timeout').slice(0, 5)
  if (fails.length) {
    out.push('', `## ${u.fails}`)
    for (const f of fails) {
      const how = f.result === 'timeout' ? `${u.timeout}${f.ms ? ` ${secs(f.ms)}` : ''}` : u.exit(f.exit ?? -1)
      const bits = [stamp(f.at), f.on ? `${f.event}:${f.on}` : f.event, how, f.version ? `Claude Code ${f.version}` : '', f.cwd ?? '']
      out.push(`- ${bits.filter(Boolean).join(' · ')}`)
      if (f.out) out.push(`  ${u.output}: ${f.out.replace(/\s+/g, ' ').slice(0, 300)}`)
    }
  }

  out.push('', `## ${u.env}`)
  const version = w?.version ?? fails.find(f => f.version)?.version
  out.push(`- hoochi ${r.app ?? '?'}${version ? ` · Claude Code ${version}` : ''}`)
  out.push(`- ${u.source}`)
  return out.join('\n') + '\n'
}
