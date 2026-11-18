// Every word the window shows, in plain language, in four languages.
// Event names stay the real hook names underneath; people see the plain ones.

export type Lang = 'en' | 'ko' | 'ja' | 'zh'

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ko', label: '한국어' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
]

export function detectLang(): Lang {
  const asked = new URLSearchParams(location.search).get('lang')
  if (asked === 'en' || asked === 'ko' || asked === 'ja' || asked === 'zh') return asked
  try {
    const saved = localStorage.getItem('hookwich.lang')
    if (saved === 'en' || saved === 'ko' || saved === 'ja' || saved === 'zh') return saved
  } catch {
    // no storage: fall back to the system language
  }
  const sys = (navigator.language || 'en').toLowerCase()
  if (sys.startsWith('ko')) return 'ko'
  if (sys.startsWith('ja')) return 'ja'
  if (sys.startsWith('zh')) return 'zh'
  return 'en'
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem('hookwich.lang', lang)
  } catch {
    // remembered for this run only
  }
}

/** Plain name and one-line explanation of each moment, per language. */
type EventText = { name: string; hint: string }
type PerLang<T> = Record<Lang, T>

const e = (en: [string, string], ko: [string, string], ja: [string, string], zh: [string, string]) =>
  ({
    en: { name: en[0], hint: en[1] },
    ko: { name: ko[0], hint: ko[1] },
    ja: { name: ja[0], hint: ja[1] },
    zh: { name: zh[0], hint: zh[1] },
  }) satisfies PerLang<EventText>

const ONLY_CMD = {
  en: ' Only commands run here; Claude does not see the result.',
  ko: ' 여기서는 명령만 돌아가요. Claude는 결과를 보지 못해요.',
  ja: ' ここではコマンドだけが動きます。Claude には結果が見えません。',
  zh: ' 这里只能运行命令，Claude 看不到结果。',
}

export const EVENTS: Record<string, PerLang<EventText>> = {
  Setup: e(
    ['First-time setup', 'When Claude Code is set up for the first time (only if you turn it on).'],
    ['처음 설정할 때', 'Claude Code를 처음 설정할 때예요. 켜 둔 경우에만 일어나요.'],
    ['初回セットアップ', 'Claude Code を初めて設定するとき（有効にした場合のみ）。'],
    ['首次设置', '第一次设置 Claude Code 时（只有开启时才会发生）。'],
  ),
  SessionStart: e(
    ['Chat starts', 'When a chat starts, is reopened or cleared. What you put here is told to Claude first.'],
    [
      '대화 시작',
      '대화를 새로 열거나, 다시 열거나, 비울 때예요. 여기에 넣은 말을 Claude가 가장 먼저 들어요.',
    ],
    [
      '会話の開始',
      '会話を始めたとき・再開したとき・消去したとき。ここに入れた内容を Claude が最初に聞きます。',
    ],
    ['对话开始', '开始、重新打开或清空对话时。放在这里的内容会最先告诉 Claude。'],
  ),
  UserPromptSubmit: e(
    ['You send a message', 'Every time you send a message, this goes along with it.'],
    ['내가 메시지를 보낼 때', '메시지를 보낼 때마다 여기에 넣은 말이 함께 가요.'],
    ['メッセージを送るとき', 'メッセージを送るたびに、ここに入れた内容が一緒に届きます。'],
    ['发送消息时', '每次发送消息时，这里的内容会一起发过去。'],
  ),
  UserPromptExpansion: e(
    ['A /command opens up', 'When a shortcut like /review turns into a full request.'],
    ['/명령이 펼쳐질 때', '/review 같은 단축 명령이 실제 요청으로 바뀔 때예요.'],
    ['/コマンドが展開されるとき', '/review のような短縮コマンドが実際の依頼に変わるとき。'],
    ['/命令展开时', '像 /review 这样的快捷命令变成完整请求时。'],
  ),
  PreToolUse: e(
    ['Before Claude uses a tool', 'Each time Claude is about to use a tool (run a command, edit a file…).'],
    ['Claude가 도구를 쓰기 전', 'Claude가 명령을 돌리거나 파일을 고치는 등 도구를 쓰기 직전마다예요.'],
    ['ツールを使う前', 'Claude がコマンド実行やファイル編集などのツールを使う直前に毎回。'],
    ['使用工具前', '每次 Claude 准备使用工具（运行命令、修改文件等）之前。'],
  ),
  PermissionRequest: e(
    ['Asks your permission', 'When Claude asks you to allow something.' + ONLY_CMD.en],
    ['허락을 물을 때', 'Claude가 무언가를 해도 되는지 물을 때예요.' + ONLY_CMD.ko],
    ['許可を求めるとき', 'Claude が何かをしてよいか尋ねるとき。' + ONLY_CMD.ja],
    ['请求许可时', 'Claude 请你允许某个操作时。' + ONLY_CMD.zh],
  ),
  PermissionDenied: e(
    ['Permission refused', 'When an action is refused automatically.' + ONLY_CMD.en],
    ['허락이 거절됐을 때', '어떤 동작이 자동으로 거절됐을 때예요.' + ONLY_CMD.ko],
    ['許可が拒否されたとき', '操作が自動で拒否されたとき。' + ONLY_CMD.ja],
    ['许可被拒绝时', '某个操作被自动拒绝时。' + ONLY_CMD.zh],
  ),
  Elicitation: e(
    ['An app asks for input', 'When a connected app asks you to fill something in.' + ONLY_CMD.en],
    ['앱이 입력을 요청할 때', '연결된 앱이 무언가를 입력해 달라고 할 때예요.' + ONLY_CMD.ko],
    ['アプリが入力を求めるとき', '連携アプリが入力を求めたとき。' + ONLY_CMD.ja],
    ['应用请求输入时', '连接的应用请你填写内容时。' + ONLY_CMD.zh],
  ),
  ElicitationResult: e(
    ['Input sent back', 'When your answer goes back to that app.' + ONLY_CMD.en],
    ['입력을 돌려줄 때', '내가 입력한 답이 그 앱으로 돌아갈 때예요.' + ONLY_CMD.ko],
    ['入力を返すとき', '入力した内容がそのアプリに戻るとき。' + ONLY_CMD.ja],
    ['输入返回时', '你的回答返回给那个应用时。' + ONLY_CMD.zh],
  ),
  PostToolUse: e(
    ['After a tool is used', 'Right after each tool finishes; Claude reads this with the result.'],
    ['도구를 쓴 뒤', '도구를 쓴 직후마다예요. Claude가 결과와 함께 읽어요.'],
    ['ツールを使った後', 'ツールを使った直後に毎回。Claude が結果と一緒に読みます。'],
    ['使用工具后', '每次工具用完之后，Claude 会和结果一起读到。'],
  ),
  PostToolUseFailure: e(
    ['A tool failed', 'When a tool did not work; Claude reads this with the error.'],
    ['도구가 실패했을 때', '도구가 제대로 안 됐을 때예요. Claude가 오류와 함께 읽어요.'],
    ['ツールが失敗したとき', 'ツールがうまく動かなかったとき。Claude がエラーと一緒に読みます。'],
    ['工具失败时', '工具没能成功时，Claude 会和错误一起读到。'],
  ),
  PostToolBatch: e(
    ['After several tools', 'After Claude used a few tools at once.'],
    ['도구 여러 개를 쓴 뒤', 'Claude가 도구 여러 개를 한꺼번에 쓴 뒤예요.'],
    ['複数のツールの後', 'Claude が複数のツールをまとめて使った後。'],
    ['多个工具之后', 'Claude 同时用了几个工具之后。'],
  ),
  SubagentStart: e(
    ['Helper starts', 'When Claude hands part of the work to a helper.'],
    ['도우미가 시작할 때', 'Claude가 일의 일부를 도우미에게 맡길 때예요.'],
    ['ヘルパー開始', 'Claude が作業の一部をヘルパーに任せたとき。'],
    ['助手开始', 'Claude 把部分工作交给助手时。'],
  ),
  SubagentStop: e(
    ['Helper finishes', 'When a helper is about to finish; it keeps going once with this.'],
    ['도우미가 끝날 때', '도우미가 일을 마치려 할 때예요. 이 말을 받고 한 번 더 이어서 해요.'],
    ['ヘルパー終了', 'ヘルパーが終わろうとするとき。これを受けてもう一度だけ続けます。'],
    ['助手结束', '助手快要结束时，会根据这里的内容再继续一次。'],
  ),
  TaskCreated: e(
    ['To-do added', 'When a to-do item is created.' + ONLY_CMD.en],
    ['할 일이 생길 때', '할 일 항목이 새로 생길 때예요.' + ONLY_CMD.ko],
    ['タスク追加', 'タスクが作られたとき。' + ONLY_CMD.ja],
    ['新增待办', '创建待办事项时。' + ONLY_CMD.zh],
  ),
  TaskCompleted: e(
    ['To-do done', 'When a to-do item is finished.' + ONLY_CMD.en],
    ['할 일을 끝냈을 때', '할 일 항목을 끝냈을 때예요.' + ONLY_CMD.ko],
    ['タスク完了', 'タスクが終わったとき。' + ONLY_CMD.ja],
    ['待办完成', '待办事项完成时。' + ONLY_CMD.zh],
  ),
  Stop: e(
    ['Answer ends', 'When Claude is about to finish answering; it keeps going once with this.'],
    ['답을 마칠 때', 'Claude가 답을 마치려 할 때예요. 이 말을 받고 한 번 더 이어서 해요.'],
    ['回答の終わり', 'Claude が回答を終えようとするとき。これを受けてもう一度だけ続けます。'],
    ['回答结束', 'Claude 快要回答完时，会根据这里的内容再继续一次。'],
  ),
  StopFailure: e(
    ['Answer broke off', 'When an answer stopped because of an error.' + ONLY_CMD.en],
    ['오류로 멈출 때', '답하다가 오류로 멈췄을 때예요.' + ONLY_CMD.ko],
    ['エラーで中断', '回答がエラーで止まったとき。' + ONLY_CMD.ja],
    ['出错中断', '回答因错误而中断时。' + ONLY_CMD.zh],
  ),
  TeammateIdle: e(
    ['Teammate waits', 'When another Claude on the team has nothing to do.' + ONLY_CMD.en],
    ['팀원이 쉴 때', '함께 일하는 다른 Claude가 할 일이 없을 때예요.' + ONLY_CMD.ko],
    ['チームメイト待機', 'チームの別の Claude が手すきになったとき。' + ONLY_CMD.ja],
    ['队友空闲', '团队里另一个 Claude 没事可做时。' + ONLY_CMD.zh],
  ),
  PreCompact: e(
    ['Before the chat is shortened', 'Before a long chat is summed up to save room.' + ONLY_CMD.en],
    ['대화를 줄이기 전', '긴 대화를 요약해 줄이기 직전이에요.' + ONLY_CMD.ko],
    ['会話を短くする前', '長い会話を要約して短くする前。' + ONLY_CMD.ja],
    ['缩短对话前', '长对话被总结缩短之前。' + ONLY_CMD.zh],
  ),
  PostCompact: e(
    ['After the chat is shortened', 'After a long chat was summed up.' + ONLY_CMD.en],
    ['대화를 줄인 뒤', '긴 대화를 요약해 줄인 뒤예요.' + ONLY_CMD.ko],
    ['会話を短くした後', '長い会話を要約した後。' + ONLY_CMD.ja],
    ['缩短对话后', '长对话被总结之后。' + ONLY_CMD.zh],
  ),
  SessionEnd: e(
    ['Chat ends', 'When the chat is closed.' + ONLY_CMD.en],
    ['대화 끝', '대화를 닫을 때예요.' + ONLY_CMD.ko],
    ['会話の終わり', '会話を閉じたとき。' + ONLY_CMD.ja],
    ['对话结束', '关闭对话时。' + ONLY_CMD.zh],
  ),
  Notification: e(
    ['Sends a notice', 'When Claude Code shows you a notification.' + ONLY_CMD.en],
    ['알림을 보낼 때', 'Claude Code가 알림을 띄울 때예요.' + ONLY_CMD.ko],
    ['通知を出すとき', 'Claude Code が通知を出したとき。' + ONLY_CMD.ja],
    ['发送通知时', 'Claude Code 弹出通知时。' + ONLY_CMD.zh],
  ),
  ConfigChange: e(
    ['Settings change', 'When the settings are changed.' + ONLY_CMD.en],
    ['설정이 바뀔 때', '설정이 바뀌었을 때예요.' + ONLY_CMD.ko],
    ['設定が変わるとき', '設定が変更されたとき。' + ONLY_CMD.ja],
    ['设置变更时', '设置被修改时。' + ONLY_CMD.zh],
  ),
  PreModelSwitch: e(
    ['Before changing model', 'Before you switch to another Claude model.' + ONLY_CMD.en],
    ['모델을 바꾸기 전', '다른 Claude 모델로 바꾸기 직전이에요.' + ONLY_CMD.ko],
    ['モデル切替の前', '別の Claude モデルに切り替える前。' + ONLY_CMD.ja],
    ['切换模型前', '切换到另一个 Claude 模型之前。' + ONLY_CMD.zh],
  ),
  PostModelSwitch: e(
    ['After changing model', 'After you switched to another Claude model.'],
    ['모델을 바꾼 뒤', '다른 Claude 모델로 바꾼 뒤예요.'],
    ['モデル切替の後', '別の Claude モデルに切り替えた後。'],
    ['切换模型后', '切换到另一个 Claude 模型之后。'],
  ),
  WorktreeCreate: e(
    ['Work copy made', 'When a separate copy of the project is made to work in.' + ONLY_CMD.en],
    ['작업 사본을 만들 때', '따로 일하려고 프로젝트 사본을 만들 때예요.' + ONLY_CMD.ko],
    ['作業用コピー作成', '作業用にプロジェクトの別コピーを作ったとき。' + ONLY_CMD.ja],
    ['创建工作副本', '为单独工作创建项目副本时。' + ONLY_CMD.zh],
  ),
  WorktreeRemove: e(
    ['Work copy removed', 'When that separate copy is deleted.' + ONLY_CMD.en],
    ['작업 사본을 지울 때', '그 사본을 지울 때예요.' + ONLY_CMD.ko],
    ['作業用コピー削除', 'その別コピーを削除したとき。' + ONLY_CMD.ja],
    ['删除工作副本', '删除那个副本时。' + ONLY_CMD.zh],
  ),
  CwdChanged: e(
    ['Folder changed', 'When Claude moves to another folder.' + ONLY_CMD.en],
    ['폴더가 바뀔 때', 'Claude가 다른 폴더로 옮겨 갈 때예요.' + ONLY_CMD.ko],
    ['フォルダ移動', 'Claude が別のフォルダに移ったとき。' + ONLY_CMD.ja],
    ['切换文件夹', 'Claude 换到另一个文件夹时。' + ONLY_CMD.zh],
  ),
  FileChanged: e(
    ['File changed', 'When a watched file changes.' + ONLY_CMD.en],
    ['파일이 바뀔 때', '지켜보는 파일이 바뀔 때예요.' + ONLY_CMD.ko],
    ['ファイル変更', '見張っているファイルが変わったとき。' + ONLY_CMD.ja],
    ['文件变更', '被关注的文件发生变化时。' + ONLY_CMD.zh],
  ),
  DirectoryAdded: e(
    ['Folder added', 'When a folder is added to the chat.' + ONLY_CMD.en],
    ['폴더를 더할 때', '대화에 폴더를 더할 때예요.' + ONLY_CMD.ko],
    ['フォルダ追加', '会話にフォルダを追加したとき。' + ONLY_CMD.ja],
    ['添加文件夹', '向对话添加文件夹时。' + ONLY_CMD.zh],
  ),
  InstructionsLoaded: e(
    ['Rules file read', 'When Claude reads your rules file (CLAUDE.md).' + ONLY_CMD.en],
    ['지침 파일을 읽을 때', 'Claude가 지침 파일(CLAUDE.md)을 읽을 때예요.' + ONLY_CMD.ko],
    ['ルールファイル読込', 'Claude がルールファイル（CLAUDE.md）を読んだとき。' + ONLY_CMD.ja],
    ['读取规则文件', 'Claude 读取规则文件（CLAUDE.md）时。' + ONLY_CMD.zh],
  ),
  MessageDisplay: e(
    ['Message shown', 'When a message appears on screen.' + ONLY_CMD.en],
    ['메시지를 보여 줄 때', '메시지가 화면에 나타날 때예요.' + ONLY_CMD.ko],
    ['メッセージ表示', 'メッセージが画面に表示されたとき。' + ONLY_CMD.ja],
    ['显示消息时', '消息显示在屏幕上时。' + ONLY_CMD.zh],
  ),
  PreModelRequest: e(
    ['Before asking the model', 'Right before the agent sends a request to the AI model.' + ONLY_CMD.en],
    ['모델에 묻기 전', '에이전트가 AI 모델에게 요청을 보내기 직전이에요.' + ONLY_CMD.ko],
    ['モデルに聞く前', 'エージェントが AI モデルに依頼を送る直前。' + ONLY_CMD.ja],
    ['请求模型前', '代理向 AI 模型发送请求之前。' + ONLY_CMD.zh],
  ),
  PostModelRequest: e(
    ['Model answered', 'Right after the AI model replied (or failed).' + ONLY_CMD.en],
    ['모델이 답한 뒤', 'AI 모델이 답했거나 실패한 직후예요.' + ONLY_CMD.ko],
    ['モデルの返答後', 'AI モデルが返答した（または失敗した）直後。' + ONLY_CMD.ja],
    ['模型回复后', 'AI 模型回复（或失败）之后。' + ONLY_CMD.zh],
  ),
  Interrupt: e(
    ['You stop it', 'When you interrupt the work (Esc / Ctrl+C).' + ONLY_CMD.en],
    ['내가 멈출 때', '내가 작업을 중간에 멈출 때예요(Esc·Ctrl+C).' + ONLY_CMD.ko],
    ['途中で止めたとき', '作業を途中で止めたとき（Esc・Ctrl+C）。' + ONLY_CMD.ja],
    ['你中断时', '你中途停止工作时（Esc / Ctrl+C）。' + ONLY_CMD.zh],
  ),
}

/** Small grey notes under some boxes in the diagram. */
export const SUBTITLES: Record<string, PerLang<string>> = {
  Setup: { en: 'optional', ko: '선택', ja: '任意', zh: '可选' },
  UserPromptExpansion: { en: 'shortcuts', ko: '단축 명령', ja: '短縮コマンド', zh: '快捷命令' },
  PermissionDenied: { en: 'automatic', ko: '자동', ja: '自動', zh: '自动' },
  Elicitation: { en: 'from an app', ko: '앱에서', ja: 'アプリから', zh: '来自应用' },
  ElicitationResult: { en: 'to the app', ko: '앱으로', ja: 'アプリへ', zh: '返回应用' },
  Notification: { en: 'in background', ko: '따로 돌아감', ja: '裏で動く', zh: '后台' },
  ConfigChange: { en: 'in background', ko: '따로 돌아감', ja: '裏で動く', zh: '后台' },
  PreModelSwitch: { en: 'in order', ko: '차례대로', ja: '順番に', zh: '按顺序' },
  PostModelSwitch: { en: 'in background', ko: '따로 돌아감', ja: '裏で動く', zh: '后台' },
  WorktreeCreate: { en: 'separate copy', ko: '사본', ja: '別コピー', zh: '副本' },
  WorktreeRemove: { en: 'clean up', ko: '정리', ja: '片付け', zh: '清理' },
  CwdChanged: { en: 'surroundings', ko: '주변 변화', ja: '環境の変化', zh: '环境变化' },
  InstructionsLoaded: { en: 'in background', ko: '따로 돌아감', ja: '裏で動く', zh: '后台' },
  MessageDisplay: { en: 'on screen', ko: '화면', ja: '画面', zh: '屏幕' },
}

export const UI = {
  en: {
    on: (n: number) => `${n} on`,
    diagramHint: 'Tap a moment to add words, a command or a skill there.',
    back: '← Back to the picture',
    onlyCommandsTag: 'commands only',
    empty: 'Nothing here yet.',
    add: 'Add something here',
    kindLabel: 'What to add',
    kinds: { text: 'Words', command: 'Command', skill: 'Skill' },
    enabled: 'On',
    textPlaceholder: 'e.g. Please answer in English and keep it short.',
    commandPlaceholder: 'e.g. npm test',
    modeLabel: 'When to pass the result to Claude',
    modes: { always: 'Always', onFail: 'Only if it fails' },
    sideEffect: 'This runs here, but Claude does not see the result.',
    pickSkill: 'Choose a skill',
    noSkills: 'No skills found',
    tools: 'Only for these tools (e.g. Bash, Edit). Leave empty for all.',
    once: 'Just once',
    onceHint: 'Turns itself off after it runs',
    remove: 'Delete',
    fold: 'Fold into the bubble',
    hide: 'Hide (it stays in the menu bar)',
    recent: 'Recently added',
    language: 'Language',
    fired: (n: number) => `happened ${n} times`,
    turn: ['EACH', 'TURN'] as [string, string],
    loop: ['WORK', 'LOOP'] as [string, string],
    anytime: 'ANYTIME · no fixed place, whenever it happens',
    toolRuns: 'the tool runs',
    resumed: 'reopened chats',
    modelThinks: 'the model thinks',
    agents: { claude: 'Claude Code', codex: 'Codex' },
    scopeLabel: 'Applies to',
    scopes: { global: 'Everywhere', project: 'This project', terminal: 'This terminal' },
    pickProject: 'Choose a project',
    pickTerminal: 'Choose a terminal',
    noPlaces: 'Open Claude Code or Codex once and it will show up here.',
    overriddenBy: (scope: string) => `Not used right now: "${scope}" has its own setting for this moment.`,
    replaces: (scope: string) => `Used instead of "${scope}" for this moment.`,
    codexOff: 'Codex is not connected yet.',
    codexConnect: 'Connect Codex',
    codexDisconnect: 'Disconnect',
    codexTrust: 'Connected. In Codex, type /hooks once and trust the hookwich hooks.',
    codexMissing: 'Codex is not installed on this computer.',
    open: 'open now',
    openChats: (n: number) => `${n} open now`,
    closed: 'closed',
    notHooked: 'open now · hookwich not on yet',
    legend: 'Black number: added with hookwich · grey number: hooks you already have',
    existingTitle: 'Already here (set up outside hookwich)',
    existingNote: 'These run first; then hookwich adds yours.',
    existingFrom: (from: string) =>
      from === 'settings'
        ? 'your settings'
        : from === 'project'
          ? 'project settings'
          : from === 'managed'
            ? 'managed by your company'
            : `plugin ${from.replace('plugin:', '')}`,
    onlyWhen: (m: string) => `only for ${m}`,
    setFromGlobal: 'Set from "Everywhere"',
    setFromProject: 'Set from this project',
    terminalNow: (folder: string, agent: string) =>
      `The terminal you are chatting in now (${folder} · ${agent})`,
    tipAdded: 'Added with hookwich',
    tipExisting: 'Hooks you already have',
    tipEmpty: 'Nothing here yet. Click to add something.',
    tipOff: 'off',
    applyAllProjects: 'Apply to all projects',
    applyGlobal: 'Apply to "Everywhere"',
    undo: 'Undo',
    copied: (n: number) =>
      n ? `Added ${n}. Ones already here were skipped.` : 'Everything is already here.',
    copiedProjects: (n: number, p: number) =>
      `Added ${n} across ${p} projects. Ones already there were skipped.`,
    noProjectHere: 'This terminal is not in a project folder.',
    noProjects: 'No projects yet: open Claude Code or Codex in a project folder once.',
    existingSwitch: (name: string) => `Turn ${name} on or off`,
    existingOff: 'off',
    pluginWhole: (name: string) => `This switches off the whole plugin ${name}, its skills too. Turn it off?`,
    pluginOnly: 'A plugin hook can only be switched with its whole plugin.',
    turnOffPlugin: 'Turn the plugin off',
    cancel: 'Cancel',
    reopenNote: 'Chats already open may need to be reopened for this to apply.',
    toggleFailed: (e: string) => `Could not change it: ${e}`,
    follow: 'Follow where I chat',
    followNow: (agent: string, where: string) => `Now: ${agent} · ${where}`,
    followHint: 'Switches by itself to the AI and terminal you last typed in.',
    followCodex: 'To follow Codex too, connect it in the Codex tab.',
  },
  ko: {
    on: (n: number) => `${n}개 켜짐`,
    diagramHint: '원하는 순간을 누르고, 그때 넣을 말·명령·스킬을 고르세요.',
    back: '← 그림으로 돌아가기',
    onlyCommandsTag: '명령만',
    empty: '아직 넣은 게 없어요.',
    add: '여기에 넣기',
    kindLabel: '넣을 것',
    kinds: { text: '말', command: '명령', skill: '스킬' },
    enabled: '켜기',
    textPlaceholder: '예: 답은 영어로, 짧게 해 줘.',
    commandPlaceholder: '예: npm test',
    modeLabel: '결과를 Claude에게 언제 전할까요',
    modes: { always: '항상', onFail: '실패할 때만' },
    sideEffect: '여기서 실행은 되지만, Claude는 결과를 보지 못해요.',
    pickSkill: '스킬 고르기',
    noSkills: '설치된 스킬이 없어요',
    tools: '이 도구에만 (예: Bash, Edit). 비우면 모든 도구',
    once: '한 번만',
    onceHint: '한 번 실행하면 저절로 꺼져요',
    remove: '지우기',
    fold: '버블로 접기',
    hide: '숨기기 (메뉴 막대에 남아요)',
    recent: '최근에 넣은 것',
    language: '언어',
    fired: (n: number) => `${n}번 일어남`,
    turn: ['매번', '주고받기'] as [string, string],
    loop: ['일하는', '반복'] as [string, string],
    anytime: '아무 때나 · 정해진 자리 없이, 일이 생길 때마다',
    toolRuns: '도구 실행',
    resumed: '대화를 다시 열 때',
    modelThinks: '모델이 생각해요',
    agents: { claude: 'Claude Code', codex: 'Codex' },
    scopeLabel: '적용 범위',
    scopes: { global: '모든 곳', project: '이 프로젝트', terminal: '이 터미널' },
    pickProject: '프로젝트 고르기',
    pickTerminal: '터미널 고르기',
    noPlaces: 'Claude Code나 Codex를 한 번 열면 여기에 나타나요.',
    overriddenBy: (scope: string) => `지금은 쓰이지 않아요. 이 순간은 '${scope}' 설정이 따로 있어요.`,
    replaces: (scope: string) => `이 순간은 '${scope}' 설정 대신 이걸 써요.`,
    codexOff: 'Codex가 아직 연결되지 않았어요.',
    codexConnect: 'Codex 연결하기',
    codexDisconnect: '연결 끊기',
    codexTrust: '연결됐어요. Codex에서 /hooks를 한 번 입력하고 hookwich 훅을 신뢰해 주세요.',
    codexMissing: '이 컴퓨터에 Codex가 없어요.',
    open: '지금 열려 있음',
    openChats: (n: number) => `지금 ${n}개 열려 있음`,
    closed: '지금은 닫혀 있음',
    notHooked: '열려 있음 · hookwich 아직 안 붙음',
    legend: '검은 숫자: hookwich로 넣은 것 · 회색 숫자: 이미 있는 훅',
    existingTitle: '이미 있는 훅 (hookwich 밖에서 설정됨)',
    existingNote: '이 훅들이 먼저 돌고, 그다음 hookwich가 넣은 것이 들어가요.',
    existingFrom: (from: string) =>
      from === 'settings'
        ? '내 설정'
        : from === 'project'
          ? '프로젝트 설정'
          : from === 'managed'
            ? '회사 관리 설정'
            : `플러그인 ${from.replace('plugin:', '')}`,
    onlyWhen: (m: string) => `${m}일 때만`,
    setFromGlobal: '모든 곳(전역) 값으로 세팅하기',
    setFromProject: '프로젝트 값으로 세팅하기',
    terminalNow: (folder: string, agent: string) => `지금 채팅 중인 터미널 (${folder} · ${agent})`,
    tipAdded: 'hookwich로 넣은 것',
    tipExisting: '이미 있는 훅',
    tipEmpty: '아직 아무것도 없어요. 눌러서 넣어 보세요.',
    tipOff: '꺼짐',
    applyAllProjects: '모든 프로젝트에 적용',
    applyGlobal: '모든 곳(전역)에 적용',
    undo: '되돌리기',
    copied: (n: number) => (n ? `${n}개를 넣었어요. 이미 있던 건 건너뛰었어요.` : '이미 다 들어 있어요.'),
    copiedProjects: (n: number, p: number) =>
      `프로젝트 ${p}곳에 모두 ${n}개를 넣었어요. 이미 있던 건 건너뛰었어요.`,
    noProjectHere: '이 터미널은 프로젝트 폴더가 아니에요.',
    noProjects: '아직 프로젝트가 없어요. 프로젝트 폴더에서 Claude Code나 Codex를 한 번 열어 주세요.',
    existingSwitch: (name: string) => `${name} 켜고 끄기`,
    existingOff: '꺼짐',
    pluginWhole: (name: string) => `플러그인 ${name} 전체가 꺼져요(스킬도 같이). 끌까요?`,
    pluginOnly: '플러그인 훅은 플러그인 전체로만 끄고 켤 수 있어요.',
    turnOffPlugin: '플러그인 끄기',
    cancel: '취소',
    reopenNote: '이미 열린 대화는 다시 열어야 적용될 수 있어요.',
    toggleFailed: (e: string) => `바꾸지 못했어요: ${e}`,
    follow: '내가 채팅하는 곳 따라가기',
    followNow: (agent: string, where: string) => `지금: ${agent} · ${where}`,
    followHint: '마지막으로 채팅을 친 AI와 터미널로 저절로 바뀌어요.',
    followCodex: 'Codex도 따라가려면 Codex 탭에서 연결해 주세요.',
  },
  ja: {
    on: (n: number) => `${n}件オン`,
    diagramHint: 'タイミングを押して、そこで入れる言葉・コマンド・スキルを選びます。',
    back: '← 図に戻る',
    onlyCommandsTag: 'コマンドのみ',
    empty: 'まだ何もありません。',
    add: 'ここに追加',
    kindLabel: '入れるもの',
    kinds: { text: '言葉', command: 'コマンド', skill: 'スキル' },
    enabled: 'オン',
    textPlaceholder: '例：英語で、短く答えてください。',
    commandPlaceholder: '例：npm test',
    modeLabel: '結果をいつ Claude に渡すか',
    modes: { always: 'いつも', onFail: '失敗したときだけ' },
    sideEffect: 'ここで実行されますが、Claude には結果が見えません。',
    pickSkill: 'スキルを選ぶ',
    noSkills: 'スキルが見つかりません',
    tools: 'このツールだけ（例：Bash, Edit）。空ならすべて',
    once: '一度だけ',
    onceHint: '一度動いたら自動でオフ',
    remove: '削除',
    fold: 'バブルにたたむ',
    hide: '隠す（メニューバーに残ります）',
    recent: '最近入れたもの',
    language: '言語',
    fired: (n: number) => `${n}回発生`,
    turn: ['毎回の', 'やりとり'] as [string, string],
    loop: ['作業', 'ループ'] as [string, string],
    anytime: 'いつでも · 決まった順番はなく、起きたときに',
    toolRuns: 'ツール実行',
    resumed: '会話の再開',
    modelThinks: 'モデルが考える',
    agents: { claude: 'Claude Code', codex: 'Codex' },
    scopeLabel: '適用範囲',
    scopes: { global: 'すべて', project: 'このプロジェクト', terminal: 'このターミナル' },
    pickProject: 'プロジェクトを選ぶ',
    pickTerminal: 'ターミナルを選ぶ',
    noPlaces: 'Claude Code か Codex を一度開くと、ここに表示されます。',
    overriddenBy: (scope: string) =>
      `いまは使われていません。このタイミングは「${scope}」に別の設定があります。`,
    replaces: (scope: string) => `このタイミングでは「${scope}」の代わりにこれを使います。`,
    codexOff: 'Codex はまだ接続されていません。',
    codexConnect: 'Codex を接続',
    codexDisconnect: '接続を解除',
    codexTrust: '接続しました。Codex で /hooks を一度入力し、hookwich のフックを信頼してください。',
    codexMissing: 'このパソコンに Codex がありません。',
    open: 'いま開いている',
    openChats: (n: number) => `いま ${n} 件開いている`,
    closed: 'いまは閉じている',
    notHooked: '開いている · hookwich まだ未接続',
    legend: '黒い数字：hookwich で入れたもの · 灰色の数字：すでにあるフック',
    existingTitle: 'すでにあるフック（hookwich の外で設定）',
    existingNote: 'これらが先に動き、そのあと hookwich で入れたものが入ります。',
    existingFrom: (from: string) =>
      from === 'settings'
        ? '自分の設定'
        : from === 'project'
          ? 'プロジェクトの設定'
          : from === 'managed'
            ? '会社の管理設定'
            : `プラグイン ${from.replace('plugin:', '')}`,
    onlyWhen: (m: string) => `${m} のときだけ`,
    setFromGlobal: '「すべて」の値でセットする',
    setFromProject: 'プロジェクトの値でセットする',
    terminalNow: (folder: string, agent: string) => `いまチャットしているターミナル（${folder} · ${agent}）`,
    tipAdded: 'hookwich で入れたもの',
    tipExisting: 'すでにあるフック',
    tipEmpty: 'まだ何もありません。押して入れてみましょう。',
    tipOff: 'オフ',
    applyAllProjects: 'すべてのプロジェクトに適用',
    applyGlobal: '「すべて」に適用',
    undo: '元に戻す',
    copied: (n: number) =>
      n ? `${n} 件入れました。すでにあるものは飛ばしました。` : 'すでに全部入っています。',
    copiedProjects: (n: number, p: number) =>
      `${p} 件のプロジェクトに合計 ${n} 件入れました。すでにあるものは飛ばしました。`,
    noProjectHere: 'このターミナルはプロジェクトのフォルダではありません。',
    noProjects:
      'まだプロジェクトがありません。プロジェクトのフォルダで Claude Code か Codex を一度開いてください。',
    existingSwitch: (name: string) => `${name} のオン・オフ`,
    existingOff: 'オフ',
    pluginWhole: (name: string) => `プラグイン ${name} 全体（スキルも）がオフになります。オフにしますか？`,
    pluginOnly: 'プラグインのフックは、プラグイン全体でしかオン・オフできません。',
    turnOffPlugin: 'プラグインをオフ',
    cancel: 'キャンセル',
    reopenNote: 'すでに開いている会話は、開き直すと反映されます。',
    toggleFailed: (e: string) => `変更できませんでした：${e}`,
    follow: 'チャットしている場所に合わせる',
    followNow: (agent: string, where: string) => `いま：${agent} · ${where}`,
    followHint: '最後に入力した AI とターミナルに自動で切り替わります。',
    followCodex: 'Codex にも合わせるには、Codex タブで接続してください。',
  },
  zh: {
    on: (n: number) => `已开启 ${n} 项`,
    diagramHint: '点一个时刻，选择要在那时加入的话、命令或技能。',
    back: '← 回到图',
    onlyCommandsTag: '仅命令',
    empty: '这里还没有内容。',
    add: '在这里添加',
    kindLabel: '添加什么',
    kinds: { text: '文字', command: '命令', skill: '技能' },
    enabled: '开启',
    textPlaceholder: '例如：请用英文回答，简短一点。',
    commandPlaceholder: '例如：npm test',
    modeLabel: '什么时候把结果交给 Claude',
    modes: { always: '总是', onFail: '只在失败时' },
    sideEffect: '会在这里运行，但 Claude 看不到结果。',
    pickSkill: '选择技能',
    noSkills: '没有找到技能',
    tools: '只对这些工具（例如 Bash, Edit）。留空表示全部',
    once: '只一次',
    onceHint: '运行一次后自动关闭',
    remove: '删除',
    fold: '收成气泡',
    hide: '隐藏（留在菜单栏）',
    recent: '最近添加',
    language: '语言',
    fired: (n: number) => `发生了 ${n} 次`,
    turn: ['每一轮', '对话'] as [string, string],
    loop: ['工作', '循环'] as [string, string],
    anytime: '随时 · 没有固定位置，发生时就触发',
    toolRuns: '工具运行',
    resumed: '重新打开对话',
    modelThinks: '模型思考',
    agents: { claude: 'Claude Code', codex: 'Codex' },
    scopeLabel: '适用范围',
    scopes: { global: '所有地方', project: '这个项目', terminal: '这个终端' },
    pickProject: '选择项目',
    pickTerminal: '选择终端',
    noPlaces: '打开一次 Claude Code 或 Codex，它就会出现在这里。',
    overriddenBy: (scope: string) => `现在不生效：这个时刻在“${scope}”里有单独的设置。`,
    replaces: (scope: string) => `这个时刻会用它代替“${scope}”的设置。`,
    codexOff: 'Codex 还没有连接。',
    codexConnect: '连接 Codex',
    codexDisconnect: '断开连接',
    codexTrust: '已连接。请在 Codex 中输入一次 /hooks，并信任 hookwich 的钩子。',
    codexMissing: '这台电脑上没有 Codex。',
    open: '现在打开着',
    openChats: (n: number) => `现在打开 ${n} 个`,
    closed: '现在已关闭',
    notHooked: '打开着 · 还没接上 hookwich',
    legend: '黑色数字：用 hookwich 加入的 · 灰色数字：已有的钩子',
    existingTitle: '已有的钩子（在 hookwich 之外设置）',
    existingNote: '这些会先运行，然后才加入 hookwich 里的内容。',
    existingFrom: (from: string) =>
      from === 'settings'
        ? '我的设置'
        : from === 'project'
          ? '项目设置'
          : from === 'managed'
            ? '公司管理的设置'
            : `插件 ${from.replace('plugin:', '')}`,
    onlyWhen: (m: string) => `仅限 ${m}`,
    setFromGlobal: '用“所有地方”的设置来设定',
    setFromProject: '用项目的设置来设定',
    terminalNow: (folder: string, agent: string) => `你正在聊天的终端（${folder} · ${agent}）`,
    tipAdded: '用 hookwich 加入的',
    tipExisting: '已有的钩子',
    tipEmpty: '这里还没有内容。点一下来加入。',
    tipOff: '已关闭',
    applyAllProjects: '应用到所有项目',
    applyGlobal: '应用到“所有地方”',
    undo: '撤销',
    copied: (n: number) => (n ? `加入了 ${n} 项，已有的已跳过。` : '已经全部都有了。'),
    copiedProjects: (n: number, p: number) => `在 ${p} 个项目中共加入 ${n} 项，已有的已跳过。`,
    noProjectHere: '这个终端不在项目文件夹里。',
    noProjects: '还没有项目。请在项目文件夹中打开一次 Claude Code 或 Codex。',
    existingSwitch: (name: string) => `开关 ${name}`,
    existingOff: '已关闭',
    pluginWhole: (name: string) => `这会关闭整个插件 ${name}（包括它的技能）。要关闭吗？`,
    pluginOnly: '插件的钩子只能随整个插件一起开关。',
    turnOffPlugin: '关闭插件',
    cancel: '取消',
    reopenNote: '已经打开的对话可能需要重新打开才会生效。',
    toggleFailed: (e: string) => `没能更改：${e}`,
    follow: '跟随我正在聊天的地方',
    followNow: (agent: string, where: string) => `现在：${agent} · ${where}`,
    followHint: '会自动切换到你最后输入的 AI 和终端。',
    followCodex: '要同时跟随 Codex，请在 Codex 标签页中连接。',
  },
} satisfies Record<Lang, unknown>

export type UiText = (typeof UI)['en']

/** Shared wording says "Claude"; on the Codex picture it says "Codex". */
export const forAgent = (text: string, agent: 'claude' | 'codex') =>
  agent === 'codex' ? text.replace(/Claude Code|Claude/g, 'Codex') : text

export const eventName = (event: string, lang: Lang, agent: 'claude' | 'codex' = 'claude') =>
  forAgent(EVENTS[event]?.[lang].name ?? event, agent)
export const eventHint = (event: string, lang: Lang, agent: 'claude' | 'codex' = 'claude') =>
  forAgent(EVENTS[event]?.[lang].hint ?? '', agent)
export const subtitleOf = (event: string, lang: Lang) => SUBTITLES[event]?.[lang]
