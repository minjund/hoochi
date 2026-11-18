<p align="center"><img src="assets/icon.png" width="112" alt="hookwich のアイコン"></p>

<h1 align="center">hookwich</h1>

<p align="center"><b>Claude Code が動くまさにその瞬間に、やってほしいことを伝えましょう。</b><br>
画面の隅の小さなウィンドウが、Claude の作業の流れを図で見せます。<br>
タイミングを押して、そこで入れる言葉・コマンド・スキルを選ぶだけです。</p>

<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <b>日本語</b> · <a href="README.zh.md">中文</a></p>

---

## 何に使うの？

Claude Code が作業するとき、同じタイミングが何度も来ます。会話が始まり、あなたがメッセージを送り、
Claude がツールを使い（コマンド実行、ファイル編集）、Claude が回答を終える……。

hookwich を使えば、コードを書かずに、そのタイミングごとに何かを付け加えられます。

| 入れるもの | どうなるか | 例 |
|---|---|---|
| **言葉** | そのタイミングで Claude が読みます。 | メッセージを送るたびに「英語で答えてください。」 |
| **コマンド** | あなたのパソコンで実行されます。結果をいつも渡すか、失敗したときだけ渡すかを選べます。 | 回答を終えるときに `npm test` を失敗時だけ → テストが通るまで Claude が直し続けます。 |
| **スキル** | インストール済みのスキルを使うよう Claude に頼みます。 | 回答を終えるときに `code-review`。 |

一つずつオン・オフでき、**一度だけ** を選ぶと一回動いたあと自動でオフになります。
ツールを使うタイミングでは、どのツールのときだけにするかも選べます。

<p align="center"><img src="assets/screenshot.png" alt="4 言語の hookwich ウィンドウ"></p>

## ウィンドウ

- ほかのウィンドウの上に、右下の小さな 🥪 バブルとして浮かんでいます。ドラッグでどこへでも移動できます。
- バブルを押すと、Claude の作業の流れが図で開きます。公式の
  [Claude Code フックのライフサイクル図](https://code.claude.com/docs/en/hooks#hook-lifecycle)をもとに描いています。
- 箱を押すと、そこに入れるものを選べます。箱の数字はオンになっている数です。
- いま起きたタイミングが光るので、Claude が何をしているか見られます。
- `–` でバブルにたたみ、`×` で隠します。隠しても画面上のメニューバーに残ります。
- 言語：English・한국어・日本語・中文。パソコンの言語に合わせ、ウィンドウ上部で切り替えられます。

## インストール

**1. プラグイン**：Claude Code に次を入力し、`y` を押してインストール先を選びます。

```
/plugin install hookwich --marketplace minjund/hookwich
```

ターミナルからは `claude plugin install hookwich --marketplace minjund/hookwich` です。

**2. ウィンドウ（macOS）**：Claude Code の会話を初めて始めたとき、プラグインが
[リリースページ](https://github.com/minjund/hookwich/releases)からウィンドウを取得し、本物のファイルか確認してから開きます。

`/hookwich` と入力するとウィンドウを表示・非表示にできます。

## 安全ですか？

入れたコマンドは、そのタイミングが来るたびにあなたのパソコンで、あなたと同じ権限で実行されます。
自分で実行してもよいコマンドだけを入れてください。コマンドは 30 秒で止まります。

## ライセンス

MIT
