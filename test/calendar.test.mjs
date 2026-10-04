import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fakeCalendar, fakeMessage, fakeThread, jst, jstText, loadGas, plain } from './helpers/gas.mjs';

const LINK = 'https://mail.google.com/mail/u/?authuser=me%40example.com#all/t1';

/** AIが返す予定1件 */
const event = (overrides = {}) => ({
  title: '〇〇（ディナー）',
  start: '2026-10-10T19:00',
  end: '2026-10-10T21:00',
  all_day: false,
  location: '東京都千代田区',
  notes: '予約番号: 123',
  ...overrides,
});

describe('createEvent_', () => {
  test('時刻ありの予定を、場所と説明付きで登録する', () => {
    const { gas } = loadGas();
    const cal = fakeCalendar();
    const result = gas.createEvent_(cal, event(), fakeMessage({ id: 'm1' }), LINK);

    assert.equal(result.status, 'created');
    assert.equal(cal.events.length, 1);
    const [created] = cal.events;
    assert.equal(created.title, '〇〇（ディナー）');
    assert.equal(created.allDay, false);
    assert.equal(jstText(created.start), '2026-10-10T19:00');
    assert.equal(jstText(created.end), '2026-10-10T21:00');
    assert.equal(created.location, '東京都千代田区');
    assert.deepEqual(created.description.split('\n'), [
      '予約番号: 123',
      '',
      '受信アカウント: me@example.com',
      `元メール: ${LINK}`,
      'メールID: <m1@example.com>',
      '（予約メールから自動登録）',
    ]);
  });

  for (const [label, end] of [['空', ''], ['日付だけ', '2026-10-10'], ['開始より前', '2026-10-10T18:00']]) {
    test(`終了時刻が${label}なら、開始から DEFAULT_DURATION_MIN 分の予定にする`, () => {
      const { gas, CONFIG } = loadGas();
      CONFIG.DEFAULT_DURATION_MIN = 90;
      const cal = fakeCalendar();
      gas.createEvent_(cal, event({ end }), fakeMessage(), LINK);

      assert.equal(jstText(cal.events[0].end), '2026-10-10T20:30');
    });
  }

  test('終日予定は、終了日の翌日を終了に指定して登録する（宿泊など）', () => {
    const { gas } = loadGas();
    const cal = fakeCalendar();
    const result = gas.createEvent_(cal, event({ start: '2026-10-10', end: '2026-10-12', all_day: true }), fakeMessage(), LINK);

    assert.equal(result.allDay, true);
    assert.equal(cal.events[0].allDay, true);
    assert.equal(jstText(cal.events[0].start), '2026-10-10T00:00');
    assert.equal(jstText(cal.events[0].end), '2026-10-13T00:00');
  });

  test('all_day=false でも時刻が無ければ、1日の終日予定にする', () => {
    const { gas } = loadGas();
    const cal = fakeCalendar();
    gas.createEvent_(cal, event({ start: '2026-10-10', end: '', all_day: false }), fakeMessage(), LINK);

    assert.equal(cal.events[0].allDay, true);
    assert.equal(jstText(cal.events[0].start), '2026-10-10T00:00');
    assert.equal(jstText(cal.events[0].end), '2026-10-11T00:00');
  });

  test('タイトルが空なら、メールの件名をタイトルにする', () => {
    const { gas } = loadGas();
    const cal = fakeCalendar();
    gas.createEvent_(cal, event({ title: '' }), fakeMessage({ subject: '【予約確定】〇〇' }), LINK);

    assert.equal(cal.events[0].title, '【予約確定】〇〇');
  });

  test('同じ時間帯に同じタイトルの予定があれば、登録しない', () => {
    const { gas } = loadGas();
    const cal = fakeCalendar([{ title: '〇〇（ディナー）', start: jst('2026-10-10T19:00'), end: jst('2026-10-10T21:00') }]);
    const result = gas.createEvent_(cal, event(), fakeMessage(), LINK);

    assert.equal(result.status, 'duplicate');
    assert.equal(cal.events.length, 1);
  });

  test('同じメールから同じ開始時刻で登録済みなら、タイトルが違っても登録しない（別アカウントが登録済みの場合など）', () => {
    const { gas } = loadGas();
    const cal = fakeCalendar([{
      title: '〇〇 ディナー予約',
      start: jst('2026-10-10T19:00'),
      end: jst('2026-10-10T21:00'),
      description: 'メールID: <m1@example.com>',
    }]);
    const result = gas.createEvent_(cal, event(), fakeMessage({ id: 'm1' }), LINK);

    assert.equal(result.status, 'duplicate');
    assert.equal(cal.events.length, 1);
  });

  test('同じメールでも開始時刻が違えば、別の予定として登録する', () => {
    const { gas } = loadGas();
    const cal = fakeCalendar([{
      title: '〇〇 1部',
      start: jst('2026-10-10T19:00'),
      end: jst('2026-10-10T21:00'),
      description: 'メールID: <m1@example.com>',
    }]);
    const result = gas.createEvent_(
      cal, event({ title: '〇〇 2部', start: '2026-10-10T20:00', end: '2026-10-10T22:00' }), fakeMessage({ id: 'm1' }), LINK);

    assert.equal(result.status, 'created');
    assert.equal(cal.events.length, 2);
  });

  test('Message-ID が無いメールは、メールIDでは重複を判定しない（無関係の予定を重複扱いにしない）', () => {
    const { gas } = loadGas();
    const cal = fakeCalendar([{ title: '別の予定', start: jst('2026-10-10T19:00'), end: jst('2026-10-10T21:00'), description: 'メモ' }]);
    const result = gas.createEvent_(cal, event(), fakeMessage({ messageId: '' }), LINK);

    assert.equal(result.status, 'created');
    assert.equal(cal.events.length, 2);
    assert.match(cal.events[1].description, /メールID: 不明/);
  });

  test('REMINDERS_MIN を設定すると、通知をその内容に付け直す', () => {
    const { gas, CONFIG } = loadGas();
    CONFIG.REMINDERS_MIN = [1440, 60];
    const cal = fakeCalendar();
    gas.createEvent_(cal, event(), fakeMessage(), LINK);

    assert.deepEqual(cal.events[0].reminders, [1440, 60]);
  });

  test('REMINDERS_MIN が空なら、カレンダーのデフォルトの通知のままにする', () => {
    const { gas, CONFIG } = loadGas();
    CONFIG.REMINDERS_MIN = [];
    const cal = fakeCalendar();
    gas.createEvent_(cal, event(), fakeMessage(), LINK);

    assert.equal(cal.events[0].reminders, null);
  });

  test('日付の形式が不正ならエラーにする', () => {
    const { gas } = loadGas();
    assert.throws(
      () => gas.createEvent_(fakeCalendar(), event({ start: '10月10日' }), fakeMessage(), LINK),
      /日付の形式が不正です: 10月10日/,
    );
  });
});

describe('handleResult_', () => {
  test('予約ではないメール（none）や、予定が空の結果は何もしない', () => {
    const env = loadGas();
    const thread = fakeThread([]);
    for (const info of [{ type: 'none', events: [] }, { type: 'new', events: [] }, {}]) {
      assert.equal(env.gas.handleResult_(info, fakeMessage(), thread), null, JSON.stringify(info));
    }
    assert.deepEqual(thread.labels, []);
    assert.equal(env.calendar.events.length, 0);
  });

  test('新規の予約は登録して、「登録済み」ラベルを付ける', () => {
    const env = loadGas();
    const thread = fakeThread([], 't1');
    const result = env.gas.handleResult_({ type: 'new', events: [event()] }, fakeMessage({ subject: 'ご予約確定' }), thread);

    assert.equal(result.kind, 'new');
    assert.equal(result.subject, 'ご予約確定');
    assert.equal(result.link, LINK);
    assert.deepEqual(plain(result.created.map(c => c.status)), ['created']);
    assert.deepEqual(thread.labels, ['カレンダー登録済み']);
    assert.equal(env.calendar.events.length, 1);
  });

  test('予約変更は新しい日時で登録し、「要確認」ラベルを付ける', () => {
    const env = loadGas();
    const thread = fakeThread([]);
    const result = env.gas.handleResult_({ type: 'change', events: [event()] }, fakeMessage(), thread);

    assert.equal(result.kind, 'change');
    assert.equal(env.calendar.events.length, 1);
    assert.deepEqual(thread.labels, ['カレンダー要確認']);
  });

  test('キャンセルは予定を消さずに、「要確認」ラベルを付けて通知の対象にする', () => {
    const env = loadGas();
    env.calendar.createEvent('〇〇（ディナー）', jst('2026-10-10T19:00'), jst('2026-10-10T21:00'), {});
    const thread = fakeThread([]);
    const result = env.gas.handleResult_({ type: 'cancel', events: [event()] }, fakeMessage(), thread);

    assert.equal(result.kind, 'cancel');
    assert.equal(plain(result.events)[0].title, '〇〇（ディナー）');
    assert.equal(env.calendar.events.length, 1);
    assert.deepEqual(thread.labels, ['カレンダー要確認']);
  });

  test('一部の予定の登録に失敗したら、その予定をエラーとして返し、「要確認」ラベルを付ける', () => {
    const env = loadGas();
    const thread = fakeThread([]);
    const result = env.gas.handleResult_(
      { type: 'new', events: [event(), event({ title: '帰りの便', start: '不明' })] }, fakeMessage(), thread);

    const [ok, ng] = plain(result.created);
    assert.equal(ok.status, 'created');
    assert.deepEqual(ng, { title: '帰りの便', status: 'error', error: '日付の形式が不正です: 不明' });
    assert.deepEqual(thread.labels, ['カレンダー要確認']);
  });
});

describe('getCalendar_', () => {
  test('CALENDAR_ID が無ければ、メインのカレンダーに書き込む', () => {
    const env = loadGas();
    assert.equal(env.gas.getCalendar_(), env.calendar);
  });

  test('CALENDAR_ID があれば、そのカレンダーに書き込む', () => {
    const env = loadGas();
    const shared = fakeCalendar();
    env.props.set('CALENDAR_ID', 'shared-calendar-id');
    env.gas.CalendarApp.getCalendarById = id => (id === 'shared-calendar-id' ? shared : null);

    assert.equal(env.gas.getCalendar_(), shared);
  });

  test('CALENDAR_ID のカレンダーが見つからなければ、エラーにする', () => {
    const env = loadGas();
    env.props.set('CALENDAR_ID', 'missing-calendar-id');

    assert.throws(() => env.gas.getCalendar_(), /カレンダーが見つかりません: missing-calendar-id/);
  });
});
