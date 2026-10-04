// src/*.js を Apps Script と同じく「全ファイルで1つのグローバル空間」として読み込み、
// GmailApp などの GAS の API を偽物（フェイク）に差し替えて Node.js でテストできるようにする
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

const SRC_DIR = resolve(import.meta.dirname, '../../src');
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const ME = 'me@example.com';

/**
 * src/*.js を読み込んだテスト用の環境を作る（状態が残らないよう、テストごとに作り直す）
 * gas から src の関数を呼べるほか、gas.GmailApp.search = ... のように API や関数を差し替えられる
 */
export function loadGas() {
  const props = new Map();
  const labels = new Map();
  const mails = [];
  const logs = [];
  const calendar = fakeCalendar();
  const lock = {
    released: false,
    tryLock: () => true,
    releaseLock: () => { lock.released = true; },
  };

  const gas = vm.createContext({
    console: {
      log: (...args) => logs.push(['log', args.join(' ')]),
      warn: (...args) => logs.push(['warn', args.join(' ')]),
      error: (...args) => logs.push(['error', args.join(' ')]),
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => ME }),
      getEffectiveUser: () => ({ getEmail: () => ME }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => (props.has(key) ? props.get(key) : null),
        setProperty: (key, value) => props.set(key, String(value)),
        deleteProperty: key => props.delete(key),
      }),
    },
    GmailApp: {
      search: () => [],
      getUserLabelByName: name => labels.get(name) || null,
      createLabel: name => {
        const label = { getName: () => name };
        labels.set(name, label);
        return label;
      },
      sendEmail: (to, subject, body) => mails.push({ to, subject, body }),
    },
    CalendarApp: {
      getDefaultCalendar: () => calendar,
      getCalendarById: () => null,
    },
    UrlFetchApp: {
      fetch: () => { throw new Error('テストで UrlFetchApp.fetch を差し替えてください'); },
    },
    LockService: { getScriptLock: () => lock },
    Utilities: { parseDate, formatDate, sleep: () => {} },
  });

  for (const file of readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).sort()) {
    const path = join(SRC_DIR, file);
    vm.runInContext(readFileSync(path, 'utf8'), gas, { filename: path });
  }

  // const で宣言した値はグローバルのプロパティにならないので、式として評価して取り出す
  const CONFIG = vm.runInContext('CONFIG', gas);
  return { gas, CONFIG, props, labels, mails, logs, calendar, lock };
}

/** 日本時間の日時から Date を作る（例: jst('2026-10-10T19:00')、jst('2026-10-10')） */
export function jst(text) {
  return new Date(`${text.length === 10 ? `${text}T00:00` : text}:00+09:00`);
}

/** Date を日本時間の 'YYYY-MM-DDTHH:mm' にする（assert で読みやすく比べるため） */
export function jstText(date) {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * vm の中で作られた配列やオブジェクトを、assert で比べられる普通の値にする
 * （vm の中と外では Array などの実体が別物なので、そのままだと deepEqual が一致しない）
 */
export function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

export function fakeMessage({
  id = 'm1',
  subject = 'ご予約確定のお知らせ',
  from = 'お店 <shop@example.com>',
  date = new Date(),
  body = '本文',
  messageId = `<${id}@example.com>`, // '' ならヘッダーが無いメール
} = {}) {
  return {
    getId: () => id,
    getSubject: () => subject,
    getFrom: () => from,
    getDate: () => date,
    getPlainBody: () => body,
    getHeader: name => (name === 'Message-ID' ? messageId : ''),
  };
}

/** 付けられたラベル名は labels に記録する */
export function fakeThread(messages, id = 't1') {
  const thread = {
    labels: [],
    getId: () => id,
    getMessages: () => messages,
    addLabel: label => {
      thread.labels.push(label.getName());
      return thread;
    },
  };
  return thread;
}

/** 作成した予定は events に記録する。existing で登録済みの予定を渡せる */
export function fakeCalendar(existing = []) {
  const events = [];
  const add = (title, start, end, options = {}, allDay = false) => {
    const event = {
      title,
      start,
      end,
      allDay,
      location: options.location || '',
      description: options.description || '',
      reminders: null, // null のままなら、カレンダーのデフォルトの通知が使われる
      getTitle: () => event.title,
      getStartTime: () => event.start,
      getEndTime: () => event.end,
      getDescription: () => event.description,
      removeAllReminders: () => { event.reminders = []; },
      addPopupReminder: minutes => { event.reminders.push(minutes); },
    };
    events.push(event);
    return event;
  };
  existing.forEach(e => add(e.title, e.start, e.end, { description: e.description }));

  return {
    events,
    // 本物と同じく、指定の範囲と少しでも重なる予定を返す
    getEvents: (start, end) => events.filter(e => e.start < end && e.end > start),
    createEvent: (title, start, end, options) => add(title, start, end, options),
    createAllDayEvent: (title, start, end, options) => add(title, start, end, options, true),
  };
}

/** UrlFetchApp.fetch の戻り値 */
export function fakeResponse(code, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { getResponseCode: () => code, getContentText: () => text };
}

/** Gemini の正常な応答（AIの出力は parts のテキストに入る） */
export function geminiResponse(parts) {
  return fakeResponse(200, { candidates: [{ content: { parts } }] });
}

// Utilities.parseDate / formatDate の代わり
// 設定のタイムゾーン（Asia/Tokyo）は夏時間が無いので、+09:00 固定で計算できる
const PARSE_FORMATS = {
  'yyyy-MM-dd': /^(\d{4})-(\d{2})-(\d{2})()()$/,
  'yyyy-MM-dd HH:mm': /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/,
};

function parseDate(text, timeZone, format) {
  assertTokyo(timeZone);
  const m = PARSE_FORMATS[format]?.exec(text);
  if (!m) throw new Error(`テスト用の parseDate が対応していない形式です: ${text} / ${format}`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - JST_OFFSET_MS);
}

function formatDate(date, timeZone, format) {
  assertTokyo(timeZone);
  const d = new Date(date.getTime() + JST_OFFSET_MS);
  const pad = n => String(n).padStart(2, '0');
  const parts = {
    yyyy: d.getUTCFullYear(),
    MM: pad(d.getUTCMonth() + 1),
    M: d.getUTCMonth() + 1,
    dd: pad(d.getUTCDate()),
    d: d.getUTCDate(),
    HH: pad(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
    u: d.getUTCDay() || 7, // 曜日の番号（月=1 … 日=7）
  };
  return format.replace(/yyyy|MM?|dd?|HH|mm|u/g, token => parts[token]);
}

function assertTokyo(timeZone) {
  if (timeZone !== 'Asia/Tokyo') {
    throw new Error(`テスト用の Utilities は Asia/Tokyo だけに対応しています: ${timeZone}`);
  }
}
