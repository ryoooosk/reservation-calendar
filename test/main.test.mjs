import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fakeMessage, fakeThread, loadGas } from './helpers/gas.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT = {
  title: '〇〇クリニック 診察',
  start: '2026-10-10T19:00',
  end: '2026-10-10T20:00',
  all_day: false,
  location: '',
  notes: '',
};
const NONE = { type: 'none', events: [] };

/** run_ を動かす環境。メールの検索結果は threads、AIの応答は reply(msg) で決める */
function setup(threads, reply = () => ({ type: 'new', events: [EVENT] })) {
  const env = loadGas();
  env.props.set('GEMINI_API_KEY', 'test-key');
  env.gas.GmailApp.search = () => threads;
  env.asked = []; // AIに渡したメールのID
  env.gas.askGemini_ = msg => {
    env.asked.push(msg.getId());
    return reply(msg);
  };
  return env;
}

const saved = (env, key) => JSON.parse(env.props.get(key));

function retryableError() {
  const e = new Error('Gemini APIエラー 429: Resource exhausted');
  e.retryable = true;
  return e;
}

describe('run_', () => {
  test('新しい予約メールを登録し、処理済みとして記録して通知する', () => {
    const thread = fakeThread([fakeMessage({ id: 'm1' })]);
    const env = setup([thread]);
    env.gas.run_();

    assert.deepEqual(env.calendar.events.map(e => e.title), ['〇〇クリニック 診察']);
    assert.deepEqual(thread.labels, ['カレンダー登録済み']);
    assert.deepEqual(saved(env, 'PROCESSED_IDS'), ['m1']);
    assert.equal(env.mails.length, 1);
    assert.equal(env.mails[0].subject, '[予約→カレンダー] 1件登録');
  });

  test('処理済みのメールはAIに渡さない', () => {
    const env = setup([fakeThread([fakeMessage({ id: 'm1' })])]);
    env.props.set('PROCESSED_IDS', JSON.stringify(['m1']));
    env.gas.run_();

    assert.deepEqual(env.asked, []);
    assert.equal(env.calendar.events.length, 0);
    assert.equal(env.mails.length, 0);
  });

  test('古いメールと自分が送ったメールは、AIに渡さず処理済みにする', () => {
    const old = fakeMessage({ id: 'old', date: new Date(Date.now() - 30 * DAY_MS) });
    const mine = fakeMessage({ id: 'mine', from: '自分 <ME@example.com>' });
    const env = setup([fakeThread([old, mine])]);
    env.props.set('FAIL_COUNTS', JSON.stringify({ old: 2 }));
    env.gas.run_();

    assert.deepEqual(env.asked, []);
    assert.deepEqual(saved(env, 'PROCESSED_IDS'), ['old', 'mine']);
    assert.deepEqual(saved(env, 'FAIL_COUNTS'), {});
  });

  test('1回の実行でAIに渡すのは MAX_PER_RUN 件まで（スレッドをまたいでも数える）', () => {
    const env = setup([
      fakeThread([fakeMessage({ id: 'm1' }), fakeMessage({ id: 'm2' })], 't1'),
      fakeThread([fakeMessage({ id: 'm3' })], 't2'),
    ], () => NONE);
    env.CONFIG.MAX_PER_RUN = 2;
    env.gas.run_();

    assert.deepEqual(env.asked, ['m1', 'm2']);
    assert.deepEqual(saved(env, 'PROCESSED_IDS'), ['m1', 'm2']);
  });

  test('一時的なエラー（429など）は失敗に数えず、別のスレッドのメールも含めて次回に回す', () => {
    const env = setup([
      fakeThread([fakeMessage({ id: 'm1' })], 't1'),
      fakeThread([fakeMessage({ id: 'm2' })], 't2'),
    ], () => { throw retryableError(); });
    env.gas.run_();

    assert.deepEqual(env.asked, ['m1']);
    assert.deepEqual(saved(env, 'PROCESSED_IDS'), []);
    assert.deepEqual(saved(env, 'FAIL_COUNTS'), {});
    assert.equal(env.mails.length, 0);
    assert.match(env.logs.find(([level]) => level === 'warn')[1], /次回に再試行/);
  });

  test('読み取りに失敗したメールは失敗回数を記録して次回また試し、残りのメールは続けて処理する', () => {
    const env = setup([fakeThread([fakeMessage({ id: 'bad' }), fakeMessage({ id: 'ok' })])], msg => {
      if (msg.getId() === 'bad') throw new Error('JSONが壊れています');
      return { type: 'new', events: [EVENT] };
    });
    env.gas.run_();

    assert.deepEqual(env.asked, ['bad', 'ok']);
    assert.deepEqual(saved(env, 'PROCESSED_IDS'), ['ok']);
    assert.deepEqual(saved(env, 'FAIL_COUNTS'), { bad: 1 });
    // 1回目の失敗はまだ通知しない
    assert.equal(env.mails[0].subject, '[予約→カレンダー] 1件登録');
  });

  test('MAX_FAILS 回続けて失敗したら諦めて、「要確認」ラベルを付けて通知する', () => {
    const thread = fakeThread([fakeMessage({ id: 'bad', subject: '予約のお知らせ' })]);
    const env = setup([thread], () => { throw new Error('JSONが壊れています'); });
    env.props.set('FAIL_COUNTS', JSON.stringify({ bad: env.CONFIG.MAX_FAILS - 1 }));
    env.gas.run_();

    assert.deepEqual(saved(env, 'PROCESSED_IDS'), ['bad']);
    assert.deepEqual(saved(env, 'FAIL_COUNTS'), {});
    assert.deepEqual(thread.labels, ['カレンダー要確認']);
    assert.equal(env.mails[0].subject, '[予約→カレンダー] 0件登録・1件要確認');
    assert.match(env.mails[0].body, /読み取りに失敗しました/);
    assert.match(env.mails[0].body, /JSONが壊れています/);
  });

  test('処理済みの記録は直近300件、失敗回数の記録は直近50件だけ残す', () => {
    const env = setup([fakeThread([fakeMessage({ id: 'new' })])], () => NONE);
    const oldIds = Array.from({ length: 300 }, (_, i) => `old${i}`);
    env.props.set('PROCESSED_IDS', JSON.stringify(oldIds));
    env.props.set('FAIL_COUNTS', JSON.stringify(Object.fromEntries(oldIds.slice(0, 60).map(id => [id, 1]))));
    env.gas.run_();

    const processed = saved(env, 'PROCESSED_IDS');
    assert.equal(processed.length, 300);
    assert.equal(processed[0], 'old1');
    assert.equal(processed.at(-1), 'new');
    const failed = Object.keys(saved(env, 'FAIL_COUNTS'));
    assert.equal(failed.length, 50);
    assert.equal(failed[0], 'old10');
  });

  test('NOTIFY_EMAIL が false なら、登録しても通知しない', () => {
    const env = setup([fakeThread([fakeMessage()])]);
    env.CONFIG.NOTIFY_EMAIL = false;
    env.gas.run_();

    assert.equal(env.calendar.events.length, 1);
    assert.equal(env.mails.length, 0);
  });
});

describe('main', () => {
  test('前回の実行中でロックが取れなければ、何もせずに終わる', () => {
    const env = loadGas();
    env.lock.tryLock = () => false;
    let ran = false;
    env.gas.run_ = () => { ran = true; };
    env.gas.main();

    assert.equal(ran, false);
  });

  test('処理がエラーで止まっても、ロックは解放する', () => {
    const env = loadGas();
    env.gas.run_ = () => { throw new Error('想定外のエラー'); };

    assert.throws(() => env.gas.main(), /想定外のエラー/);
    assert.equal(env.lock.released, true);
  });
});

describe('buildQuery_', () => {
  test('基本ワードに追加ワードを足し、除外する差出人を加える（空白を含むワードは "" で囲む）', () => {
    const env = loadGas();
    env.CONFIG.SUBJECT_WORDS = ['予約', 'booking'];
    env.props.set('EXTRA_SUBJECT_WORDS', 'ご来店、ご予約 ありがとう');
    env.props.set('EXCLUDE_FROM', 'news@example.com\nads@example.com');

    assert.equal(
      env.gas.buildQuery_(2),
      'newer_than:2d -from:me subject:(予約 OR booking OR ご来店 OR "ご予約 ありがとう") -from:news@example.com -from:ads@example.com',
    );
  });

  test('追加の設定が無ければ、基本ワードだけで検索する', () => {
    const env = loadGas();
    env.CONFIG.SUBJECT_WORDS = ['予約', 'booking'];

    assert.equal(env.gas.buildQuery_(7), 'newer_than:7d -from:me subject:(予約 OR booking)');
  });
});
