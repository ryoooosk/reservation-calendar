/**
 * 本体：トリガーから定期的に呼ばれる
 */
function main() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // 前回の実行がまだ動いていたらスキップ
  try {
    run_();
  } finally {
    lock.releaseLock();
  }
}

function run_() {
  const apiKey = getApiKey_();
  const me = myEmail_().toLowerCase();
  const processed = loadJson_('PROCESSED_IDS', []);
  const processedSet = new Set(processed);
  const fails = loadJson_('FAIL_COUNTS', {});
  const cutoff = new Date(Date.now() - CONFIG.LOOKBACK_DAYS * DAY_MS);

  const threads = GmailApp.search(buildQuery_(CONFIG.LOOKBACK_DAYS), 0, 30);
  const results = [];
  let count = 0;

  outer:
  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const id = msg.getId();
      if (processedSet.has(id)) continue;

      // 古いメール・自分が送ったメールはスキップ
      const fromMe = me && msg.getFrom().toLowerCase().indexOf(me) !== -1;
      if (msg.getDate() < cutoff || fromMe) {
        processed.push(id);
        processedSet.add(id);
        delete fails[id];
        continue;
      }

      if (count >= CONFIG.MAX_PER_RUN) break outer;
      count++;

      try {
        const info = askGemini_(msg, apiKey);
        const r = handleResult_(info, msg, thread);
        if (r) results.push(r);
        processed.push(id);
        processedSet.add(id);
        delete fails[id];
      } catch (e) {
        // 一時的なエラーは失敗に数えず、残りのメールもまとめて次回の実行で再試行する
        if (e.retryable) {
          console.warn(`一時的なエラーのため次回に再試行: ${msg.getSubject()} / ${e.message}`);
          break outer;
        }
        fails[id] = (fails[id] || 0) + 1;
        console.error(`失敗(${fails[id]}回目): ${msg.getSubject()} / ${e.message}`);
        if (fails[id] >= CONFIG.MAX_FAILS) {
          results.push({ kind: 'error', subject: msg.getSubject(), error: e.message, link: mailLink_(thread) });
          thread.addLabel(getLabel_(CONFIG.LABEL_CHECK));
          processed.push(id);
          processedSet.add(id);
          delete fails[id];
        }
      }
      Utilities.sleep(1500); // APIのレート制限対策
    }
  }

  saveJson_('PROCESSED_IDS', processed.slice(-300));
  // 検索に出てこなくなったメールの記録が溜まり続けないよう、直近50件だけ残す
  saveJson_('FAIL_COUNTS', Object.fromEntries(Object.entries(fails).slice(-50)));

  if (CONFIG.NOTIFY_EMAIL && results.length) sendSummary_(results);
}

/** Gmail の検索条件を作る（基本ワード＋スクリプト プロパティの追加ワード） */
function buildQuery_(days) {
  const words = CONFIG.SUBJECT_WORDS.concat(getListProp_('EXTRA_SUBJECT_WORDS'))
    .map(w => (/\s/.test(w) ? `"${w}"` : w))
    .join(' OR ');
  const excludes = getListProp_('EXCLUDE_FROM').map(a => `-from:${a}`).join(' ');
  return `newer_than:${days}d -from:me subject:(${words}) ${excludes}`.trim();
}
