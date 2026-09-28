// 打包与装载契约验证
// 清单声明、bundle 层补丁、与 profile 补丁的合成冲突检查。
//
// 路径可用环境变量覆盖，便于在别的机器复现：
//   DSH_REF_DIR     从 app.asar 提取的 @deepseek-ai 参考实现目录（默认 ../_effref）
//   DSH_KERNEL_NM   含 @deepseek-ai/* 的真实 node_modules（真实 SlotCore / pi-ai / client-modules）
//   DSH_FULL_NM     备用的完整 node_modules（默认 ../_staging/dsh-full/dsh/node_modules）
//   DSH_TE_PROFILE_DIR  被检查的 profile 目录（默认 ~/.dsh/profiles/desktop；勿用 DSH_PROFILE，宿主已占用该名）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const REF = process.env.DSH_REF_DIR || path.join(PKG, '..', '_effref');
const KERNEL = process.env.DSH_KERNEL_NM || path.join(PKG, '..', '_staging', 'kernel-full', 'dsh', 'node_modules');
const FULL = process.env.DSH_FULL_NM || path.join(PKG, '..', '_staging', 'dsh-full', 'dsh', 'node_modules');
const PROFILE = process.env.DSH_TE_PROFILE_DIR || path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
const url = (p) => pathToFileURL(p).href;
const ROOT = PKG;
const results = [];
const ok = (n, c, d) => results.push({ n, pass: !!c, d: d === undefined ? '' : String(d) });

// ---- 1) 用真实 parseDshClient 校验清单声明 ----
// 从 kernel-full 的真实模块树加载（依赖可解析）
const cm = await import(url(path.join(KERNEL, '@deepseek-ai/dsh-client-modules/lib/index.js')));
// parseDshClient 未导出；从源码切出真实实现（连同它依赖的 optionalStringArray）来校验声明
const cmSrc = fs.readFileSync(path.join(KERNEL, '@deepseek-ai/dsh-client-modules/lib/index.js'), 'utf8');
const cutFn = (start, end) => { const i = cmSrc.indexOf(start); const j = cmSrc.indexOf(end, i); if (i < 0 || j < 0) throw new Error('cut fail: ' + start); return cmSrc.slice(i, j); };
const parseDshClient = new Function(
  cutFn('function optionalStringArray(', 'function parseDshClient(') +
  cutFn('function parseDshClient(', '//#endregion') +
  '; return parseDshClient;',
)();
ok('已从真实源码切出 parseDshClient', typeof parseDshClient === 'function', typeof parseDshClient);
const pkg = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8'));
let parsed = null, perr = null;
try { parsed = parseDshClient(pkg.name, pkg.dsh.client); } catch (e) { perr = e.message; }
ok('真实 parseDshClient 接受 dsh.client 声明', parsed !== null, perr);
if (parsed) {
  ok('platform = web', parsed.platform === 'web', parsed.platform);
  ok('inject 为字符串数组', Array.isArray(parsed.inject), JSON.stringify(parsed.inject));
}
ok('清单声明 dsh.bundle.patch', !!(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch), JSON.stringify(pkg.dsh.bundle));
ok('补丁文件存在', fs.existsSync(ROOT + '/' + (pkg.dsh.bundle.patch || '').replace('./', '')), pkg.dsh.bundle.patch);
ok('exports 暴露 ./client', pkg.exports && pkg.exports['./client'] !== undefined, JSON.stringify(pkg.exports));

// ---- 2) 补丁 YAML 可解析，且 insert 行指向本包 ----
const yaml = (await import(url(path.join(PROFILE, 'node_modules/yaml/dist/index.js')))).default;
const doc = yaml.parse(fs.readFileSync(ROOT + '/cordis.patch.yml', 'utf8'));
ok('补丁是顶层数组', Array.isArray(doc), Object.prototype.toString.call(doc));
const ins = Array.isArray(doc) ? doc.find((e) => e && e.insert) : null;
ok('补丁含 insert 条目', ins !== undefined && ins !== null, JSON.stringify(doc));
if (ins) {
  const row = ins.insert[0];
  ok('insert 行 id 为 thinking-effort', row.id === 'thinking-effort', row.id);
  ok('insert 行 name 为本包', row.name === pkg.name, row.name);
}

// ---- 3) 与既有 profile 补丁合成后无重复 id ----
const prof = yaml.parse(fs.readFileSync(path.join(PROFILE, 'cordis.patch.yml'), 'utf8'));
const profIds = new Set((prof || []).map((e) => e && e.id).filter(Boolean));
ok('用户层补丁未占用 id thinking-effort（不会 duplicate）', !profIds.has('thinking-effort'), JSON.stringify([...profIds]));
const bundles = JSON.parse(fs.readFileSync(path.join(PROFILE, 'package.json'), 'utf8')).dsh.profile.bundles;
// 已装/未装取决于用户，不能硬编码；改为断言清单声明与 profile 状态自洽。
ok('profile bundles 列表可读（本包已装/未装均可）', Array.isArray(bundles),
  (bundles.includes(pkg.name) ? '已列入（已安装）' : '未列入（未安装）') + ' ' + JSON.stringify(bundles));

// ---- 4) client bundle 以正确的模块 id 注册 ----
const src = fs.readFileSync(ROOT + '/lib/client.js', 'utf8');
ok('client bundle 用 __ModuleLoader__.load', src.indexOf('__ModuleLoader__.load') >= 0, '');
ok('注册 id 与包名一致', src.indexOf('id: "' + pkg.name + '"') >= 0, '');
ok('导出 apply/inject', src.indexOf('exports.apply') >= 0 && src.indexOf('exports.inject') >= 0, '');
ok('未依赖包外模块（除 react）', !/require\(['"](?!react['"])/.test(src), '');

// ---- 5) host 入口契约 ----
const host = await import(url(ROOT + '/lib/index.js'));
ok('host 入口导出 apply 函数', typeof host.apply === 'function', typeof host.apply);
ok('host 入口 name 与包名一致', host.name === pkg.name, host.name);

console.log('');
for (const r of results) console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.n + (r.pass ? '' : '   <- ' + r.d));
const f = results.filter((r) => !r.pass);
console.log('');
console.log(f.length === 0 ? '全部 ' + results.length + ' 项通过' : f.length + ' / ' + results.length + ' 项失败');
process.exit(f.length === 0 ? 0 : 1);