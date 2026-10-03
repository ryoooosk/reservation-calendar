// .clasp.main.json / .clasp.sub.json を作る（どちらも Git 管理外）
// 使い方: npm run clasp:config -- <メインのスクリプトID> [<サブのスクリプトID>]
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const ids = {
  main: (args[0] || '').trim(),
  sub: (args[1] || '').trim(),
};

let count = 0;
for (const [name, scriptId] of Object.entries(ids)) {
  if (!scriptId) continue;
  const file = `.clasp.${name}.json`;
  writeFileSync(file, JSON.stringify({ scriptId, rootDir: 'src' }, null, 2) + '\n');
  console.log(`${file} を作成しました`);
  count++;
}

if (count === 0) {
  console.error('スクリプトIDが指定されていません。');
  console.error('使い方: npm run clasp:config -- <メインのスクリプトID> [<サブのスクリプトID>]');
  process.exit(1);
}
