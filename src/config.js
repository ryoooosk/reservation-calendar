/**
 * 設定（全アカウント共通・公開リポジトリに載る値だけを書く）
 *
 * 個人の情報やアカウントごとに違う値は、コードではなく
 * 各Apps Scriptの「スクリプト プロパティ」で設定する：
 *   GEMINI_API_KEY      … Gemini の APIキー（必須）
 *   CALENDAR_ID         … 書き込み先カレンダーID（省略時はそのアカウントのメインカレンダー）
 *   EXTRA_SUBJECT_WORDS … 検索ワードの追加分（カンマ区切り。例: ご来店,受診）
 *   EXCLUDE_FROM        … 対象外にする差出人（カンマ区切り。例: news@example.com）
 */
const CONFIG = {
  MODEL: 'gemini-3.8-flash',      // 使うAIモデル
  THINKING_LEVEL: 'low',          // AIの思考量: low / medium / high（low がコスト最小）。非対応モデルでは '' にする
  TIMEZONE: 'Asia/Tokyo',
  LOOKBACK_DAYS: 2,               // 何日前までのメールを見るか
  TRIGGER_MINUTES: 15,            // 自動実行の間隔（1, 5, 10, 15, 30 のいずれか）

  // 件名にこの言葉を含むメールだけAIに読ませる（共通の基本ワード）
  SUBJECT_WORDS: [
    '予約', '予約確定', '予約完了', '予約変更', 'キャンセル',
    '受付完了', '搭乗', 'チケット', 'reservation', 'booking',
  ],

  DEFAULT_DURATION_MIN: 60,       // 終了時刻が書かれていない時の予定の長さ（分）

  // 通知（分前）。空 [] ならカレンダーの「デフォルトの通知」に従う（推奨）
  // 例: [1440, 60]（※実行しているアカウントにだけ効く）
  REMINDERS_MIN: [],

  NOTIFY_EMAIL: true,             // 登録結果を自分にメールで通知する
  MAX_PER_RUN: 10,                // 1回の実行で処理する最大メール数
  MAX_FAILS: 3,                   // 読み取り失敗がこの回数続いたら諦めて通知

  LABEL_DONE: 'カレンダー登録済み',
  LABEL_CHECK: 'カレンダー要確認',
  NOTIFY_PREFIX: '[予約→カレンダー]',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_JA = ['', '月', '火', '水', '木', '金', '土', '日'];
