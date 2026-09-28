// 依次运行全部验证脚本，汇总 PASS/FAIL；任一失败以非零码退出。
// 用法：node tests/run-all.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const specs = fs.readdirSync(HERE).filter((f) => f.endsWith('.spec.mjs')).sort();

let failed = 0;
for (const spec of specs) {
  console.log('\n===== ' + spec + ' =====');
  const r = spawnSync(process.execPath, [path.join(HERE, spec)], { stdio: 'inherit' });
  if (r.status !== 0) failed += 1;
}

console.log('\n===== 汇总 =====');
console.log(specs.length + ' 个脚本，' + (specs.length - failed) + ' 通过，' + failed + ' 失败');
process.exit(failed === 0 ? 0 : 1);
