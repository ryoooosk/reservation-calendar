import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fakeMessage, fakeResponse, geminiResponse, jst, loadGas, plain } from './helpers/gas.mjs';

const RESULT = {
  type: 'new',
  events: [{ title: '〇〇（ディナー）', start: '2026-10-10T19:00', end: '', all_day: false, location: '', notes: '' }],
};

/** UrlFetchApp.fetch を差し替え、送ったリクエストを記録する */
function stubFetch(env, response) {
  const requests = [];
  env.gas.UrlFetchApp.fetch = (url, options) => {
    requests.push({ url, options, payload: JSON.parse(options.payload) });
    return response;
  };
  return requests;
}

describe('askGemini_', () => {
  test('設定のモデルとAPIキーでメールを送り、返ってきたJSONを返す', () => {
    const env = loadGas();
    env.CONFIG.THINKING_LEVEL = 'low';
    const requests = stubFetch(env, geminiResponse([{ text: JSON.stringify(RESULT) }]));
    const result = env.gas.askGemini_(fakeMessage({ subject: 'ご予約確定', body: '10月10日 19時 2名様' }), 'test-key');

    assert.deepEqual(plain(result), RESULT);
    const [req] = requests;
    assert.equal(req.url, `https://generativelanguage.googleapis.com/v1beta/models/${env.CONFIG.MODEL}:generateContent`);
    assert.equal(req.options.headers['x-goog-api-key'], 'test-key');
    assert.equal(req.options.muteHttpExceptions, true);
    assert.equal(req.payload.generationConfig.responseMimeType, 'application/json');
    assert.equal(req.payload.generationConfig.thinkingConfig.thinkingLevel, 'low');
    const prompt = req.payload.contents[0].parts[0].text;
    assert.match(prompt, /件名: ご予約確定/);
    assert.match(prompt, /10月10日 19時 2名様/);
  });

  test('THINKING_LEVEL が空なら、思考量を指定しない', () => {
    const env = loadGas();
    env.CONFIG.THINKING_LEVEL = '';
    const requests = stubFetch(env, geminiResponse([{ text: JSON.stringify(RESULT) }]));
    env.gas.askGemini_(fakeMessage(), 'test-key');

    assert.equal(requests[0].payload.generationConfig.thinkingConfig, undefined);
  });

  test('思考過程（thought）は除き、```json の囲みを外して読み取る', () => {
    const env = loadGas();
    stubFetch(env, geminiResponse([
      { thought: true, text: '予約メールと判断した' },
      { text: '```json\n' + JSON.stringify(RESULT) + '\n```' },
    ]));

    assert.deepEqual(plain(env.gas.askGemini_(fakeMessage(), 'test-key')), RESULT);
  });

  for (const code of [429, 500, 503]) {
    test(`${code} エラーは一時的なものとして、次回の再試行の対象にする`, () => {
      const env = loadGas();
      stubFetch(env, fakeResponse(code, 'Resource exhausted'));

      assert.throws(() => env.gas.askGemini_(fakeMessage(), 'test-key'), err => {
        assert.equal(err.retryable, true);
        assert.match(err.message, new RegExp(`Gemini APIエラー ${code}: Resource exhausted`));
        return true;
      });
    });
  }

  test('400 などのエラーは再試行の対象にしない（失敗回数に数える）', () => {
    const env = loadGas();
    stubFetch(env, fakeResponse(400, 'API key not valid'));

    assert.throws(() => env.gas.askGemini_(fakeMessage(), 'test-key'), err => {
      assert.equal(err.retryable, false);
      return true;
    });
  });

  test('AIの応答が空ならエラーにする', () => {
    for (const body of [{}, { candidates: [] }, { candidates: [{ content: { parts: [] } }] }]) {
      const env = loadGas();
      stubFetch(env, fakeResponse(200, body));

      assert.throws(() => env.gas.askGemini_(fakeMessage(), 'test-key'), /AIの応答が空でした/, JSON.stringify(body));
    }
  });
});

describe('buildPrompt_', () => {
  test('受信日時・差出人・件名を添え、本文は15000文字までに切り詰める', () => {
    const { gas } = loadGas();
    const prompt = gas.buildPrompt_(fakeMessage({
      date: jst('2026-10-04T09:00'),
      from: 'お店 <shop@example.com>',
      subject: 'ご予約確定',
      body: 'あ'.repeat(15000) + 'い',
    }));

    assert.match(prompt, /受信日時: 2026\/10\/4\(日\) 09:00/);
    assert.match(prompt, /差出人: お店 <shop@example\.com>/);
    assert.match(prompt, /件名: ご予約確定/);
    assert.ok(prompt.endsWith('\n' + 'あ'.repeat(15000)));
  });
});
