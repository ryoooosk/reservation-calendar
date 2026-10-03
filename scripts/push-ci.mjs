// GitHub Actions から src/ を各アカウントの Apps Script に反映する（手元からは npm run push を使う）
// 認証情報を第三者のコードに渡さないよう、clasp などの npm パッケージは使わず、Node.js の標準機能だけで Apps Script API を呼ぶ
// 環境変数: CLASPRC_JSON（~/.clasprc.json の中身）、SCRIPT_ID_MAIN、SCRIPT_ID_SUB（サブが無ければ不要）
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

let tokens;
try {
  tokens = JSON.parse(process.env.CLASPRC_JSON).tokens || {};
} catch {
  // 読み取りエラーのメッセージには中身の一部が含まれることがあるので、ログには出さない
  console.error('Secret CLASPRC_JSON が設定されていないか、JSON として読み取れません。');
  process.exit(1);
}

const targets = [
  ['main', process.env.SCRIPT_ID_MAIN],
  ['sub', process.env.SCRIPT_ID_SUB],
].filter(([, scriptId]) => scriptId);
if (targets.length === 0) {
  console.error('Secret SCRIPT_ID_MAIN が設定されていません。');
  process.exit(1);
}

// clasp と同じく、.js はサーバー側のコード、appsscript.json はマニフェストとして送る
const files = readdirSync('src').sort().map(file => {
  const source = readFileSync(`src/${file}`, 'utf8');
  if (file === 'appsscript.json') return { name: 'appsscript', type: 'JSON', source };
  if (extname(file) === '.js') return { name: basename(file, '.js'), type: 'SERVER_JS', source };
  throw new Error(`src/${file} は反映できない種類のファイルです（.js と appsscript.json のみ対応）`);
});

for (const [name, scriptId] of targets) {
  console.log(`\n▶ ${name} に反映中...`);
  const res = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await getAccessToken(name)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) throw new Error(`${name} への反映に失敗しました（${res.status}）: ${await res.text()}`);
  console.log(`${files.length} ファイルを反映しました`);
}
console.log('\n✅ 反映が完了しました: ' + targets.map(([name]) => name).join(', '));

/** clasp のログイン情報（リフレッシュトークン）から、1時間だけ有効なアクセストークンを取得 */
async function getAccessToken(name) {
  const cred = tokens[name];
  if (!cred) {
    throw new Error(`CLASPRC_JSON に ${name} の認証情報がありません（npm run login:${name} でログインし直してください）`);
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: cred.client_id,
      client_secret: cred.client_secret,
      refresh_token: cred.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`${name} のアクセストークンを取得できませんでした: ${data.error} ${data.error_description || ''}`);
  }
  return data.access_token;
}
