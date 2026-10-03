/**
 * Apps Script エディタから手動で実行する関数
 *   testCalendar … 書き込み先カレンダーにアクセスできるか確認
 *   testLatest   … 最新の予約メール1通をAIに読ませて結果をログ表示（登録しない）
 *   setup        … 自動実行をオン
 *   stop         … 自動実行をオフ
 *   resetHistory … 処理済みの記録をリセット
 */

function testCalendar() {
  const cal = getCalendar_();
  console.log('実行アカウント: ' + myEmail_());
  console.log('書き込み先カレンダー: ' + cal.getName() + '（ID: ' + cal.getId() + '）');
  console.log('OK：このカレンダーに予定を登録できます');
}

function testLatest() {
  const apiKey = getApiKey_();
  const query = buildQuery_(30);
  console.log('検索条件: ' + query);
  const threads = GmailApp.search(query, 0, 1);
  if (!threads.length) {
    console.log('過去30日に該当するメールが見つかりませんでした。SUBJECT_WORDS を見直してください。');
    return;
  }
  const msgs = threads[0].getMessages();
  const msg = msgs[msgs.length - 1];
  console.log('モデル: ' + CONFIG.MODEL);
  console.log('件名: ' + msg.getSubject());
  const info = askGemini_(msg, apiKey);
  console.log(JSON.stringify(info, null, 2));
}

function setup() {
  stop();
  getApiKey_();    // APIキーが設定されているか確認
  getCalendar_();  // カレンダーにアクセスできるか確認
  ScriptApp.newTrigger('main').timeBased().everyMinutes(CONFIG.TRIGGER_MINUTES).create();
  getLabel_(CONFIG.LABEL_DONE);
  getLabel_(CONFIG.LABEL_CHECK);
  console.log(`セットアップ完了：${CONFIG.TRIGGER_MINUTES}分ごとに自動実行されます（${myEmail_()}）`);
}

function stop() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'main')
    .forEach(t => ScriptApp.deleteTrigger(t));
  console.log('自動実行を停止しました');
}

function resetHistory() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('PROCESSED_IDS');
  props.deleteProperty('FAIL_COUNTS');
  console.log('処理履歴をリセットしました');
}
