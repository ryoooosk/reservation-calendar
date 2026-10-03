/**
 * 登録結果をまとめて自分にメール
 */
function sendSummary_(results) {
  const lines = [`（${myEmail_()} に届いたメールの処理結果です）`, ''];
  let createdCount = 0;
  let checkCount = 0;

  results.forEach(r => {
    if (r.kind === 'cancel') {
      checkCount++;
      lines.push('⚠️ キャンセルのメールを検出（カレンダーからは自動で消していません）');
      lines.push('件名: ' + r.subject);
      r.events.forEach(e => lines.push(`  対象: ${e.title}（${e.start}）`));
      lines.push('  → カレンダーから手動で削除してください');
      lines.push('  元メール: ' + r.link, '');
      return;
    }
    if (r.kind === 'error') {
      checkCount++;
      lines.push('❌ 読み取りに失敗しました（手動で確認してください）');
      lines.push('件名: ' + r.subject);
      lines.push('  エラー: ' + r.error);
      lines.push('  元メール: ' + r.link, '');
      return;
    }

    lines.push(r.kind === 'change'
      ? '🔁 予約変更を検出（新しい日時で登録しました。古い予定が残っていたら削除してください）'
      : '✅ 予約を登録しました');
    if (r.kind === 'change') checkCount++;
    lines.push('件名: ' + r.subject);

    r.created.forEach(c => {
      if (c.status === 'error') {
        checkCount++;
        lines.push(`  ❌ 登録失敗: ${c.title}（${c.error}）`);
        return;
      }
      const when = formatRange_(c);
      if (c.status === 'duplicate') {
        lines.push(`  ⏭ 登録済みのためスキップ: ${when}  ${c.title}`);
      } else {
        createdCount++;
        lines.push(`  📅 ${when}  ${c.title}`);
        if (c.location) lines.push(`     場所: ${c.location}`);
      }
    });
    lines.push('  元メール: ' + r.link, '');
  });

  if (createdCount === 0 && checkCount === 0) return; // スキップのみなら通知しない

  let subject = `${CONFIG.NOTIFY_PREFIX} ${createdCount}件登録`;
  if (checkCount) subject += `・${checkCount}件要確認`;

  GmailApp.sendEmail(myEmail_(), subject, lines.join('\n'));
}

function formatRange_(c) {
  if (c.allDay) {
    const last = new Date(c.end.getTime() - DAY_MS);
    const s = fmt_(c.start, true);
    const e = fmt_(last, true);
    return s === e ? `${s} 終日` : `${s}〜${e}`;
  }
  return `${fmt_(c.start, false)}〜${Utilities.formatDate(c.end, CONFIG.TIMEZONE, 'HH:mm')}`;
}
