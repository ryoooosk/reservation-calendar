/**
 * AIの結果に応じてカレンダー登録などを行う
 */
function handleResult_(info, msg, thread) {
  const type = info.type || 'none';
  const events = Array.isArray(info.events) ? info.events : [];
  const link = mailLink_(thread);

  if (type === 'none' || events.length === 0) return null;

  // キャンセルは自動削除しない（誤削除防止）。通知だけ。
  if (type === 'cancel') {
    thread.addLabel(getLabel_(CONFIG.LABEL_CHECK));
    return { kind: 'cancel', subject: msg.getSubject(), events: events, link: link };
  }

  const cal = getCalendar_();
  const created = events.map(ev => {
    try {
      return createEvent_(cal, ev, msg, link);
    } catch (e) {
      return { title: ev.title || msg.getSubject(), status: 'error', error: e.message };
    }
  });

  const hasProblem = type === 'change' || created.some(c => c.status === 'error');
  thread.addLabel(getLabel_(hasProblem ? CONFIG.LABEL_CHECK : CONFIG.LABEL_DONE));
  return { kind: type, subject: msg.getSubject(), created: created, link: link };
}

/** 予定を1件作成 */
function createEvent_(cal, ev, msg, link) {
  const title = String(ev.title || msg.getSubject()).trim();
  const location = ev.location || '';
  const mailId = msg.getHeader('Message-ID'); // 同じメールなら、どのアカウントに届いても同じ値
  const description = [
    ev.notes || '',
    '',
    '受信アカウント: ' + myEmail_(),
    '元メール: ' + link,
    'メールID: ' + (mailId || '不明'),
    '（予約メールから自動登録）',
  ].join('\n');

  // 時刻が無いのに all_day=false で返ってきた場合は終日扱いにする
  const hasTime = /T\d{2}:\d{2}/.test(String(ev.start));
  const allDay = !!ev.all_day || !hasTime;

  let start, end;
  if (allDay) {
    start = parseDate_(ev.start);
    const lastDay = ev.end ? parseDate_(ev.end) : start;
    end = new Date(lastDay.getTime() + DAY_MS); // 終日予定の終了日は「翌日」を指定する仕様
  } else {
    start = parseDateTime_(ev.start);
    const fallback = new Date(start.getTime() + CONFIG.DEFAULT_DURATION_MIN * 60000);
    end = ev.end && /T\d{2}:\d{2}/.test(String(ev.end)) ? parseDateTime_(ev.end) : fallback;
    if (end <= start) end = fallback;
  }

  const summary = { title: title, start: start, end: end, allDay: allDay, location: location };

  // 同じ時間帯に「同じタイトル」か「同じメールから登録した同じ開始時刻」の予定があれば二重登録しない
  // （もう一方のアカウントが登録済みの場合も含む。AIが付けるタイトルは毎回少し変わることがあるのでメールIDでも見る）
  const dup = cal.getEvents(start, end).some(e =>
    e.getTitle() === title ||
    (mailId && e.getStartTime().getTime() === start.getTime() && e.getDescription().indexOf(mailId) !== -1));
  if (dup) {
    summary.status = 'duplicate';
    return summary;
  }

  const options = { description: description, location: location };
  const event = allDay
    ? cal.createAllDayEvent(title, start, end, options)
    : cal.createEvent(title, start, end, options);

  if (CONFIG.REMINDERS_MIN.length) {
    event.removeAllReminders();
    CONFIG.REMINDERS_MIN.forEach(m => event.addPopupReminder(m));
  }
  summary.status = 'created';
  return summary;
}

/** 書き込み先カレンダー（スクリプト プロパティ CALENDAR_ID。未設定ならメインカレンダー） */
function getCalendar_() {
  const id = getProp_('CALENDAR_ID');
  const cal = id ? CalendarApp.getCalendarById(id) : CalendarApp.getDefaultCalendar();
  if (!cal) {
    throw new Error('カレンダーが見つかりません: ' + id +
      '（共有の設定と、このアカウントへのカレンダー追加を確認してください）');
  }
  return cal;
}
