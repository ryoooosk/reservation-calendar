// 存在する .clasp.<name>.json すべてに src/ を反映する（サブが無い構成でもOK）
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const targets = ['main', 'sub'].filter(t => existsSync(`.clasp.${t}.json`));
if (targets.length === 0) {
  console.error('.clasp.main.json が見つかりません。先に npm run clasp:config を実行してください。');
  process.exit(1);
}

for (const t of targets) {
  console.log(`\n▶ ${t} に反映中...`);
  execFileSync('npx', ['clasp', 'push', '--force', '--user', t, '--project', `.clasp.${t}.json`], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}
console.log('\n✅ 反映が完了しました: ' + targets.join(', '));
