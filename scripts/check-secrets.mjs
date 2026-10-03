// APIキーや認証トークン、メールアドレスがリポジトリに紛れ込んでいないかチェックする
// （コミット前フック と GitHub Actions の両方で実行される）
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  { name: 'Google APIキー', re: /AIza[0-9A-Za-z_\-]{35}/ },
  { name: 'Google リフレッシュトークン', re: /1\/\/0[0-9A-Za-z_\-]{30,}/ },
  { name: 'OAuth クライアントシークレット', re: /GOCSPX-[0-9A-Za-z_\-]{20,}/ },
  // 例示用（example.com など）と GitHub の非公開用アドレスは除く
  {
    name: 'メールアドレス',
    re: /[\w.+-]+@(?!(?:[\w-]+\.)*example\.(?:com|jp|org|net)\b|users\.noreply\.github\.com\b)[\w-]+(?:\.[\w-]+)+/,
  },
];
const SKIP = new Set(['package-lock.json']);

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter(f => f && !SKIP.has(f));

let found = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        console.error(`❌ ${file}:${i + 1} に ${p.name} らしき文字列があります`);
        found++;
      }
    }
  });
}

if (found) {
  console.error('\n秘密情報を削除してから、もう一度コミットしてください。');
  console.error('（APIキーや個人の情報はスクリプト プロパティに、認証情報は GitHub の Secret に置きます）');
  process.exit(1);
}
console.log('✅ 秘密情報は見つかりませんでした');
