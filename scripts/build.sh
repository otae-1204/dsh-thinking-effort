#!/usr/bin/env bash
# 产物校验（与 dsh-live-stats 同口径）：本包是手写客户端 bundle，没有编译步骤，
# 只断言「浏览器端产物能加载」与「Host 端入口能加载」两件事。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/4] lib/index.js 必须导出 apply"
node -e "import('./lib/index.js').then(m => { if (typeof m.apply !== 'function') { console.error('lib/index.js: apply is not a function'); process.exit(1); } console.log('  ok'); })"

echo "[2/4] lib/client.js 语法"
node --check lib/client.js && echo "  ok"

echo "[3/4] lib/client.js 必须是 __ModuleLoader__ bundle"
node -e "const s=require('fs').readFileSync('lib/client.js','utf8'); for (const t of ['__ModuleLoader__.load','exports.apply','exports.inject']) if (!s.includes(t)) { console.error('missing: '+t); process.exit(1); } console.log('  ok');"

echo "[4/4] package.json 必须声明 dsh.bundle.patch 且文件存在"
node -e "const p=require('./package.json'); const fs=require('fs'); const patch=p.dsh && p.dsh.bundle && p.dsh.bundle.patch; if (!patch) { console.error('dsh.bundle.patch missing'); process.exit(1); } if (!fs.existsSync(patch)) { console.error('patch file missing: '+patch); process.exit(1); } if (!p.dsh.client) { console.error('dsh.client missing'); process.exit(1); } console.log('  ok: '+patch);"

echo "build ok"
