# reservation-calendar

Gmailに届いた予約メールを、AI（Gemini）が読み取って **Googleカレンダーに自動登録** する Google Apps Script です。複数のGmailアカウントに届く予約メールを、1つのカレンダーにまとめることもできます。

ソースコードは GitHub で管理し、[clasp](https://github.com/google/clasp)（Google公式のApps Script用コマンドラインツール）で各アカウントのApps Scriptに反映します。**公開リポジトリで運用することを前提に**、個人の情報や秘密情報がリポジトリに入らない構成になっています。

## できること

- 件名に「予約」「予約確定」「キャンセル」などを含むメールを15分おきにチェック
- AIが「本当に予約メールか」を判定（広告・メルマガは無視）
- 日時・場所・予約番号・人数などを抜き出してカレンダーに登録
- 予定のメモ欄に、どのアカウントに届いたメールかと元メールへのリンクを記載
- 予約の **変更** → 新しい日時で登録し、「要確認」として通知
- **キャンセル** → 予定は自動で消さず、「手動で削除してね」と通知（誤削除防止）
- 登録のたびに、登録内容をまとめた通知メールが届く
- 処理したメールには Gmail ラベル「カレンダー登録済み」「カレンダー要確認」が付く
- 同じ予約メールが複数のアカウントに届いても二重登録しない

## 全体の仕組み

Gmail ＋ カレンダーを使う **メインアカウント** と、Gmail だけ使う **サブアカウント** のそれぞれに Apps Script を置き、予定はすべてメインのカレンダーに登録します。サブアカウントは無くても動きます。

```text
         GitHub（公開リポジトリ：コードだけ）
                    │
  反映（手元のPC：clasp ／ GitHub Actions：API）
          ┌─────────┴─────────┐
          ▼                   ▼
  メインのApps Script     サブのApps Script
   （メインのGmailを監視）  （サブのGmailを監視）
          │                   │
          └────────┬──────────┘
                   ▼
           メインのカレンダー
```

APIキーやスクリプトIDなどの秘密情報は、リポジトリではなく次の場所に置きます。

| 情報 | 置き場所 |
| --- | --- |
| Gemini APIキー・書き込み先カレンダーID・個人的な検索ワード | 各Apps Scriptのスクリプト プロパティ |
| スクリプトID | 手元の `.clasp.*.json`（Git管理外）、GitHub の Secret |
| clasp の認証情報 | 手元の `~/.clasprc.json`、GitHub の Secret |

### AIモデルと費用

使用モデルは **Gemini 3.8 Flash**（`gemini-3.8-flash`）で、思考量は最小の `low` に設定しています。月100通処理した場合の費用は、2026年中は月90円前後、2027年からは月180円前後の見込みです（2026年10月時点の公式料金で概算）。

Gemini に送るのは件名の条件に合ったメールだけです。ただし無料枠ではメール内容がGoogleの製品改善に使われるため、氏名や電話番号が気になる場合は有料枠を使ってください。

## リポジトリの構成

```text
reservation-calendar/
├── src/                     ← Apps Script に送られるのはこのフォルダだけ
│   ├── appsscript.json      マニフェスト（タイムゾーン＝東京 など）
│   ├── config.js            共通の設定（モデル、基本の検索ワードなど）
│   ├── main.js              本体（定期実行される処理）
│   ├── gemini.js            AIへの問い合わせ
│   ├── calendar.js          カレンダー登録
│   ├── notify.js            通知メール
│   ├── tools.js             テスト・セットアップ用の関数
│   └── util.js              共通の小道具
├── scripts/
│   ├── clasp-config.mjs     スクリプトIDから .clasp.*.json を作る
│   ├── push.mjs             各アカウントへ反映（手元のPC用）
│   ├── push-ci.mjs          各アカウントへ反映（GitHub Actions 用）
│   └── check-secrets.mjs    秘密情報の混入チェック
├── .github/
│   ├── workflows/           GitHub Actions（上の表を参照）
│   └── dependabot.yml       依存パッケージの更新通知
├── lefthook.yml             コミット前に秘密情報チェックを実行
├── .nvmrc                   Node.js のバージョン指定
├── package.json
└── package-lock.json
```

## セットアップ

必要なもの：Node.js（バージョンは [.nvmrc](.nvmrc) を参照）、Git、Googleアカウント。サブアカウントが無い場合は、「サブ」と書かれた手順を飛ばしてください。

### 1. Gemini の APIキーを取得する（メイン）

<https://aistudio.google.com/apikey> でAPIキーを作成します。有料枠を使う場合は、万一キーが漏れたときに備えて、[請求先の「予算とアラート」](https://console.cloud.google.com/billing) で予算アラートを作っておくと安全です（通知されるだけで、利用は自動で止まりません）。

### 2. Apps Script のプロジェクトを用意する（メイン・サブ）

それぞれのアカウントで次を行います。

1. <https://script.google.com/home/usersettings> で「Google Apps Script API」をオンにする
2. <https://script.google.com> で空のプロジェクトを作り、「プロジェクトの設定」の **スクリプトID** を控える

### 3. コードを反映する

```bash
git clone https://github.com/<ユーザー名>/reservation-calendar.git
cd reservation-calendar
npm install    # clasp と lefthook が入り、コミット前の秘密情報チェックが有効になる

# 手順2のスクリプトIDから .clasp.main.json / .clasp.sub.json を作る（Git管理外）
npm run clasp:config -- <メインのスクリプトID> <サブのスクリプトID>

# アカウントごとに clasp へログイン（ブラウザで、指定のアカウントを選んで許可する）
npm run login:main
npm run login:sub
npm run whoami:main   # 正しいアカウントでログインできたか確認
npm run whoami:sub

# src/ を各アカウントのApps Scriptへ反映
npm run push
```

### 4. スクリプト プロパティを設定する（メイン・サブ）

それぞれのApps Scriptの「プロジェクトの設定」→「スクリプト プロパティ」に追加します。

| プロパティ | 内容 | メイン | サブ |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | 手順1のAPIキー | 必須 | 必須（同じキーでOK） |
| `CALENDAR_ID` | 書き込み先カレンダーID | 不要 | 必須（手順5で確認） |
| `EXTRA_SUBJECT_WORDS` | 検索ワードの追加（カンマ区切り。例：`ご来店,受診`） | 任意 | 任意 |
| `EXCLUDE_FROM` | 対象外にする差出人（カンマ区切り。例：`news@example.com`） | 任意 | 任意 |

利用しているお店や病院が分かるような個人的なワードは、`src/config.js` ではなくここに書きます。

### 5. メインのカレンダーをサブに共有する（サブがある場合）

1. メインアカウントの Googleカレンダーの設定で、登録先のカレンダーを開く
2. 「特定のユーザーまたはグループと共有する」に、サブアカウントを **「予定の変更」** 権限で追加する
3. 同じページの「カレンダーの統合」にある **カレンダーID** を、サブの `CALENDAR_ID` に設定する
4. サブアカウントで、届いた共有メールの「このカレンダーを追加」をクリックする（これを忘れると、スクリプトからカレンダーが見つからずエラーになります）

### 6. 動作確認して自動実行をオンにする（メイン・サブ）

Apps Script エディタの関数選択プルダウンで、次の順に実行します。

1. `testCalendar`：ログに書き込み先カレンダー名が出ればOK。初回は権限の確認画面が出るので許可します（「このアプリは Google で確認されていません」→「詳細」→「〜に移動」→「許可」）
2. `testLatest`：ログに、最新の予約メールをAIが読み取った結果（JSON）が出ればOK
3. `setup`：「セットアップ完了」と出れば、以後15分おきに自動実行されます

初回の自動実行では、過去2日分の予約メールも処理されます。

### 7. （任意）GitHub Actions で自動デプロイする

設定すると、`main` ブランチの `src/` などが更新されるたびに各アカウントへ自動で反映されます。設定しなければ、ワークフローは何もせずにスキップされます。

1. リポジトリの「Settings」→「Secrets and variables」→「Actions」の **Secrets** に次を登録する

   | Name | 値 |
   | --- | --- |
   | `CLASPRC_JSON` | 手元の `~/.clasprc.json` の中身 |
   | `SCRIPT_ID_MAIN` | メインのスクリプトID |
   | `SCRIPT_ID_SUB` | サブのスクリプトID（サブが無ければ登録しない） |

2. 同じ画面の **Variables** に、`DEPLOY_ENABLED` を値 `true` で登録する（自動デプロイのオン・オフはこの変数で切り替えます）
3. 「Actions」→「Deploy to Apps Script」→「Run workflow」で試しに実行し、成功すればOK

`CLASPRC_JSON` は各アカウントのApps Scriptを書き換えられる認証情報です。リポジトリに他人を書き込み権限で追加しないでください。

この認証情報を第三者のコードに渡さないよう、GitHub Actions からの反映では clasp などの npm パッケージを使わず、`scripts/push-ci.mjs` から Apps Script API を直接呼んでいます。依存パッケージが乗っ取られても、認証情報は盗まれません。

## 日々の運用

**コードを変えるとき**は `src/` を編集してコミット・push します。GitHub Actions を設定済みなら自動で反映され、設定していなければ `npm run push` で反映します。

- ブラウザのApps Scriptエディタでコードを直接編集しないでください。次の push で上書きされて消えます
- 検索ワードの追加や差出人の除外は、スクリプト プロパティを変えるだけで済みます（コード変更は不要）
- 予定の通知（リマインダー）は、**メインのカレンダーの「デフォルトの通知」** で設定します。Googleカレンダーの通知はアカウントごとの設定で、サブのスクリプトが付けた通知はサブ側でしか鳴らないためです
- 実行履歴やエラーは、Apps Script の「実行数」画面で確認できます

**止めたいとき**は、止めたいアカウントのApps Scriptで `stop` を実行します。完全にやめる場合は、さらにApps Scriptのプロジェクト、カレンダーの共有、APIキー、GitHub の Secret を削除してください。

## カスタマイズ

`src/config.js` は全アカウント共通の設定で、公開されます。主な項目は次のとおりです。

| 項目 | 内容 |
| --- | --- |
| `MODEL` | 使用するモデル |
| `THINKING_LEVEL` | AIの思考量（`low` / `medium` / `high`）。上げると精度もコストも上がる。非対応モデルでは `''` |
| `TRIGGER_MINUTES` | 自動実行の間隔（変更後は `setup` を再実行） |
| `SUBJECT_WORDS` | 検索対象にする件名の基本ワード |
| `NOTIFY_EMAIL` | 登録結果を通知メールで送るか |
| `MAX_PER_RUN` | 1回の実行で処理する最大メール数 |

## コマンド・関数一覧

### npm スクリプト（手元のPCで実行）

| コマンド | 内容 |
| --- | --- |
| `npm run clasp:config -- <メインのID> [<サブのID>]` | スクリプトIDから `.clasp.main.json` / `.clasp.sub.json` を作成 |
| `npm run login:main` / `login:sub` | アカウントごとに clasp へログイン |
| `npm run whoami:main` / `whoami:sub` | ログイン中のアカウントを確認 |
| `npm run push` | `src/` を各アカウントのApps Scriptに反映 |
| `npm run check:secrets` | 秘密情報の混入チェック（コミット時に lefthook が自動実行） |

### Apps Script の関数（エディタで実行、`src/tools.js`）

| 関数 | 内容 |
| --- | --- |
| `testCalendar` | 書き込み先カレンダーにアクセスできるか確認 |
| `testLatest` | 最新の予約メール1通をAIに読ませて結果をログに出す（登録はしない） |
| `setup` | 自動実行をオン |
| `stop` | 自動実行をオフ |
| `resetHistory` | 処理済みの記録をリセットし、過去2日分のメールを再処理させる（二重登録はしない） |

## GitHub Actions

| ワークフロー | 内容 |
| --- | --- |
| `deploy.yml` | `main` への push で各アカウントへ自動反映（手順7を参照） |
| `secret-scan.yml` | プルリクエストの秘密情報チェック（secretlint） |
| `github-actions-lint.yml` | ワークフロー定義の文法チェック（actionlint） |
| `dependabot-auto-merge.yml` | Dependabot の更新のうち、GitHub Actions と npm のパッチ・マイナー更新を自動マージ（[ryoooosk/reusable-workflows](https://github.com/ryoooosk/reusable-workflows) を使用） |

Dependabot の自動マージを動かすには、リポジトリの「Settings」で次を設定します。

1. 「Actions」→「General」の **Allow GitHub Actions to create and approve pull requests** をオン
2. 「General」の **Allow auto-merge** をオン
3. 「Rules」→「Rulesets」で、デフォルトブランチに **Require status checks to pass**（`secret-scan` を必須）のルールセットを作る。これが無いと、秘密情報チェックを待たずにマージされます。自分が `main` に直接 push できるよう、Bypass list に Repository admin を入れておきます

`GitHub Actions lint` はワークフロー定義が変わったプルリクエストでしか動かないので、必須チェックにはしないでください。
