// "Why doesn't my hook run?" in words, in four languages: each check of why.ts as one sentence,
// each verdict as a short label, and the few headings the page and the popup use.

import type { Lang } from './i18n.ts'
import type { Scope } from './lifecycle.ts'
import type { Check, Verdict } from './why.ts'

/** What the sentences need from the window: how long ago a time was, and a place's name. */
export type WhyHelp = { ago(at: number): string; place(p: { scope: Scope; key: string }): string }

/** A duration: milliseconds under a second, else seconds in the language's unit (30s, 30초, 30秒). */
const secsIn = (unit: string) => (ms?: number) =>
  ms === undefined ? '' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}${unit}`
const list = (xs: readonly string[]) => xs.join(', ')

export const VERDICT: Record<Lang, Record<Verdict, string>> = {
  en: { off: 'Off', stuck: "Doesn't run", failing: 'Fails', warn: 'Check this', working: 'Works', waiting: 'Not run yet' },
  ko: { off: '꺼짐', stuck: '안 돌아요', failing: '실패', warn: '확인 필요', working: '잘 돌아요', waiting: '아직 안 돌았어요' },
  ja: { off: 'オフ', stuck: '動きません', failing: '失敗', warn: '要確認', working: '動いています', waiting: 'まだ動いていません' },
  zh: { off: '已关闭', stuck: '不会运行', failing: '失败', warn: '需要检查', working: '运行正常', waiting: '还没运行过' },
}

export const WHY_UI = {
  en: {
    checks: 'Why it runs or not',
    output: 'What it printed',
    runs: 'What it runs',
    trouble: (n: number) => (n === 1 ? '1 hook not running right now' : `${n} hooks not running right now`),
    troubleNone: 'Nothing stuck or failing.',
    troubleHint:
      'Hooks are the rules and commands Claude Code and Codex run on their own at set moments (when you send a message, before a tool…). These are stuck or failing: press one to see why, or its button to fix it.',
    troubleMore: (n: number) => `${n} more`,
    outside: 'Hooks set up elsewhere',
    outsideHint: 'From your settings files and plugins. How their runs ended comes from what Claude Code recorded.',
    outsideNone: 'None at this place.',
    ruleOf: 'Put in with hoochi',
    week: 'Last 7 days',
    wFails: 'failed',
    wTimeouts: 'timed out',
    wChats: 'chats',
    w24: 'last 24 h',
    weekTag: (n: number) => `${n} ${n === 1 ? 'failure' : 'failures'} in 7 days`,
    copy: 'Copy diagnosis',
    copied: 'Copied',
    fixOpen: 'Open and fix',
    fixConnect: 'Connect Codex',
    fixTools: (tools: string) => `Make its tools "${tools}"`,
    fixTimeout: (s: number) => `Give it ${s}s`,
    fixReport: 'Copy diagnosis for its owner',
    fixedTools: 'Fixed its tools.',
    fixedTimeout: (s: number) => `Its time limit is now ${s}s.`,
    fixedReport: "Copied. It is a plugin's own hook, so hoochi can't change it: send this to whoever looks after it.",
    copyHint: 'Every check, the last 7 days and the latest failures as text, to paste for whoever looks after this hook.',
  },
  ko: {
    checks: '왜 돌고, 왜 안 도나',
    output: '출력',
    runs: '실행하는 것',
    trouble: (n: number) => `지금 제대로 안 도는 훅 ${n}개`,
    troubleNone: '막히거나 실패한 훅이 없어요.',
    troubleHint:
      '훅은 Claude Code·Codex가 정해진 순간(메시지를 보낼 때, 도구를 쓰기 전 등)에 저절로 실행하는 규칙과 명령이에요. 아래는 지금 막혔거나 실패하는 것이에요. 줄을 누르면 이유가, 버튼을 누르면 바로 고쳐져요.',
    troubleMore: (n: number) => `${n}개 더`,
    outside: '밖에서 만든 훅',
    outsideHint: '설정 파일과 플러그인에 있는 훅이에요. 어떻게 끝났는지는 Claude Code가 남긴 실행 기록에서 읽어요.',
    outsideNone: '이 자리에는 없어요.',
    ruleOf: '후치로 넣은 것',
    week: '최근 7일',
    wFails: '실패',
    wTimeouts: '시간 초과',
    wChats: '대화',
    w24: '지난 24시간',
    weekTag: (n: number) => `7일 ${n}번 실패`,
    copy: '진단 복사',
    copied: '복사했어요',
    fixOpen: '열어서 고치기',
    fixConnect: 'Codex 연결',
    fixTools: (tools: string) => `도구를 "${tools}"로 고치기`,
    fixTimeout: (s: number) => `한도 ${s}초로 늘리기`,
    fixReport: '진단 복사해 담당자에게',
    fixedTools: '도구 이름을 고쳤어요.',
    fixedTimeout: (s: number) => `한도를 ${s}초로 늘렸어요.`,
    fixedReport: '복사했어요. 플러그인 자체 훅이라 후치가 고칠 수 없어요. 이 훅을 맡은 사람에게 붙여 보내 주세요.',
    copyHint: '확인한 것, 최근 7일, 최근 실패를 글로 복사해요. 이 훅을 맡은 사람에게 그대로 붙여 보내면 돼요.',
  },
  ja: {
    checks: '動く理由・動かない理由',
    output: '出力',
    runs: '実行するもの',
    trouble: (n: number) => `いまちゃんと動いていないフック ${n} 件`,
    troubleNone: '止まっている・失敗しているフックはありません。',
    troubleHint:
      'フックは Claude Code・Codex が決まったタイミング(メッセージを送るとき、ツールを使う前など)に自動で実行するルールとコマンドです。下はいま止まっているか失敗しているものです。行を押すと理由、ボタンを押すとすぐ直ります。',
    troubleMore: (n: number) => `ほか ${n} 件`,
    outside: 'ほかで設定されたフック',
    outsideHint: '設定ファイルとプラグインにあるフックです。どう終わったかは Claude Code が残した実行記録から読みます。',
    outsideNone: 'この場所にはありません。',
    ruleOf: 'hoochi で入れたもの',
    week: '直近 7 日',
    wFails: '失敗',
    wTimeouts: 'タイムアウト',
    wChats: '会話',
    w24: '直近 24 時間',
    weekTag: (n: number) => `7 日で ${n} 回失敗`,
    copy: '診断をコピー',
    copied: 'コピーしました',
    fixOpen: '開いて直す',
    fixConnect: 'Codex を接続',
    fixTools: (tools: string) => `ツールを "${tools}" に直す`,
    fixTimeout: (s: number) => `制限を ${s} 秒に延ばす`,
    fixReport: '診断をコピーして担当者へ',
    fixedTools: 'ツール名を直しました。',
    fixedTimeout: (s: number) => `制限を ${s} 秒に延ばしました。`,
    fixedReport: 'コピーしました。プラグイン自身のフックなので hoochi では直せません。担当者に送ってください。',
    copyHint: '確認したこと、直近 7 日、最近の失敗をテキストでコピーします。このフックの担当者にそのまま送れます。',
  },
  zh: {
    checks: '为什么运行，为什么不运行',
    output: '输出',
    runs: '运行的内容',
    trouble: (n: number) => `现在没有正常运行的钩子 ${n} 个`,
    troubleNone: '没有卡住或失败的钩子。',
    troubleHint:
      '钩子是 Claude Code 和 Codex 在固定时刻(发送消息时、使用工具前等)自动执行的规则和命令。下面这些现在卡住或失败了:点一行看原因,点按钮直接修复。',
    troubleMore: (n: number) => `还有 ${n} 个`,
    outside: '别处设置的钩子',
    outsideHint: '来自设置文件和插件的钩子。运行结果读取自 Claude Code 留下的记录。',
    outsideNone: '这个位置没有。',
    ruleOf: '用 hoochi 放进去的',
    week: '最近 7 天',
    wFails: '失败',
    wTimeouts: '超时',
    wChats: '对话',
    w24: '最近 24 小时',
    weekTag: (n: number) => `7 天失败 ${n} 次`,
    copy: '复制诊断',
    copied: '已复制',
    fixOpen: '打开修复',
    fixConnect: '连接 Codex',
    fixTools: (tools: string) => `把工具改成 "${tools}"`,
    fixTimeout: (s: number) => `把限制延长到 ${s} 秒`,
    fixReport: '复制诊断发给负责人',
    fixedTools: '已修正工具名称。',
    fixedTimeout: (s: number) => `限制已延长到 ${s} 秒。`,
    fixedReport: '已复制。这是插件自带的钩子,hoochi 无法修改:请发给负责它的人。',
    copyHint: '把检查项、最近 7 天和最近的失败复制成文字,直接发给负责这个钩子的人。',
  },
} satisfies Record<Lang, unknown>

/** One check as a sentence. */
export function whyWords(lang: Lang, c: Check, h: WhyHelp): string {
  switch (lang) {
    case 'ko':
      return ko(c, h)
    case 'ja':
      return ja(c, h)
    case 'zh':
      return zh(c, h)
    default:
      return en(c, h)
  }
}

function en(c: Check, h: WhyHelp): string {
  const secs = secsIn('s')
  switch (c.key) {
    case 'on': return "It's on."
    case 'off': return "It's switched off."
    case 'empty': return 'Nothing is filled in, so it puts nothing in (and does not hide the rules of wider places).'
    case 'plugin': return 'The Claude Code plugin is reporting.'
    case 'no-plugin': return 'No word from the Claude Code plugin yet. Check that it is installed and that a chat has run since.'
    case 'codex-on': return "Codex's hooks are connected."
    case 'codex-off': return c.installed ? "Codex's hooks are not connected (Connect Codex, on the Lifecycle page)." : 'Codex is not on this computer.'
    case 'blocked': return "This account never passes this moment to hoochi (an organization's policy plugin passes it by)."
    case 'came': return `This moment last came ${c.at ? h.ago(c.at) : 'before'}${c.tools.length ? `, with ${list(c.tools)}` : ''}.`
    case 'not-yet': return "This moment hasn't come yet."
    case 'in': return 'It goes in to the chat in view.'
    case 'hidden': return `${c.by ? h.place(c.by) : 'A narrower place'} has its own rule at this moment, so this one is hidden there. The narrowest place wins.`
    case 'other': return 'It is not for the chat in view (another AI or place).'
    case 'tools-ok': return `Its tools match: ${c.match}.`
    case 'tools-format': return `"${c.name}" never matches: write tool names apart with commas.`
    case 'tools-ai': return `"${c.name}" is the other AI's name for it. Here it is "${c.right}".`
    case 'tools-case': return `Tool names match case too: "${c.name}" should be "${c.right}".`
    case 'tools-miss': return `Lately ${list(c.came)} came, but this takes ${list(c.want)} only.`
    case 'tools-unknown': return `No tool has come at this moment yet (it takes ${list(c.want)}).`
    case 'matcher-ok': return `A tool its matcher "${c.matcher}" matches has come.`
    case 'matcher-miss': return `Its matcher "${c.matcher}" matches none of the tools that came lately (${list(c.came)}).`
    case 'mute': return "Words don't reach the model at this moment: only commands run here."
    case 'put-in': return `Put in ${h.ago(c.at)} · ${c.runs} ${c.runs === 1 ? 'time' : 'times'}.`
    case 'ran': return `Ran ${h.ago(c.run.at)}${c.run.ms !== undefined ? ` in ${secs(c.run.ms)}` : ''}, ended with 0.`
    case 'reported': return `${cap(h.ago(c.run.at))} it found a failure (exit ${c.run.exit}) and told Claude.`
    case 'not-found': return `${cap(h.ago(c.run.at))} the command was not found (exit ${c.run.exit}). Check its path, or that it is installed.`
    case 'exit': return `${cap(h.ago(c.run.at))} it ended with exit ${c.run.exit}.`
    case 'broken': return `${cap(h.ago(c.run.at))} it could not run: ${c.run.error ?? ''}`
    case 'timeout': return `${cap(h.ago(c.run.at))} it did not finish in time${c.limitMs ? ` (${secs(c.limitMs)} limit)` : ''}.`
    case 'cancelled': return `${cap(h.ago(c.run.at))} it was cancelled before it finished.`
    case 'blocked-on-purpose': return `${cap(h.ago(c.run.at))} it ended with 2: it stopped Claude on purpose.`
    case 'not-run': return "It hasn't run yet."
    case 'no-record': return "Claude Code's records of the last 3 days show no run of it (it does not record every kind of hook, async ones among them)."
    case 'codex-no-record': return 'Codex keeps no record of the hooks it runs.'
    case 'failed-before': return `It failed ${h.ago(c.run.at)} · ${c.fails} of ${c.runs} runs.`
    case 'week': return `In 7 days it failed ${c.w.fails} ${c.w.fails === 1 ? 'time' : 'times'}${c.w.timeouts ? ` (${c.w.timeouts} timed out)` : ''}, in ${c.w.chats} ${c.w.chats === 1 ? 'chat' : 'chats'}${c.w.fails24 ? `, ${c.w.fails24} in the last 24 hours` : ', none in the last 24 hours'}.`
    case 'often': return `It keeps failing: ${c.w.fails24} ${c.w.fails24 === 1 ? 'time' : 'times'} in the last 24 hours, ${c.w.fails} in 7 days, in ${c.w.chats} ${c.w.chats === 1 ? 'chat' : 'chats'}${c.w.timeouts ? `; ${c.w.timeouts} of them timed out${c.limitMs ? ` (${secs(c.limitMs)} limit)` : ''}` : ''}. Last ${h.ago(c.run.at)}.`
    case 'peers': return c.failing === 0
      ? `The ${c.others} other ${c.others === 1 ? 'hook' : 'hooks'} at ${c.event} failed 0 times in those days: it is this hook, not Claude Code or this computer.`
      : c.failing >= c.others
        ? `All ${c.others} other ${c.others === 1 ? 'hook' : 'hooks'} at ${c.event} failed in those days too: look at Claude Code or this computer first.`
        : `${c.failing} of the ${c.others} other hooks at ${c.event} failed in those days too.`
    case 'took': return c.near
      ? c.p50 !== undefined
        ? `Slow runs take up to ${secs(c.max)} of its ${secs(c.limitMs)} limit (usually ${secs(c.p50)}): it will be cut some day.`
        : `Its last run took ${secs(c.max)} of its ${secs(c.limitMs)} limit: it will be cut some day.`
      : `Usually ${secs(c.p50)}, slow ones ${secs(c.p90)}, at most ${secs(c.max)} (limit ${secs(c.limitMs)}, over ${c.timed} runs).`
    case 'async': return "Claude Code doesn't wait for it (async), and keeps no record of its runs."
    case 'quiet': return `No failure on record in 7 days. (At ${c.event} Claude Code records no runs that went well, so there is no count of them.)`
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function ko(c: Check, h: WhyHelp): string {
  const secs = secsIn('초')
  switch (c.key) {
    case 'on': return '켜져 있어요.'
    case 'off': return '꺼져 있어요.'
    case 'empty': return '채워진 내용이 없어서 아무것도 안 넣어요 (더 넓은 곳 규칙을 가리지도 않아요).'
    case 'plugin': return 'Claude Code 플러그인이 소식을 보내고 있어요.'
    case 'no-plugin': return 'Claude Code 플러그인에서 아직 소식이 없어요. 설치됐는지, 그 뒤로 채팅이 돌았는지 확인하세요.'
    case 'codex-on': return 'Codex 훅이 연결돼 있어요.'
    case 'codex-off': return c.installed ? 'Codex 훅이 연결돼 있지 않아요 (라이프 사이클의 Codex 연결하기).' : '이 컴퓨터에 Codex가 없어요.'
    case 'blocked': return '이 계정에선 이 순간이 후치에 오지 않아요. 조직 정책 플러그인이 넘겨 버려요.'
    case 'came': return `이 순간은 ${c.at ? h.ago(c.at) : '전에'} 마지막으로 왔어요${c.tools.length ? ` (도구: ${list(c.tools)})` : ''}.`
    case 'not-yet': return '이 순간이 아직 한 번도 오지 않았어요.'
    case 'in': return '지금 보는 채팅에 들어가요.'
    case 'hidden': return `${c.by ? h.place(c.by) : '더 좁은 곳'}에 이 순간 규칙이 따로 있어서 거기선 가려져요. 가장 좁은 곳이 이겨요.`
    case 'other': return '지금 보는 채팅의 규칙이 아니에요 (다른 AI나 다른 곳).'
    case 'tools-ok': return `도구 조건이 맞아요: ${c.match}.`
    case 'tools-format': return `"${c.name}"는 어떤 도구와도 안 맞아요. 도구 이름은 쉼표로 나눠 써야 해요.`
    case 'tools-ai': return `"${c.name}"는 다른 AI가 쓰는 이름이에요. 여기선 "${c.right}"예요.`
    case 'tools-case': return `도구 이름은 대소문자까지 같아야 해요: "${c.name}" → "${c.right}".`
    case 'tools-miss': return `최근 온 도구는 ${list(c.came)}인데, 이 규칙은 ${list(c.want)}만 받아요.`
    case 'tools-unknown': return `이 순간에 아직 어떤 도구도 오지 않았어요 (이 규칙: ${list(c.want)}).`
    case 'matcher-ok': return `매처 "${c.matcher}"에 맞는 도구가 왔어요.`
    case 'matcher-miss': return `매처 "${c.matcher}"가 최근 온 도구(${list(c.came)})와 하나도 맞지 않아요.`
    case 'mute': return '이 순간엔 말이 모델에 닿지 않아요. 여기선 명령만 돌아요.'
    case 'put-in': return `${h.ago(c.at)} 넣었어요 · ${c.runs}번.`
    case 'ran': return `${h.ago(c.run.at)} 돌았어요${c.run.ms !== undefined ? ` (${secs(c.run.ms)})` : ''}. 0으로 끝났어요.`
    case 'reported': return `${h.ago(c.run.at)} 실패를 찾아 Claude에게 알려 줬어요 (exit ${c.run.exit}).`
    case 'not-found': return `${h.ago(c.run.at)} 명령을 찾지 못했어요 (exit ${c.run.exit}). 경로나 설치를 확인하세요.`
    case 'exit': return `${h.ago(c.run.at)} exit ${c.run.exit}로 끝났어요.`
    case 'broken': return `${h.ago(c.run.at)} 실행하지 못했어요: ${c.run.error ?? ''}`
    case 'timeout': return `${h.ago(c.run.at)} 시간 안에 끝나지 않았어요${c.limitMs ? ` (한도 ${secs(c.limitMs)})` : ''}.`
    case 'cancelled': return `${h.ago(c.run.at)} 끝나기 전에 취소됐어요.`
    case 'blocked-on-purpose': return `${h.ago(c.run.at)} exit 2로 끝났어요. Claude를 일부러 멈춘 거예요.`
    case 'not-run': return '아직 안 돌았어요.'
    case 'no-record': return '최근 3일 Claude Code 기록에 실행한 흔적이 없어요 (비동기 훅처럼 기록을 남기지 않는 훅도 있어요).'
    case 'codex-no-record': return 'Codex는 훅을 실행한 결과를 남기지 않아요.'
    case 'failed-before': return `${h.ago(c.run.at)} 실패한 적이 있어요 · ${c.runs}번 중 ${c.fails}번.`
    case 'week': return `최근 7일 ${c.w.fails}번 실패${c.w.timeouts ? `(시간 초과 ${c.w.timeouts}번)` : ''}, 대화 ${c.w.chats}곳${c.w.fails24 ? ` · 지난 24시간 ${c.w.fails24}번` : ' · 지난 24시간에는 없음'}.`
    case 'often': return `계속 실패해요: 지난 24시간 ${c.w.fails24}번, 7일 ${c.w.fails}번, 대화 ${c.w.chats}곳${c.w.timeouts ? `. 그중 ${c.w.timeouts}번은 시간 초과${c.limitMs ? `(한도 ${secs(c.limitMs)})` : ''}` : ''}. 마지막은 ${h.ago(c.run.at)}.`
    case 'peers': return c.failing === 0
      ? `같은 순간(${c.event})에 도는 다른 훅 ${c.others}개는 같은 기간 실패 0번이에요. Claude Code나 이 컴퓨터가 아니라 이 훅의 문제예요.`
      : c.failing >= c.others
        ? `같은 순간(${c.event})의 다른 훅 ${c.others}개도 모두 같은 기간 실패했어요. 이 훅보다 Claude Code나 이 컴퓨터 쪽을 먼저 보세요.`
        : `같은 순간(${c.event})의 다른 훅 ${c.others}개 중 ${c.failing}개도 같은 기간 실패했어요.`
    case 'took': return c.near
      ? c.p50 !== undefined
        ? `느릴 때 한도 ${secs(c.limitMs)} 중 ${secs(c.max)}까지 걸려요(보통 ${secs(c.p50)}). 언젠가 시간 초과로 끊겨요.`
        : `마지막 실행이 한도 ${secs(c.limitMs)} 중 ${secs(c.max)} 걸렸어요. 언젠가 시간 초과로 끊겨요.`
      : `보통 ${secs(c.p50)}, 느릴 때 ${secs(c.p90)}, 가장 길게 ${secs(c.max)} 걸려요(한도 ${secs(c.limitMs)}, ${c.timed}번 기준).`
    case 'async': return 'Claude Code가 기다리지 않는 훅(async)이라 실행 기록이 남지 않아요.'
    case 'quiet': return `7일 동안 실패 기록이 없어요. (${c.event}에서는 Claude Code가 성공한 실행을 기록하지 않아 몇 번 돌았는지는 알 수 없어요.)`
  }
}

function ja(c: Check, h: WhyHelp): string {
  const secs = secsIn('秒')
  switch (c.key) {
    case 'on': return 'オンです。'
    case 'off': return 'オフになっています。'
    case 'empty': return '中身が空なので何も入りません（より広い場所のルールを隠すこともありません）。'
    case 'plugin': return 'Claude Code のプラグインから知らせが届いています。'
    case 'no-plugin': return 'Claude Code のプラグインからまだ知らせがありません。インストールされているか、その後チャットが動いたか確かめてください。'
    case 'codex-on': return 'Codex のフックはつながっています。'
    case 'codex-off': return c.installed ? 'Codex のフックがつながっていません（ライフサイクルの「Codex を接続」）。' : 'このコンピューターに Codex がありません。'
    case 'blocked': return 'このアカウントではこの瞬間が hoochi に届きません（組織のポリシープラグインが素通りさせます）。'
    case 'came': return `この瞬間が最後に来たのは${c.at ? h.ago(c.at) : '以前'}です${c.tools.length ? `（ツール: ${list(c.tools)}）` : ''}。`
    case 'not-yet': return 'この瞬間はまだ一度も来ていません。'
    case 'in': return '見ているチャットに入ります。'
    case 'hidden': return `${c.by ? h.place(c.by) : 'より狭い場所'}にこの瞬間のルールが別にあるので、そこでは隠れます。いちばん狭い場所が勝ちます。`
    case 'other': return '見ているチャットのルールではありません（別の AI か別の場所）。'
    case 'tools-ok': return `ツールの条件が合っています: ${c.match}。`
    case 'tools-format': return `「${c.name}」はどのツールにも合いません。ツール名はカンマで区切ってください。`
    case 'tools-ai': return `「${c.name}」はもう一方の AI の名前です。ここでは「${c.right}」です。`
    case 'tools-case': return `ツール名は大文字・小文字まで同じでないと合いません: 「${c.name}」→「${c.right}」。`
    case 'tools-miss': return `最近来たツールは ${list(c.came)} ですが、このルールは ${list(c.want)} だけを受けます。`
    case 'tools-unknown': return `この瞬間にまだツールが来ていません（このルール: ${list(c.want)}）。`
    case 'matcher-ok': return `マッチャー「${c.matcher}」に合うツールが来ています。`
    case 'matcher-miss': return `マッチャー「${c.matcher}」が最近来たツール（${list(c.came)}）のどれにも合いません。`
    case 'mute': return 'この瞬間には言葉がモデルに届きません。ここではコマンドだけが動きます。'
    case 'put-in': return `${h.ago(c.at)}に入れました · ${c.runs} 回。`
    case 'ran': return `${h.ago(c.run.at)}に動きました${c.run.ms !== undefined ? `（${secs(c.run.ms)}）` : ''}。0 で終わりました。`
    case 'reported': return `${h.ago(c.run.at)}に失敗を見つけて Claude に伝えました（exit ${c.run.exit}）。`
    case 'not-found': return `${h.ago(c.run.at)}にコマンドが見つかりませんでした（exit ${c.run.exit}）。パスやインストールを確かめてください。`
    case 'exit': return `${h.ago(c.run.at)}に exit ${c.run.exit} で終わりました。`
    case 'broken': return `${h.ago(c.run.at)}に実行できませんでした: ${c.run.error ?? ''}`
    case 'timeout': return `${h.ago(c.run.at)}に時間内に終わりませんでした${c.limitMs ? `（上限 ${secs(c.limitMs)}）` : ''}。`
    case 'cancelled': return `${h.ago(c.run.at)}に終わる前に取り消されました。`
    case 'blocked-on-purpose': return `${h.ago(c.run.at)}に 2 で終わりました。わざと Claude を止めたものです。`
    case 'not-run': return 'まだ動いていません。'
    case 'no-record': return 'ここ 3 日の Claude Code の記録に実行の跡がありません（非同期のフックなど、記録が残らないものもあります）。'
    case 'codex-no-record': return 'Codex はフックを実行した結果を残しません。'
    case 'failed-before': return `${h.ago(c.run.at)}に失敗したことがあります · ${c.runs} 回中 ${c.fails} 回。`
    case 'week': return `直近 7 日で ${c.w.fails} 回失敗${c.w.timeouts ? `(うちタイムアウト ${c.w.timeouts} 回)` : ''}、会話 ${c.w.chats} 件${c.w.fails24 ? ` · 直近 24 時間で ${c.w.fails24} 回` : ' · 直近 24 時間はなし'}。`
    case 'often': return `失敗が続いています: 直近 24 時間で ${c.w.fails24} 回、7 日で ${c.w.fails} 回、会話 ${c.w.chats} 件${c.w.timeouts ? `。うち ${c.w.timeouts} 回はタイムアウト${c.limitMs ? `(制限 ${secs(c.limitMs)})` : ''}` : ''}。最後は${h.ago(c.run.at)}。`
    case 'peers': return c.failing === 0
      ? `同じタイミング(${c.event})で動くほかのフック ${c.others} 件は同じ期間に失敗 0 回です。Claude Code やこのコンピューターではなく、このフックの問題です。`
      : c.failing >= c.others
        ? `同じタイミング(${c.event})のほかのフック ${c.others} 件もすべて同じ期間に失敗しています。このフックより先に Claude Code やこのコンピューターを見てください。`
        : `同じタイミング(${c.event})のほかのフック ${c.others} 件のうち ${c.failing} 件も同じ期間に失敗しています。`
    case 'took': return c.near
      ? c.p50 !== undefined
        ? `遅いときは制限 ${secs(c.limitMs)} のうち ${secs(c.max)} かかります(ふだんは ${secs(c.p50)})。いつかタイムアウトで切られます。`
        : `前回の実行は制限 ${secs(c.limitMs)} のうち ${secs(c.max)} かかりました。いつかタイムアウトで切られます。`
      : `ふだん ${secs(c.p50)}、遅いとき ${secs(c.p90)}、最長 ${secs(c.max)}(制限 ${secs(c.limitMs)}、${c.timed} 回分)。`
    case 'async': return 'Claude Code が待たないフック(async)なので、実行記録は残りません。'
    case 'quiet': return `7 日間、失敗の記録はありません。(${c.event} では Claude Code がうまくいった実行を記録しないので、何回動いたかはわかりません。)`
  }
}

function zh(c: Check, h: WhyHelp): string {
  const secs = secsIn('秒')
  switch (c.key) {
    case 'on': return '已开启。'
    case 'off': return '已关闭。'
    case 'empty': return '内容是空的，所以什么也不会放进去（也不会遮住更宽位置的规则）。'
    case 'plugin': return 'Claude Code 插件正在报告。'
    case 'no-plugin': return '还没收到 Claude Code 插件的消息。请确认已安装，并且之后有对话运行过。'
    case 'codex-on': return 'Codex 的钩子已连接。'
    case 'codex-off': return c.installed ? 'Codex 的钩子没有连接（在生命周期里点“连接 Codex”）。' : '这台电脑上没有 Codex。'
    case 'blocked': return '这个账号不会把这个时刻交给 hoochi（组织的策略插件会直接放过它）。'
    case 'came': return `这个时刻最近一次是${c.at ? h.ago(c.at) : '以前'}来的${c.tools.length ? `（工具：${list(c.tools)}）` : ''}。`
    case 'not-yet': return '这个时刻还一次都没来过。'
    case 'in': return '会放进正在看的对话。'
    case 'hidden': return `${c.by ? h.place(c.by) : '更窄的位置'}在这个时刻有自己的规则，所以这一项在那里被遮住。最窄的位置优先。`
    case 'other': return '不是正在看的对话的规则（别的 AI 或别的位置）。'
    case 'tools-ok': return `工具条件符合：${c.match}。`
    case 'tools-format': return `“${c.name}”不会匹配任何工具。工具名要用逗号分开。`
    case 'tools-ai': return `“${c.name}”是另一个 AI 的叫法，这里是“${c.right}”。`
    case 'tools-case': return `工具名连大小写也要一致：“${c.name}”→“${c.right}”。`
    case 'tools-miss': return `最近来的工具是 ${list(c.came)}，但这条规则只接受 ${list(c.want)}。`
    case 'tools-unknown': return `这个时刻还没有工具来过（这条规则：${list(c.want)}）。`
    case 'matcher-ok': return `有符合匹配器“${c.matcher}”的工具来过。`
    case 'matcher-miss': return `匹配器“${c.matcher}”和最近来的工具（${list(c.came)}）一个都不符合。`
    case 'mute': return '这个时刻的话传不到模型，这里只能运行命令。'
    case 'put-in': return `${h.ago(c.at)}放进去了 · ${c.runs} 次。`
    case 'ran': return `${h.ago(c.run.at)}运行了${c.run.ms !== undefined ? `（${secs(c.run.ms)}）` : ''}，以 0 结束。`
    case 'reported': return `${h.ago(c.run.at)}发现失败并告诉了 Claude（exit ${c.run.exit}）。`
    case 'not-found': return `${h.ago(c.run.at)}找不到命令（exit ${c.run.exit}）。请检查路径或是否已安装。`
    case 'exit': return `${h.ago(c.run.at)}以 exit ${c.run.exit} 结束。`
    case 'broken': return `${h.ago(c.run.at)}没能运行：${c.run.error ?? ''}`
    case 'timeout': return `${h.ago(c.run.at)}没能在时限内结束${c.limitMs ? `（上限 ${secs(c.limitMs)}）` : ''}。`
    case 'cancelled': return `${h.ago(c.run.at)}在结束前被取消了。`
    case 'blocked-on-purpose': return `${h.ago(c.run.at)}以 2 结束，是故意让 Claude 停下的。`
    case 'not-run': return '还没运行过。'
    case 'no-record': return '最近 3 天的 Claude Code 记录里没有它运行的痕迹（异步钩子等有些钩子不会留下记录）。'
    case 'codex-no-record': return 'Codex 不会留下运行钩子的结果。'
    case 'failed-before': return `${h.ago(c.run.at)}失败过 · ${c.runs} 次中 ${c.fails} 次。`
    case 'week': return `最近 7 天失败 ${c.w.fails} 次${c.w.timeouts ? `(其中超时 ${c.w.timeouts} 次)` : ''},涉及 ${c.w.chats} 个对话${c.w.fails24 ? ` · 最近 24 小时 ${c.w.fails24} 次` : ' · 最近 24 小时没有'}。`
    case 'often': return `一直在失败:最近 24 小时 ${c.w.fails24} 次,7 天 ${c.w.fails} 次,涉及 ${c.w.chats} 个对话${c.w.timeouts ? `。其中 ${c.w.timeouts} 次超时${c.limitMs ? `(限制 ${secs(c.limitMs)})` : ''}` : ''}。最近一次在${h.ago(c.run.at)}。`
    case 'peers': return c.failing === 0
      ? `同一时刻(${c.event})运行的其他 ${c.others} 个钩子在这段时间失败 0 次。问题在这个钩子,不在 Claude Code 或这台电脑。`
      : c.failing >= c.others
        ? `同一时刻(${c.event})的其他 ${c.others} 个钩子在这段时间也都失败了。先查看 Claude Code 或这台电脑。`
        : `同一时刻(${c.event})的其他 ${c.others} 个钩子中有 ${c.failing} 个在这段时间也失败了。`
    case 'took': return c.near
      ? c.p50 !== undefined
        ? `慢的时候要用掉限制 ${secs(c.limitMs)} 中的 ${secs(c.max)}(平常 ${secs(c.p50)})。迟早会因超时被中断。`
        : `上次运行用掉了限制 ${secs(c.limitMs)} 中的 ${secs(c.max)}。迟早会因超时被中断。`
      : `平常 ${secs(c.p50)},慢的时候 ${secs(c.p90)},最长 ${secs(c.max)}(限制 ${secs(c.limitMs)},按 ${c.timed} 次计)。`
    case 'async': return 'Claude Code 不等待这个钩子(async),所以不会留下运行记录。'
    case 'quiet': return `7 天内没有失败记录。(在 ${c.event},Claude Code 不记录成功的运行,所以不知道运行了几次。)`
  }
}
