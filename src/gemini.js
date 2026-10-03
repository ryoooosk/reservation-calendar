/**
 * Gemini にメールを読ませて予定情報(JSON)を受け取る
 */

/** AIに返させるJSONの形（この形に沿った応答だけが返ってくる） */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING', format: 'enum', enum: ['new', 'change', 'cancel', 'none'] },
    events: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          start: { type: 'STRING' },
          end: { type: 'STRING' },
          all_day: { type: 'BOOLEAN' },
          location: { type: 'STRING' },
          notes: { type: 'STRING' },
        },
        required: ['title', 'start', 'end', 'all_day', 'location', 'notes'],
      },
    },
  },
  required: ['type', 'events'],
};

function askGemini_(msg, apiKey) {
  const generationConfig = { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA };
  if (CONFIG.THINKING_LEVEL) {
    generationConfig.thinkingConfig = { thinkingLevel: CONFIG.THINKING_LEVEL };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL}:generateContent`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt_(msg) }] }],
      generationConfig: generationConfig,
    }),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    const err = new Error(`Gemini APIエラー ${code}: ${res.getContentText().slice(0, 300)}`);
    err.retryable = code === 429 || code >= 500; // 回数制限・サーバー側の一時的な不調
    throw err;
  }

  const data = JSON.parse(res.getContentText());
  const cand = data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.filter(p => !p.thought).map(p => p.text || '').join('');
  if (!text) throw new Error('AIの応答が空でした');

  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

function buildPrompt_(msg) {
  const received = fmt_(msg.getDate(), false);
  const body = msg.getPlainBody().slice(0, 15000);

  return `あなたは予約確認メールから予定を抽出するアシスタントです。
次のメールを読み、指定のJSON形式だけを返してください（説明文は不要）。

# 判定ルール
- type: 新規の予約確定="new"、日時などの予約変更="change"、キャンセル="cancel"、
  予約ではない（広告、メルマガ、空席案内、予約の催促、レビュー依頼、ポイント通知、来店後のお礼など）="none"
- 「仮予約」「リクエスト受付（未確定）」は "new" とし、title の先頭に「【仮】」を付ける

# events のルール（"cancel" の場合もキャンセル対象の予約をわかる範囲で書く。"none" なら空配列）
- 1つの予約につき1件。往復の飛行機・新幹線は2件
- start / end: 日本時間で "YYYY-MM-DDTHH:mm" 形式。年が書かれていない場合は、メール受信日時以降で最も近い日付にする
- 時刻が不明な予約は all_day=true とし、start / end は "YYYY-MM-DD" 形式
- 終了時刻が書かれていない場合 end は空文字 ""
- ホテル・宿泊は all_day=true、start=チェックイン日、end=チェックアウト日。チェックイン時刻は notes に書く
- title: 店名・施設名＋内容を短く（例:「〇〇クリニック 診察」「〇〇（ディナー）」）
- location: 住所があれば住所、なければ店名・施設名。不明なら ""
- notes: 予約番号、人数、コース、料金、持ち物、キャンセル規定など重要な情報を簡潔に（改行可）

# 出力形式
{"type":"new|change|cancel|none","events":[{"title":"","start":"","end":"","all_day":false,"location":"","notes":""}]}

# メール
受信日時: ${received}
差出人: ${msg.getFrom()}
件名: ${msg.getSubject()}
本文:
${body}`;
}
