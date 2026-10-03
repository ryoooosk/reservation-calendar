/**
 * 共通の小道具
 */

function myEmail_() {
  return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
}

function getProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

/** カンマ・改行区切りのスクリプト プロパティを配列で取得 */
function getListProp_(key) {
  return getProp_(key).split(/[,、\n]/).map(s => s.trim()).filter(Boolean);
}

function getApiKey_() {
  const key = getProp_('GEMINI_API_KEY');
  if (!key) throw new Error('スクリプト プロパティに GEMINI_API_KEY が設定されていません');
  return key;
}

function getLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** どちらのアカウントで開いても、正しい受信箱のメールが開くリンク */
function mailLink_(thread) {
  return 'https://mail.google.com/mail/u/?authuser=' + encodeURIComponent(myEmail_()) +
    '#all/' + thread.getId();
}

function parseDateTime_(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) throw new Error('日時の形式が不正です: ' + s);
  return Utilities.parseDate(`${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
}

function parseDate_(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error('日付の形式が不正です: ' + s);
  return Utilities.parseDate(`${m[1]}-${m[2]}-${m[3]}`, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

/** 例: 2026/10/10(土) 19:00 */
function fmt_(d, dateOnly) {
  const w = WEEK_JA[Number(Utilities.formatDate(d, CONFIG.TIMEZONE, 'u'))];
  const date = Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy/M/d') + `(${w})`;
  return dateOnly ? date : date + ' ' + Utilities.formatDate(d, CONFIG.TIMEZONE, 'HH:mm');
}

function loadJson_(key, fallback) {
  const raw = getProp_(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

function saveJson_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(value));
}
