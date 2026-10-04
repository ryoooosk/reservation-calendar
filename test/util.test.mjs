import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fakeThread, jst, jstText, loadGas, plain } from './helpers/gas.mjs';

describe('getListProp_', () => {
  test('カンマ・読点・改行で区切った設定を、前後の空白を除いた配列にする', () => {
    const { gas, props } = loadGas();
    props.set('WORDS', ' ご来店, 受診、\n検診 ,,');
    assert.deepEqual(plain(gas.getListProp_('WORDS')), ['ご来店', '受診', '検診']);
  });

  test('未設定なら空の配列を返す', () => {
    const { gas } = loadGas();
    assert.deepEqual(plain(gas.getListProp_('WORDS')), []);
  });
});

describe('parseDateTime_', () => {
  test('日本時間の日時として読み取る（秒やタイムゾーンの表記は無視する）', () => {
    const { gas } = loadGas();
    for (const text of ['2026-10-10T19:00', '2026-10-10 19:00', '2026-10-10T19:00:00+09:00']) {
      assert.equal(jstText(gas.parseDateTime_(text)), '2026-10-10T19:00', text);
    }
  });

  test('日時として読めなければエラーにする', () => {
    const { gas } = loadGas();
    assert.throws(() => gas.parseDateTime_('10/10 19:00'), /日時の形式が不正です: 10\/10 19:00/);
  });
});

describe('parseDate_', () => {
  test('日付の部分だけを、日本時間のその日の0時として読み取る', () => {
    const { gas } = loadGas();
    for (const text of ['2026-10-10', '2026-10-10T19:00']) {
      assert.equal(jstText(gas.parseDate_(text)), '2026-10-10T00:00', text);
    }
  });

  test('日付として読めなければエラーにする', () => {
    const { gas } = loadGas();
    assert.throws(() => gas.parseDate_('不明'), /日付の形式が不正です: 不明/);
  });
});

describe('fmt_', () => {
  test('日本時間の日付に曜日を付けて表示する', () => {
    const { gas } = loadGas();
    assert.equal(gas.fmt_(jst('2026-10-10T19:00'), false), '2026/10/10(土) 19:00');
    assert.equal(gas.fmt_(jst('2026-10-11T08:05'), true), '2026/10/11(日)');
  });
});

describe('loadJson_', () => {
  test('保存した値を読み取り、未設定や壊れた値なら代わりの値を返す', () => {
    const { gas, props } = loadGas();
    props.set('OK', '["a"]');
    props.set('BROKEN', '["a"');
    assert.deepEqual(plain(gas.loadJson_('OK', [])), ['a']);
    assert.equal(gas.loadJson_('MISSING', 'fallback'), 'fallback');
    assert.equal(gas.loadJson_('BROKEN', 'fallback'), 'fallback');
  });
});

describe('getApiKey_', () => {
  test('GEMINI_API_KEY が未設定ならエラーにする', () => {
    const { gas } = loadGas();
    assert.throws(() => gas.getApiKey_(), /GEMINI_API_KEY が設定されていません/);
  });
});

describe('getLabel_', () => {
  test('ラベルが無ければ作り、あればそれを使う', () => {
    const { gas, labels } = loadGas();
    const first = gas.getLabel_('カレンダー登録済み');
    assert.equal(gas.getLabel_('カレンダー登録済み'), first);
    assert.deepEqual([...labels.keys()], ['カレンダー登録済み']);
  });
});

describe('myEmail_', () => {
  test('実行ユーザーのアドレスが取れなければ、有効ユーザーのアドレスを使う', () => {
    const { gas } = loadGas();
    gas.Session.getActiveUser = () => ({ getEmail: () => '' });
    gas.Session.getEffectiveUser = () => ({ getEmail: () => 'owner@example.com' });
    assert.equal(gas.myEmail_(), 'owner@example.com');
  });

  test('どちらも取れなければ空文字を返す', () => {
    const { gas } = loadGas();
    gas.Session.getActiveUser = () => ({ getEmail: () => '' });
    gas.Session.getEffectiveUser = () => ({ getEmail: () => '' });
    assert.equal(gas.myEmail_(), '');
  });
});

describe('mailLink_', () => {
  test('受信したアカウントを指定して、元メールを開くリンクを作る', () => {
    const { gas } = loadGas();
    assert.equal(
      gas.mailLink_(fakeThread([], 'abc123')),
      'https://mail.google.com/mail/u/?authuser=me%40example.com#all/abc123',
    );
  });
});
