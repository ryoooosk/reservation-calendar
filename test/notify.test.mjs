import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { jst, loadGas } from './helpers/gas.mjs';

const LINK = 'https://mail.google.com/mail/u/?authuser=me%40example.com#all/t1';

/** createEvent_ が返す、登録結果1件 */
const created = (overrides = {}) => ({
  title: '〇〇（ディナー）',
  start: jst('2026-10-10T19:00'),
  end: jst('2026-10-10T21:00'),
  allDay: false,
  location: '東京都千代田区',
  status: 'created',
  ...overrides,
});

describe('sendSummary_', () => {
  test('登録した予定を、件名に件数を入れて自分宛てに送る', () => {
    const { gas, mails } = loadGas();
    gas.sendSummary_([{ kind: 'new', subject: 'ご予約確定', created: [created()], link: LINK }]);

    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'me@example.com');
    assert.equal(mails[0].subject, '[予約→カレンダー] 1件登録');
    assert.deepEqual(mails[0].body.split('\n'), [
      '（me@example.com に届いたメールの処理結果です）',
      '',
      '✅ 予約を登録しました',
      '件名: ご予約確定',
      '  📅 2026/10/10(土) 19:00〜21:00  〇〇（ディナー）',
      '     場所: 東京都千代田区',
      `  元メール: ${LINK}`,
      '',
    ]);
  });

  test('登録済みでスキップした予定は、スキップしたと書く（件数には数えない）', () => {
    const { gas, mails } = loadGas();
    gas.sendSummary_([{
      kind: 'new',
      subject: '往復の予約',
      created: [created({ title: '行きの便', location: '' }), created({ title: '帰りの便', status: 'duplicate' })],
      link: LINK,
    }]);

    assert.equal(mails[0].subject, '[予約→カレンダー] 1件登録');
    assert.match(mails[0].body, /📅 2026\/10\/10\(土\) 19:00〜21:00 {2}行きの便\n {2}⏭/);
    assert.match(mails[0].body, /⏭ 登録済みのためスキップ: 2026\/10\/10\(土\) 19:00〜21:00 {2}帰りの便/);
  });

  test('登録済みでスキップしただけなら、通知しない', () => {
    const { gas, mails } = loadGas();
    gas.sendSummary_([{ kind: 'new', subject: '前日のリマインド', created: [created({ status: 'duplicate' })], link: LINK }]);

    assert.equal(mails.length, 0);
  });

  test('キャンセル・予約変更・登録失敗・読み取り失敗は、「要確認」として数える', () => {
    const { gas, mails } = loadGas();
    gas.sendSummary_([
      { kind: 'cancel', subject: 'キャンセル受付', events: [{ title: '〇〇（ディナー）', start: '2026-10-10T19:00' }], link: LINK },
      { kind: 'change', subject: '予約変更', created: [created()], link: LINK },
      { kind: 'new', subject: '予約確定', created: [created({ title: '△△', status: 'error', error: '日付の形式が不正です: 不明' })], link: LINK },
      { kind: 'error', subject: '予約のお知らせ', error: 'AIの応答が空でした', link: LINK },
    ]);

    assert.equal(mails[0].subject, '[予約→カレンダー] 1件登録・4件要確認');
    const { body } = mails[0];
    assert.match(body, /⚠️ キャンセルのメールを検出/);
    assert.match(body, /対象: 〇〇（ディナー）（2026-10-10T19:00）/);
    assert.match(body, /🔁 予約変更を検出/);
    assert.match(body, /❌ 登録失敗: △△（日付の形式が不正です: 不明）/);
    assert.match(body, /❌ 読み取りに失敗しました/);
    assert.match(body, /エラー: AIの応答が空でした/);
  });
});

describe('formatRange_', () => {
  test('1日だけの終日予定は「終日」と書く', () => {
    const { gas } = loadGas();
    assert.equal(gas.formatRange_({ allDay: true, start: jst('2026-10-10'), end: jst('2026-10-11') }), '2026/10/10(土) 終日');
  });

  test('複数日の終日予定は、最終日までの期間で書く', () => {
    const { gas } = loadGas();
    assert.equal(
      gas.formatRange_({ allDay: true, start: jst('2026-10-10'), end: jst('2026-10-13') }),
      '2026/10/10(土)〜2026/10/12(月)',
    );
  });
});
