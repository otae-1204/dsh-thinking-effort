// 装载链路验证：客户端模块清单能否被真实 ClientModuleRegistry.resolveMeta 接受。
//
// ⚠️ 版本要求：resolveMeta 是宿主契约，必须针对**运行中宿主**的参考实现取证。
// 实机 asar 的包版本为 0.1.7-rc.2（已逐包比对 _effref 与 asar：完全一致）。
// 运行用 dsh-full（0.1.7-rc.1）；已实测其 dsh-client-modules 与 _effref 的**内容逐字节相同**，
// 故结论适用于实机。保留版本自证，以便将来副本漂移时立即发现。
//
// 路径可用环境变量覆盖，便于在别的机器复现：
//   DSH_KERNEL_NM   @deepseek-ai/* 目录（其下需有 dsh-client-modules/）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const PKG = path.resolve(fileURLToPath(import.meta.url), '..', '..');
// 候选按「与运行宿主一致性」排序：_effref 是从运行中 app.asar 提取的副本
// （已逐包比对版本，0.1.7-rc.2，与实机 asar 一致）；dsh-full 是 0.1.7-rc.1；
// kernel-full 是 0.1.6-alpha.2，只作最后兜底。
// 说明：_effref（0.1.7-rc.2，与实机 asar 一致）是**裸提取副本**，缺依赖解析链
// （其 lib/index.js import '@deepseek-ai/cordis' 无法解析），不能直接 import。
// 故运行用完整树 dsh-full（0.1.7-rc.1）为主来源；已实测两者的 dsh-client-modules
// **内容逐字节相同**（仅版本号标注不同），换源不影响结论。
// kernel-full（0.1.6-alpha.2）仅作最后兜底。
const CANDIDATES = [
  path.join(PKG, '..', '_staging', 'dsh-full', 'dsh', 'node_modules'),
  path.join(PKG, '..', '_staging', 'kernel-full', 'dsh', 'node_modules'),
];
const KERNEL = process.env.DSH_KERNEL_NM
  || CANDIDATES.find((p) => fs.existsSync(path.join(p, '@deepseek-ai', 'dsh-client-modules', 'lib', 'index.js')))
  || CANDIDATES[0];
const results = [];
const ok = (n, c, d) => results.push({ n, pass: !!c, d: d === undefined ? '' : String(d) });

const cm = await import(pathToFileURL(path.join(KERNEL, '@deepseek-ai', 'dsh-client-modules', 'lib', 'index.js')).href);
const kernelVer = JSON.parse(fs.readFileSync(path.join(KERNEL, '@deepseek-ai', 'dsh-client-modules', 'package.json'), 'utf8')).version;
console.log('参考实现版本（dsh-client-modules）=' + kernelVer + '  取自 ' + KERNEL);
if (!/^0\.1\.7/.test(kernelVer)) {
  console.log('⚠️  警告：本次取证基于 ' + kernelVer + '，与运行中宿主（0.1.7-rc.2）不同版本；resolveMeta 断言可能不适用。');
}
const proto = cm.ClientModuleRegistry.prototype;
ok('ClientModuleRegistry 暴露 resolveMeta', typeof proto.resolveMeta === 'function', Object.getOwnPropertyNames(proto).join(','));

// 用真实 resolveMeta 解析本包：需要一个最小 this（缓存表 + 无 logger 依赖）
const fake = {
  ctx: { loader: {} },
  pkgMeta: new Map(),
  sourceKey: proto.sourceKey,
  locatePkgJson: proto.locatePkgJson,
  nearestPackage: proto.nearestPackage,
  resolveMeta: proto.resolveMeta,
};
let resolved = null, err = null;
try {
  // loader 行 name = 包名；baseUrl 指向包所在目录，让 Node 解析找到它
  // 传绝对路径（pathLike 分支）→ 走 nearestPackage 回退，无需已安装到 node_modules
  resolved = proto.resolveMeta.call(fake, PKG + '/lib/client.js', pathToFileURL(PKG + '/').href);
} catch (e) { err = e.message; }
ok('真实 resolveMeta 能解析本包（说明清单合法）', resolved !== null && resolved !== undefined, err);
if (resolved) {
  ok('解析出 packageName 正确', resolved.packageName === '@dsh-external/dsh-thinking-effort', resolved.packageName);
  ok('clientPath 指向 lib/client.js', /lib[\\/]client\.js$/.test(resolved.meta.clientPath), resolved.meta.clientPath);
  ok('clientPath 文件真实存在', fs.existsSync(resolved.meta.clientPath), resolved.meta.clientPath);
  ok('inject 透传', Array.isArray(resolved.meta.inject), JSON.stringify(resolved.meta.inject));
  ok('external 为空数组', Array.isArray(resolved.meta.external) && resolved.meta.external.length === 0, JSON.stringify(resolved.meta.external));
}

// 反例：平台不是 web 时必须被拒（证明 platform 字段是生效闸门）
const tmp = path.join(process.env.TEMP || '/tmp', 'te-badpkg');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp + '/lib', { recursive: true });
fs.writeFileSync(tmp + '/package.json', JSON.stringify({ name: 'te-badpkg', version: '1.0.0', exports: { './client': './lib/client.js' }, dsh: { client: { platform: 'node', inject: [] } } }));
fs.writeFileSync(tmp + '/lib/client.js', 'export const apply = () => {};');
const fake2 = { ctx: { loader: {} }, pkgMeta: new Map(), sourceKey: proto.sourceKey, locatePkgJson: proto.locatePkgJson,
  nearestPackage: proto.nearestPackage, resolveMeta: proto.resolveMeta };
const bad = proto.resolveMeta.call(fake2, tmp + '/lib/client.js', pathToFileURL(tmp + '/').href);
ok('platform 非 web 时被拒（返回 null）', bad === null, JSON.stringify(bad));

// 反例：声明了 dsh.client 但没导出 ./client 必须抛错（证明 exports 是硬要求）
fs.writeFileSync(tmp + '/package.json', JSON.stringify({ name: 'te-badpkg', version: '1.0.0', dsh: { client: { platform: 'web', inject: [] } } }));
const fake3 = { ctx: { loader: {} }, pkgMeta: new Map(), sourceKey: proto.sourceKey, locatePkgJson: proto.locatePkgJson,
  nearestPackage: proto.nearestPackage, resolveMeta: proto.resolveMeta };
let bad2 = 'no-throw', e2 = null;
try { bad2 = proto.resolveMeta.call(fake3, tmp + '/lib/client.js', pathToFileURL(tmp + '/').href); } catch (e) { e2 = e.message; }
ok('缺 ./client 导出时抛错（exports 是硬要求）', e2 !== null && /exports no/.test(e2), e2 || JSON.stringify(bad2));
fs.rmSync(tmp, { recursive: true, force: true });

// 确认 loader 行扫描入口以 entry 名为输入（README 论断的来源）
const src = fs.readFileSync(KERNEL + '/@deepseek-ai/dsh-client-modules/lib/index.js', 'utf8');
ok('resolveMeta 的形参为 loaderName', /resolveMeta\(loaderName, baseUrl\)/.test(src), '');
ok('注释确认「Loader 挂载的行的清单」语义', /Locate the manifest of the package the Loader mounts for a row/.test(src), '');

console.log('');
for (const r of results) console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.n + (r.pass ? '' : '   <- ' + r.d));
const f = results.filter((r) => !r.pass);
console.log('');
console.log(f.length === 0 ? '全部 ' + results.length + ' 项通过' : f.length + ' / ' + results.length + ' 项失败');
process.exit(f.length === 0 ? 0 : 1);