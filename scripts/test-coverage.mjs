// テストを実行し、カバレッジ（テストで実行されたコードの割合）が基準を下回っていないか確認する
// （npm run test:coverage で実行。GitHub Actions でも同じ確認を行い、通らなければ Apps Script に反映しない）
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

run({
  globPatterns: ['test/**/*.test.mjs'],
  coverage: true,
  coverageIncludeGlobs: ['src/**'],
  coverageExcludeGlobs: ['src/tools.js'], // エディタから手動で実行する関数なので対象外
  // 基準値（%）。テストを増やしたら引き上げ、下げないようにする
  lineCoverage: 95,
  branchCoverage: 90,
  functionCoverage: 95,
})
  .on('test:fail', () => { process.exitCode = 1; })
  .compose(spec)
  .pipe(process.stdout);
