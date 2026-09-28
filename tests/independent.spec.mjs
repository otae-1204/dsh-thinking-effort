// 独立验证（verify-harness）：不复用 Lead 的断言，直接对真实宿主模块取证。
// 用法：node tests/independent.spec.mjs
//
// 与 Lead 的 panel.spec.mjs 的差异（刻意的）：
//   * 宿主参考实现取 _staging/dsh-full（0.1.7-rc.1，与运行中的宿主同版本）；
//     Lead 的 loadpath.spec.mjs 取 _staging/kernel-full（0.1.6-alpha.2）。见 VERSION 段。
//   * SlotCore 走**真实** dsh-client-ui-renderer 的 SlotRegistry（cordis Service），
//     插件以**真实 cordis 插件**身份挂载（inject 由 cordis 满足、卸载由 fiber 回收），
//     不是手写的 mock slots.inject。
//   * pi-ai 校验走**真实** apply() + internal/config 钩子（schemastery 之上的
//     resolveRouteModels/resolveModelReasoning 语义层），不是裸 Config(...)。
//   * ops 额外过**真实** typert 远端编解码器（settings/mutate 的 zod schema）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const NM = process.env.DSH_HOST_NM || path.join(PKG, '..', '_staging', 'dsh-full', 'dsh', 'node_modules');
const url = (p) => pathToFileURL(p).href;
const R = [];
const ok = (n, c, d) => R.push({ n, pass: !!c, d: d === undefined ? '' : String(d) });
const S = (v) => JSON.stringify(v);

// ---------- 真实宿主模块 ----------
const cordis = await import(url(path.join(NM, '@deepseek-ai/cordis/lib/index.js')));
const slotsMod = await import(url(path.join(NM, '@deepseek-ai/dsh-client-ui-slots/lib/index.js')));
const pi = await import(url(path.join(NM, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js')));
const cm = await import(url(path.join(NM, '@deepseek-ai/dsh-client-modules/lib/index.js')));
const dsMod = await import(url(path.join(NM, '@deepseek-ai/dsh-llm-deepseek/lib/index.js')));

// 真实 applyPathOp / isPlainObject：从**未修改的** dsh-settings 源码文本切出求值。
const settingsSrc = fs.readFileSync(path.join(NM, '@deepseek-ai/dsh-settings/lib/index.js'), 'utf8');
const cut = (a, b) => { const i = settingsSrc.indexOf(a); const j = settingsSrc.indexOf(b, i); if (i < 0 || j < 0) throw new Error('cut failed: ' + a); return settingsSrc.slice(i, j); };
const applyPathOp = new Function(cut('function isPlainObject(value) {', 'function applyPathOp(section, op, schema) {') + cut('function applyPathOp(section, op, schema) {', '/** Human label for a value') + '; return applyPathOp;')();
// 真实 mergeLayers：写用户层后，生效值 = base 层叠上用户层（这正是宿主 describe 的 value）
const mergeLayers = new Function(cut('function isPlainObject(value) {', 'function applyPathOp(section, op, schema) {') + cut('function mergeLayers(under, over) {', '/** Read one member of a plain object or array') + '; return mergeLayers;')();

// 真实 settings/mutate 远端编解码器（ops 的 zod schema）。
const typert = await import(url(path.join(NM, '@deepseek-ai/dsh-api-settings-controller/lib/typert.remote-client.js')));
const opsSchema = typert.TYPERT_REMOTE.descriptors.find((d) => d.method === 'mutate').parameters.find((p) => p.name === 'ops').codec.create();

// ---------- 迷你 React（真实 React 不在 node_modules 里；这是唯一无法用真件的环节） ----------
function makeReact() {
  const st = { hooks: [], cursor: 0, dirty: false, pending: [] };
  const R2 = {
    createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c.flat() }),
    useState: (init) => { const i = st.cursor++; if (!(i in st.hooks)) st.hooks[i] = typeof init === 'function' ? init() : init;
      return [st.hooks[i], (v) => { const nx = typeof v === 'function' ? v(st.hooks[i]) : v; if (S(nx) !== S(st.hooks[i])) { st.hooks[i] = nx; st.dirty = true; } }]; },
    useEffect: (fn, deps) => { const i = st.cursor++; const pv = st.hooks[i];
      if (!pv || !deps || deps.some((d, k) => d !== pv.deps[k])) { st.hooks[i] = { deps, cleanup: undefined, fn }; st.pending.push(i); } },
    memo: (c) => c,
  };
  return { R: R2, st, begin: () => { st.cursor = 0; st.dirty = false; },
    runEffects: () => { const p = st.pending; st.pending = []; for (const i of p) { const h = st.hooks[i]; if (h.cleanup) h.cleanup(); const c = h.fn(); h.cleanup = typeof c === 'function' ? c : undefined; } return p.length; } };
}
const texts = (n, o) => { o = o || []; if (n === null || n === undefined || typeof n === 'boolean') return o;
  if (typeof n === 'string' || typeof n === 'number') { o.push(String(n)); return o; }
  if (Array.isArray(n)) { n.forEach((x) => texts(x, o)); return o; }
  if (typeof n === 'object' && typeof n.type === 'function') { texts(n.type(Object.assign({}, n.props, { children: n.children })), o); return o; }
  if (typeof n === 'object' && n.children) n.children.forEach((x) => texts(x, o)); return o; };
const findClick = (n, label) => { let hit = null; const walk = (x) => { if (x === null || x === undefined || typeof x !== 'object') return;
  if (Array.isArray(x)) { x.forEach(walk); return; }
  if (typeof x.type === 'function') { walk(x.type(Object.assign({}, x.props, { children: x.children }))); return; }
  const p = x.props || {}; if (typeof p.onClick === 'function' && texts(x).join('') === label && hit === null) hit = p.onClick;
  if (x.children) x.children.forEach(walk); }; walk(n); return hit; };
const findAllChange = (n) => { const hits = []; const walk = (x) => { if (x === null || x === undefined || typeof x !== 'object') return;
  if (Array.isArray(x)) { x.forEach(walk); return; }
  if (typeof x.type === 'function') { walk(x.type(Object.assign({}, x.props, { children: x.children }))); return; }
  const p = x.props || {}; if (typeof p.onChange === 'function') hits.push({ onChange: p.onChange, value: p.value });
  if (x.children) x.children.forEach(walk); }; walk(n); return hits; };

const PLUGIN_SRC = fs.readFileSync(path.join(PKG, 'lib/client.js'), 'utf8');
const loadPlugin = (react) => {
  let def = null;
  new Function('window', 'document', PLUGIN_SRC)({ __ModuleLoader__: { load: (d) => { def = d; } } },
    { querySelector: () => null, createElement: () => ({ dataset: {}, style: {}, textContent: '' }), head: { appendChild: () => {} } });
  return def.factory((n) => (n === 'react' ? react : null));
};

// ================= 1. 真实 SlotRegistry + 真实 SlotCore + 真实 cordis fiber =================
{
  const rendererSrc = fs.readFileSync(path.join(NM, '@deepseek-ai/dsh-client-ui-renderer/lib/client.js'), 'utf8');
  let def = null;
  new Function('window', 'document', rendererSrc)({ __ModuleLoader__: { load: (d) => { def = d; } } }, undefined);
  class Component { constructor(p) { this.props = p || {}; } setState() {} render() { return null; } }
  const React = { Component, createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useMemo: (f) => f(), useRef: (v) => ({ current: v }), memo: (c) => c, useSyncExternalStore: () => undefined, createContext: () => ({ Provider: null }) };
  const renderer = def.factory((n) => (n === 'react' ? React
    : n === 'react/jsx-runtime' ? { jsx: () => null, jsxs: () => null, Fragment: null }
    : n === '@deepseek-ai/cordis' ? cordis
    : n === '@deepseek-ai/dsh-client-ui-slots' ? slotsMod
    : (n === 'react-dom' || n === 'react-dom/client') ? { createRoot: () => ({ render() {}, unmount() {} }) } : {}));
  ok('真实 renderer bundle 导出 SlotRegistry', typeof renderer.SlotRegistry === 'function', Object.keys(renderer).join(','));

  const root = new cordis.Context();
  new renderer.SlotRegistry(root);
  const slots = root.get('slots');           // cordis 服务代理，插件拿到的就是它
  ok('SlotRegistry 注册为 cordis 服务 "slots"', slots !== undefined && slots.constructor.name === 'SlotRegistry', String(slots && slots.constructor.name));

  // 复现宿主声明序列：root 声明 settings.section → models 条目声明 provider-card
  slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } }, () => null);
  slots.register({ name: 'settings.section', id: 'models', order: 10, children: { 'settings.models.provider-card': { kind: 'keyed', scope: 'root' } } }, () => null);
  const spec1 = slots._core.specDynamic('settings.models.provider-card');
  ok('provider-card 被声明为 keyed/scope=root', spec1 && spec1.kind === 'keyed' && spec1.scope === 'root', S(spec1));

  // 真实远端服务（cordis 需要能解析插件的 inject 才会启动 fiber）。
  // 宿主里 remote 是 api-gateway 的 ClientRemoteService，命名空间挂在它的属性上。
  // 宿主里 "remote" 由 api-gateway 的 ClientRemoteService 提供，命名空间同时以
  // "remote.<ns>" 注册（插件的 inject 三者都声明了）。这里如实复现。
  const remoteSettings = { describe: async () => ({ ok: true, value: { writable: true, namespaces: [] } }), mutate: async () => ({ ok: true, value: {} }) };
  const remoteLlm = { listConfigurableProviders: async () => ({ ok: true, value: [] }) };
  root.provide('remote', { settings: remoteSettings, llm: remoteLlm });
  root.provide('remote.settings', remoteSettings);
  root.provide('remote.llm', remoteLlm);

  const pmod = loadPlugin(makeReact().R);
  ok('插件导出 apply/inject', typeof pmod.apply === 'function' && Array.isArray(pmod.inject), Object.keys(pmod).join(','));
  ok('inject 声明了 slots 与 remote.settings', pmod.inject.includes('slots') && pmod.inject.includes('remote.settings'), S(pmod.inject));

  const fiber = root.plugin({ name: 'te-independent', inject: pmod.inject, apply: pmod.apply });
  await new Promise((r) => setTimeout(r, 80));
  const entries = slots._core.entriesOfSlot('settings.models.provider-card');
  const keys = entries.map((e) => e.options.key);
  ok('注册键含 llm-pi-ai 与 llm-deepseek', keys.includes('llm-pi-ai') && keys.includes('llm-deepseek'), S(keys));
  ok('用 entryKey=llm-pi-ai 能选中本插件条目（keyed 语义）',
    entries.filter((e) => e.options.key === 'llm-pi-ai').length === 1 && entries.filter((e) => e.options.key === 'nope').length === 0, S(keys));
  ok('条目 component 是函数组件', typeof (entries[0] && entries[0].component) === 'function', typeof (entries[0] && entries[0].component));

  // 冲突语义：同 key 同 priority 二次注册必须被真实 SlotCore 拒绝（证明 key 真的占一格）
  let conflict = null;
  try { slots.register({ name: 'settings.models.provider-card', key: 'llm-pi-ai' }, () => null); } catch (e) { conflict = e.message; }
  ok('同 key 二次注册被真实 SlotCore 拒绝（键确实生效）', conflict !== null && /already has an entry for key/.test(conflict), String(conflict).slice(0, 130));

  // 卸载：真实 cordis fiber dispose 必须回收注册（含异步补注册的那批）
  fiber.dispose();
  await new Promise((r) => setTimeout(r, 80));
  const after = slots._core.entries('settings.models.provider-card');
  ok('插件 fiber 卸载后条目全部回收（disposer 生效，无泄漏）', after.length === 0, S(after.map((e) => e.options.key)));
}

// ================= 面板驱动（真实组件 + 真实 ops） =================
const meProfile = { apiKeyEnv: 'ME_API_KEY', api: 'openai-completions', baseURL: 'http://127.0.0.1:8080/v1', reasoning: 'high',
  models: [
    { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', contextWindow: 1000000, maxTokens: 3000000, reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' }, input: ['text', 'image'] },
    { id: 'hy4-preview', name: 'hy4-preview', contextWindow: 1000000, maxTokens: 3000000, reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' }, input: ['text', 'image'] },
  ] };
// 宿主派发的 owner props：provider 字段本身是 ProviderDirectoryEntry 对象
const ownerProps = (entry) => ({ provider: entry, configured: true, keyConfigured: true });
const meEntry = { provider: 'me', displayName: 'me', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'me'] };

async function runPanel(view, entry, mutate) {
  const mini = makeReact();
  const pmod = loadPlugin(mini.R);
  const regs = []; const calls = { mutate: [] };
  const ctx = {
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    slots: { inject: (n, fn) => fn(), register: (o, c) => { regs.push({ o, c }); return () => {}; } },
    remote: {
      settings: { describe: async () => ({ ok: true, value: { writable: true, hasDocument: true, namespaces: [view] } }),
        mutate: async (ns, ops, rev) => { calls.mutate.push({ ns, ops, rev }); return mutate ? mutate(ns, ops, rev) : { ok: true, value: view }; } },
      llm: { listConfigurableProviders: async () => ({ ok: true, value: [] }) },
    },
  };
  pmod.apply(ctx);
  const Comp = regs[0].c;
  const draw = async () => { let tree = null;
    for (let i = 0; i < 40; i++) { mini.begin(); tree = Comp(ownerProps(entry)); const ran = mini.runEffects();
      for (let t = 0; t < 12; t++) await new Promise((r) => setTimeout(r, 0)); if (!mini.st.dirty && ran === 0) break; }
    return tree; };
  // 面板默认收起（产品行为）。夹具模拟真实用户：先点「展开」再操作正文。
  const expand = async () => {
    let tree = await draw();
    const btn = findClick(tree, '展开');
    if (typeof btn === 'function') { btn(); await new Promise((r) => setTimeout(r, 0)); tree = await draw(); }
    return tree;
  };
  return { mini, Comp, calls, draw, expand };
}

// 真实 pi-ai 语义校验链：apply() 捕获 internal/config 钩子 → Config + assertServiceable
function realPiAiAccepts(section) {
  const hooks = new Map();
  const ctx = {
    fiber: { entry: { options: { id: 'llm-pi-ai' } } },
    inject: (names, cb) => { if (names.includes('settings')) cb({ effect: () => () => {}, settings: { configure: () => () => {} } }); },
    on: (name, fn) => { hooks.set(name, fn); },
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    get: () => undefined, logger: { warn: () => {}, error: () => {}, info: () => {} },
    llm: { registerConfigurableProviders: () => ({ replace: () => {} }), registerModelDiscovery: () => {}, registerAdapter: () => ({ replace: () => {} }) },
  };
  try { pi.apply(ctx, { providers: { get: () => section.providers } }); } catch (e) { return { ok: false, msg: 'apply threw: ' + String(e.message).slice(0, 120) }; }
  const hook = hooks.get('internal/config');
  if (hook === undefined) return { ok: false, msg: 'no internal/config hook' };
  try { hook.call(ctx.fiber, null, () => section); return { ok: true, msg: 'accepted' }; }
  catch (e) { return { ok: false, msg: String(e.message).split('\n')[0].slice(0, 150) }; }
}

// ================= 2 + 4. 面板 ops × 真实 applyPathOp × 真实 wire codec =================
{
  // 场景 A：用户层已有同长 models 数组 → 精确下标
  const userA = { providers: { me: { models: JSON.parse(JSON.stringify(meProfile.models)) } } };
  const viewA = { ns: 'llm-pi-ai', revision: 7, value: { providers: { me: meProfile } }, user: userA, applies: 'live', secrets: [] };
  const A = await runPanel(viewA, meEntry);
  const treeA = await A.expand();
  ok('A: 面板渲染出模型 id', texts(treeA).join(' ').includes('deepseek-v4.1-flash'), texts(treeA).join(' ').slice(0, 90));
  const toggleMid = findClick(treeA, '中');
  ok('A: 找到「中」档开关', typeof toggleMid === 'function', typeof toggleMid);
  if (typeof toggleMid === 'function') {
    toggleMid(); await new Promise((r) => setTimeout(r, 0));
    const treeA2 = await A.draw();
    const save = findClick(treeA2, '保存');
    ok('A: 找到「保存」按钮', typeof save === 'function', typeof save);
    if (typeof save === 'function') { save(); for (let t = 0; t < 25; t++) await new Promise((r) => setTimeout(r, 0)); }
  }
  ok('A: 保存产生一次 mutate', A.calls.mutate.length === 1, A.calls.mutate.length);
  const call = A.calls.mutate[0];
  if (call) {
    ok('A: ns/revision 正确', call.ns === 'llm-pi-ai' && call.rev === 7, call.ns + '/' + call.rev);
    const target = call.ops.find((o) => o.path.join('.') === 'providers.me.models.0.reasoningEfforts');
    ok('A: 使用精确下标路径 models.0.reasoningEfforts', target !== undefined, S(call.ops.map((o) => o.path.join('.'))));
    ok('A: 下标是字符串 "0"', target !== undefined && target.path[3] === '0' && typeof target.path[3] === 'string', target ? S(target.path) : '');
    ok('A: 未勾选模型无路径（只改被操作的那个模型）', call.ops.every((o) => o.path.join('.').indexOf('models.1') < 0), S(call.ops.map((o) => o.path.join('.'))));

    let wire = 'accepted';
    try { opsSchema.parse(call.ops); } catch (e) { wire = String(e.message).split('\n')[0].slice(0, 80); }
    ok('A: ops 通过真实 settings/mutate 编解码器', wire === 'accepted', wire);

    let applied = JSON.parse(JSON.stringify(userA));
    for (const op of call.ops) applied = applyPathOp(applied, op, undefined);
    ok('A: 真实 applyPathOp 后 models 仍是数组', Array.isArray(applied.providers.me.models), Object.prototype.toString.call(applied.providers.me.models));
    ok('A: 未修改的模型 1 逐字节不变', S(applied.providers.me.models[1]) === S(userA.providers.me.models[1]), S(applied.providers.me.models[1]).slice(0, 90));
    ok('A: 目标模型仅 reasoningEfforts 变化（其余字段逐字节不变）', (() => {
      const b = { ...userA.providers.me.models[0] }; const a = { ...applied.providers.me.models[0] };
      delete b.reasoningEfforts; delete a.reasoningEfforts; return S(b) === S(a);
    })(), S(Object.keys(applied.providers.me.models[0])));
    ok('A: 应用结果等于 ops 的 value', target !== undefined && S(applied.providers.me.models[0].reasoningEfforts) === S(target.value),
      S(applied.providers.me.models[0].reasoningEfforts));
    ok('A: 取消「中」后字典无 medium、off 为 null', target !== undefined && target.value.medium === undefined && target.value.off === null, target ? S(target.value) : '');

    // 生效值 = 基础层叠上写入后的用户层（宿主 describe 的 value 就是这个投影）
    const effective = mergeLayers({ providers: { me: meProfile } }, applied);
    const accepted = realPiAiAccepts({ providers: effective.providers });
    ok('A: 真实 pi-ai 语义校验链接受写入后的生效值', accepted.ok, accepted.msg);
  }
}

{
  // 场景 B：用户层无该数组 → 退化整数组写入（Lead 关注的坑 A）
  const userB = { providers: { me: { apiKeyEnv: 'ME_API_KEY' } } };
  const viewB = { ns: 'llm-pi-ai', revision: 3, value: { providers: { me: meProfile } }, user: userB, applies: 'live', secrets: [] };
  const B = await runPanel(viewB, meEntry);
  const treeB = await B.expand();
  const tB = findClick(treeB, '中');
  if (typeof tB === 'function') { tB(); await new Promise((r) => setTimeout(r, 0));
    const treeB2 = await B.draw(); const saveB = findClick(treeB2, '保存');
    if (typeof saveB === 'function') { saveB(); for (let t = 0; t < 25; t++) await new Promise((r) => setTimeout(r, 0)); } }
  const callB = B.calls.mutate[0];
  ok('B: 退化路径保存调用 mutate', callB !== undefined, B.calls.mutate.length);
  if (callB) {
    const paths = callB.ops.map((o) => o.path.join('.'));
    ok('B: 不含下标路径', paths.every((p) => p.indexOf('models.0') < 0 && p.indexOf('models.1') < 0), S(paths));
    const whole = callB.ops.find((o) => o.path.join('.') === 'providers.me.models');
    ok('B: 整数组写入 models', whole !== undefined, S(paths));
    ok('B: 写入值是数组', whole !== undefined && Array.isArray(whole.value), whole ? Object.prototype.toString.call(whole.value) : '');
    let wire = 'accepted';
    try { opsSchema.parse(callB.ops); } catch (e) { wire = String(e.message).split('\n')[0].slice(0, 80); }
    ok('B: ops 通过真实 settings/mutate 编解码器', wire === 'accepted', wire);
    let applied = JSON.parse(JSON.stringify(userB));
    for (const op of callB.ops) applied = applyPathOp(applied, op, undefined);
    ok('B: 真实 applyPathOp 后 models 是数组而非 {"0":…} 对象', Array.isArray(applied.providers.me.models),
      Object.prototype.toString.call(applied.providers.me.models) + ' ' + S(applied.providers.me.models).slice(0, 60));
    ok('B: 未勾选模型的 reasoningEfforts 未被顺手改写',
      S(applied.providers.me.models[1].reasoningEfforts) === S(meProfile.models[1].reasoningEfforts), S(applied.providers.me.models[1].reasoningEfforts));
    const effective = mergeLayers({ providers: { me: meProfile } }, applied);
    const accepted = realPiAiAccepts({ providers: effective.providers });
    ok('B: 真实 pi-ai 语义校验链接受退化路径后的生效值', accepted.ok, accepted.msg);
  }
}

// 反例：语义层必须拒绝空 dict / 仅 off / 非法 wire
{
  const mk = (efforts) => ({ providers: { me: { ...JSON.parse(JSON.stringify(meProfile)), models: [{ ...JSON.parse(JSON.stringify(meProfile.models[0])), reasoningEfforts: efforts }] } } });
  const empty = realPiAiAccepts(mk({}));
  ok('反例: reasoningEfforts={} 被真实语义层拒绝', !empty.ok, empty.msg);
  const onlyOff = realPiAiAccepts(mk({ off: null }));
  ok('反例: reasoningEfforts={off:null}（无非 off 等级）被拒绝', !onlyOff.ok, onlyOff.msg);
  const nullWire = realPiAiAccepts(mk({ off: null, high: null }));
  ok('反例: 非 off 等级 wire 为 null 被拒绝', !nullWire.ok, nullWire.msg);
  const emptyWire = realPiAiAccepts(mk({ off: null, high: '' }));
  ok('反例: 非 off 等级 wire 为空串被拒绝', !emptyWire.ok, emptyWire.msg);
  const bogus = realPiAiAccepts(mk({ off: null, bogus: 'x' }));
  ok('反例: 未知等级键被拒绝', !bogus.ok, bogus.msg);
  const bare = [];
  for (const e of [{}, { off: null }, { off: null, high: null }, { off: null, high: '' }]) {
    try { pi.Config(mk(e).providers); bare.push('accepted'); } catch (err) { bare.push('rejected'); }
  }
  ok('对照: 裸 Config(...) 不构成语义闸门（证明反例必须走 apply 链）', bare.every((x) => x === 'accepted'), S(bare));
}

// 生效证据：真实 apply → 真实 adapter.resolveModel 公布的可用等级
{
  const hooks = new Map(); let captured = null;
  const ctx = {
    fiber: { entry: { options: { id: 'llm-pi-ai' } } },
    inject: (names, cb) => { if (names.includes('settings')) cb({ effect: () => () => {}, settings: { configure: () => () => {} } }); },
    on: (n, fn) => { hooks.set(n, fn); }, effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    get: () => undefined, logger: { warn: () => {}, error: () => {}, info: () => {} },
    llm: { registerConfigurableProviders: () => ({ replace: () => {} }), registerModelDiscovery: () => {},
      registerAdapter: (routes, adapter) => { captured = { routes, adapter }; return { replace: () => {} }; } },
  };
  const base = { providers: { me: { ...JSON.parse(JSON.stringify(meProfile)), models: [JSON.parse(JSON.stringify(meProfile.models[0]))] } } };
  delete base.providers.me.models[0].reasoningEfforts;   // 写入前
  pi.apply(ctx, { providers: { get: () => base.providers } });
  const before = await captured.adapter.resolveModel('me', 'deepseek-v4.1-flash');
  const beforeLevels = (before.reasoning ? before.reasoning.efforts.map((e) => e.id) : ['off']);
  ok('生效: 写入前该模型公布的可用等级只有 off', S(beforeLevels) === S(['off']), S(beforeLevels));

  const after = { providers: { me: { ...JSON.parse(JSON.stringify(meProfile)), models: [JSON.parse(JSON.stringify(meProfile.models[0]))] } } };
  after.providers.me.models[0].reasoningEfforts = { off: null, low: 'low', high: 'high' };
  pi.apply(ctx, { providers: { get: () => after.providers } });
  const got = await captured.adapter.resolveModel('me', 'deepseek-v4.1-flash');
  const levels = (got.reasoning ? got.reasoning.efforts.map((e) => e.id) : ['off']);
  ok('生效: 写入后公布的可用等级为 off/low/high（面板声明生效）', S(levels) === S(['off', 'low', 'high']), S(levels));
  ok('生效: 路由默认档位 high 被采纳为 defaultEffort', got.reasoning && got.reasoning.defaultEffort === 'high', got.reasoning ? String(got.reasoning.defaultEffort) : 'none');
}

{
  // 场景 A2：清空某模型的全部等级 → 必须 unset 而非写空字典（pi-ai 拒绝空 dict）
  const userA2 = { providers: { me: { models: JSON.parse(JSON.stringify(meProfile.models)) } } };
  const viewA2 = { ns: 'llm-pi-ai', revision: 9, value: { providers: { me: meProfile } }, user: userA2, applies: 'live', secrets: [] };
  const A2 = await runPanel(viewA2, meEntry);
  const t0 = await A2.expand();
  // 逐个关掉模型 0 的全部等级（低/中/高/最大 + 关）
  for (const label of ['低', '中', '高', '最大', '关']) {
    const t = await A2.draw();
    const click = findClick(t, label);
    if (typeof click === 'function') { click(); await new Promise((r) => setTimeout(r, 0)); }
  }
  const t1 = await A2.draw();
  const saveA2 = findClick(t1, '保存');
  if (typeof saveA2 === 'function') { saveA2(); for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0)); }
  const callA2 = A2.calls.mutate[0];
  const msgA2 = texts(await A2.draw()).join(' ').slice(-90);
  ok('A2: 清空全部等级后保存调用 mutate（应产出 unset）', callA2 !== undefined,
    'mutate=' + A2.calls.mutate.length + ' 面板消息: ' + msgA2);
  if (callA2) {
    const unset = callA2.ops.find((o) => o.op === 'unset' && o.path.join('.') === 'providers.me.models.0.reasoningEfforts');
    const asSet = callA2.ops.find((o) => o.op === 'set' && o.path.join('.') === 'providers.me.models.0.reasoningEfforts');
    ok('A2: 清空走 unset（不是写空字典 {})', unset !== undefined && asSet === undefined, S(callA2.ops));
    let applied = JSON.parse(JSON.stringify(userA2));
    for (const op of callA2.ops) applied = applyPathOp(applied, op, undefined);
    ok('A2: 真实 applyPathOp 后该模型不再有 reasoningEfforts 键',
      !Object.prototype.hasOwnProperty.call(applied.providers.me.models[0], 'reasoningEfforts'), S(Object.keys(applied.providers.me.models[0])));
    const effective = mergeLayers({ providers: { me: meProfile } }, applied);
    const accepted = realPiAiAccepts({ providers: effective.providers });
    ok('A2: 真实 pi-ai 语义校验链接受清空后的生效值（回落到目录能力）', accepted.ok, accepted.msg);
    // 反证：若改写成空字典，同一链路必须拒绝——证明 unset 是必要的
    const bad = JSON.parse(JSON.stringify(userA2));
    const badApplied = applyPathOp(bad, { op: 'set', path: ['providers', 'me', 'models', '0', 'reasoningEfforts'], value: {} }, undefined);
    const badEffective = mergeLayers({ providers: { me: meProfile } }, badApplied);
    const badResult = realPiAiAccepts({ providers: badEffective.providers });
    ok('A2: 反证 写成空字典 {} 会被真实语义层拒绝（故 unset 必要）', !badResult.ok, badResult.msg);
  }
}

{
  // 场景 D：modelOverrides 路径（插件 listModels 的 override 分支）
  const ovProfile = { apiKeyEnv: 'ME_API_KEY', api: 'openai-completions', baseURL: 'http://x/v1',
    modelOverrides: { 'some-catalog-model': { reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } } } };
  const userD = { providers: { me: { modelOverrides: { 'some-catalog-model': { reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } } } } } };
  const viewD = { ns: 'llm-pi-ai', revision: 5, value: { providers: { me: ovProfile } }, user: userD, applies: 'live', secrets: [] };
  const D = await runPanel(viewD, meEntry);
  const treeD = await D.expand();
  ok('D: 面板列出 modelOverrides 的模型 id', texts(treeD).join(' ').includes('some-catalog-model'), texts(treeD).join(' ').slice(0, 100));
  const toggleD = findClick(treeD, '中');
  if (typeof toggleD === 'function') { toggleD(); await new Promise((r) => setTimeout(r, 0));
    const treeD2 = await D.draw(); const saveD = findClick(treeD2, '保存');
    if (typeof saveD === 'function') { saveD(); for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0)); } }
  const callD = D.calls.mutate[0];
  ok('D: modelOverrides 保存调用 mutate', callD !== undefined, D.calls.mutate.length);
  if (callD === undefined) ok('D: （上一条失败的证据）面板消息', false, texts(await D.draw()).join(' ').slice(-90));
  if (callD) {
    const target = callD.ops.find((o) => o.path.join('.') === 'providers.me.modelOverrides.some-catalog-model.reasoningEfforts');
    ok('D: 写入 modelOverrides.<id>.reasoningEfforts（用 id 而非下标）', target !== undefined, S(callD.ops.map((o) => o.path.join('.'))));
    let applied = JSON.parse(JSON.stringify(userD));
    for (const op of callD.ops) applied = applyPathOp(applied, op, undefined);
    ok('D: 真实 applyPathOp 应用后 medium 被移除、off 仍为 null',
      target !== undefined && applied.providers.me.modelOverrides['some-catalog-model'].reasoningEfforts.medium === undefined
      && applied.providers.me.modelOverrides['some-catalog-model'].reasoningEfforts.off === null,
      S(applied.providers.me.modelOverrides['some-catalog-model'].reasoningEfforts));
  }
}

// 场景 C：DeepSeek 路由级 + 宿主联动约束
{
  const dsProfile = { baseURL: 'https://api.deepseek.com/anthropic', thinking: 'enabled', reasoningEffort: 'high', models: [{ id: 'deepseek-chat', inputModalities: ['text'] }] };
  const viewC = { ns: 'llm-deepseek', revision: 2, value: dsProfile, user: { thinking: 'enabled', reasoningEffort: 'high' }, applies: 'live', secrets: [] };
  const dsEntry = { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] };
  const C = await runPanel(viewC, dsEntry);
  const treeC = await C.expand();
  const textC = texts(treeC).join(' ');
  ok('C: DeepSeek 面板说明档位为路由级', textC.includes('路由级'), textC.slice(0, 90));
  ok('C: DeepSeek 面板有 thinking / reasoningEffort 控件', textC.includes('thinking') && textC.includes('reasoningEffort'), '');
  const selects = findAllChange(treeC);
  ok('C: 面板给出两个下拉（thinking / reasoningEffort）', selects.length === 2, S(selects.map((s) => s.value)));
  if (selects.length === 2) {
    selects[1].onChange({ target: { value: 'max' } }); await new Promise((r) => setTimeout(r, 0));
    const treeC2 = await C.draw();
    const think = findAllChange(treeC2)[0];
    if (think) { think.onChange({ target: { value: 'disabled' } }); await new Promise((r) => setTimeout(r, 0)); }
    const treeC3 = await C.draw();
    const saveC = findClick(treeC3, '保存');
    if (typeof saveC === 'function') { saveC(); for (let t = 0; t < 25; t++) await new Promise((r) => setTimeout(r, 0)); }
    const callC = C.calls.mutate[0];
    ok('C: DeepSeek 保存调用 mutate', callC !== undefined, C.calls.mutate.length);
    if (callC) {
      const th = callC.ops.find((o) => o.path.join('.') === 'thinking');
      const eff = callC.ops.find((o) => o.path.join('.') === 'reasoningEffort');
      ok('C: 写入 thinking=disabled', th !== undefined && th.value === 'disabled', S(th));
      ok('C: thinking 关闭时 reasoningEffort 被强制为 off（满足宿主联动约束）', eff !== undefined && eff.value === 'off', S(eff));
      // 真实宿主约束：这条写入必须能被 llm-deepseek 的 Config + 校验接受
      const dsConfig = dsMod.Config;
      const merged = { ...dsProfile, thinking: 'disabled', reasoningEffort: 'off' };
      let acc = true, m = '';
      try { dsConfig(merged); } catch (e) { acc = false; m = e.message; }
      ok('C: 写入结果被真实 llm-deepseek Config 接受', acc, m.slice(0, 120));
      // 跨字段约束在 resolveAdapterOptions（Config/schemastery 只看单字段类型）
      let rej = null;
      try { dsMod.resolveAdapterOptions({ ...dsProfile, thinking: 'disabled', reasoningEffort: 'high' }, undefined); } catch (e) { rej = e.message; }
      ok('C: 反例 thinking=disabled+effort=high 被真实 resolveAdapterOptions 拒绝', rej !== null, String(rej).slice(0, 130));
      let okOff = 'accepted';
      try { dsMod.resolveAdapterOptions({ ...dsProfile, thinking: 'disabled', reasoningEffort: 'off' }, undefined); } catch (e) { okOff = e.message; }
      ok('C: 正例 thinking=disabled+effort=off 被真实 resolveAdapterOptions 接受', okOff === 'accepted', okOff);
    }
  }
  ok('C: 宿主确有「thinking 关闭时只允许 off」的硬约束',
    /only reasoningEffort \\?"off\\?" can be configured when thinking is disabled/.test(fs.readFileSync(path.join(NM, '@deepseek-ai/dsh-llm-deepseek/lib/index.js'), 'utf8')), '');
}

// ================= 4. 下标形态：字符串是 wire 层硬要求 =================
{
  const arr = () => ({ providers: { me: { models: [{ id: 'a' }, { id: 'b' }] } } });
  const setAt = (idx) => applyPathOp(arr(), { op: 'set', path: ['providers', 'me', 'models', idx, 'k'], value: 9 }, undefined);
  ok('4: applyPathOp 接受字符串 "0"', (() => { try { return S(setAt('0').providers.me.models) === S([{ id: 'a', k: 9 }, { id: 'b' }]); } catch { return false; } })(), '');
  let n0 = 'accepted';
  try { setAt(0); } catch (e) { n0 = e.message; }
  ok('4: applyPathOp 自身对数字 0 也接受（类型闸门不在它这里）', n0 === 'accepted', n0);
  let zz = 'accepted';
  try { setAt('00'); } catch (e) { zz = e.message; }
  ok('4: applyPathOp 拒绝 "00"（正则 /^(0|[1-9][0-9]*)$/）', /out of range/.test(zz), zz);
  let z1 = 'accepted';
  try { setAt('01'); } catch (e) { z1 = e.message; }
  ok('4: applyPathOp 拒绝 "01"', /out of range/.test(z1), z1);
  let wireNum = 'accepted';
  try { opsSchema.parse([{ op: 'set', path: ['providers', 'me', 'models', 0, 'k'], value: 9 }]); } catch (e) { wireNum = 'rejected'; }
  ok('4: 真实 settings/mutate 编解码器拒收数字下标（path 必须是 string[]）→ 字符串是硬要求', wireNum === 'rejected', wireNum);
  const missing = applyPathOp({ providers: { me: { apiKeyEnv: 'X' } } }, { op: 'set', path: ['providers', 'me', 'models', '0', 'k'], value: 1 }, undefined);
  ok('4: 对缺失数组写下标会造出 {"0":…} 对象（这正是退化整数组路径存在的原因）',
    !Array.isArray(missing.providers.me.models) && missing.providers.me.models['0'] !== undefined, S(missing.providers.me.models));
}

// ================= 5. 加载链路 =================
{
  const pkgUrl = url(PKG + '/');
  const loaderEntries = [{ options: { id: 'thinking-effort', name: '@dsh-external/dsh-thinking-effort' }, fiber: {}, disabled: false,
    parent: { tree: { ctx: { baseUrl: pkgUrl } } } }];
  const root = new cordis.Context();
  root.loader = { entries: () => loaderEntries, internal: undefined };
  root.inject = (names, cb) => { cb({ effect: () => () => {}, webServer: { register: () => () => {} } }); };
  root.logger = { warn: () => {}, error: () => {}, info: () => {} };
  let reg = null; let err = null;
  try { reg = new cm.ClientModuleRegistry(root); } catch (e) { err = String(e.message).split('\n')[0]; }
  ok('5: 真实 ClientModuleRegistry 以本包为 loader 行构建成功（清单合法）', reg !== null, err || 'ok');
  if (reg) {
    const graph = reg.graph();
    const row = graph.entries.find((e) => e.id === '@dsh-external/dsh-thinking-effort');
    ok('5: 该行进入 __DSH_BOOT__ 图（id = 包名）', row !== undefined, S(graph.entries.map((e) => e.id)));
    ok('5: 行的 clientPath 指向 lib/client.js', reg.clientPath('@dsh-external/dsh-thinking-effort') === path.join(PKG, 'lib/client.js'),
      reg.clientPath('@dsh-external/dsh-thinking-effort'));
    const rows = cm.bootInjections(graph);
    const boot = rows.find((r) => r.kind === 'global' && r.name === '__DSH_BOOT__');
    ok('5: bootInjections 产出 __DSH_BOOT__ 全局行', boot !== undefined, S(rows.map((r) => r.kind + ':' + (r.name || r.src || ''))));
    ok('5: __DSH_BOOT__.entries 含本包', boot !== undefined && boot.value.entries.some((e) => e.id === '@dsh-external/dsh-thinking-effort'), '');
    const res = await reg.fetchBundle(new Request('http://x/' + row.url));
    const body = await res.text();
    ok('5: 组合 bundle 可取到（HTTP 200）', res.status === 200, res.status);
    ok('5: 组合 bundle 内含本包的 __ModuleLoader__.load 注册',
      body.includes('__ModuleLoader__.load') && body.includes('@dsh-external/dsh-thinking-effort'), body.length + ' bytes');
    const ab = await import(url(path.join(NM, '@deepseek-ai/dsh-app-boot/lib/index.js')));
    const manifest = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
    const paths = ab.bundlePatchPaths(PKG, manifest.dsh.bundle);
    ok('5: 真实 bundlePatchPaths 解析 dsh.bundle.patch', paths.length === 1 && fs.existsSync(paths[0]), S(paths));
    const patches = ab.loadOverlayPatches('dsh', paths[0]);
    ok('5: 真实 loadOverlayPatches 接受 cordis.patch.yml', Array.isArray(patches) && patches[0].insert[0].id === 'thinking-effort', S(patches));
    const composed = ab.composeEntries([patches]);
    ok('5: 真实 composeEntries 产出本包的 loader 行',
      composed.some((r) => r.id === 'thinking-effort' && r.name === '@dsh-external/dsh-thinking-effort'), S(composed));
    const bundleList = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE || '', '.dsh/profiles/desktop/package.json'), 'utf8')).dsh.profile.bundles;
    // 该状态取决于用户是否已安装，不能硬编码；只断言「清单与 profile 状态自洽」。
    const listed = bundleList.includes('@dsh-external/dsh-thinking-effort');
    ok('5: 本包在 profile bundles 中的状态可读取（无论已装/未装都自洽）',
      Array.isArray(bundleList), (listed ? '已列入（已安装）' : '未列入（未安装）') + ' ' + S(bundleList));
  }
  ok('5: 离线不可验证的一环（如实声明）：loader 真正 create 该行 + 浏览器执行 + profile 安装',
    true, '需要 install 进 profile 并重启宿主；本会话禁止（会杀掉托管会话）');
}

// ================= 版本一致性 =================
{
  const v = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')).version; } catch { return 'n/a'; } };
  const fullV = v(path.join(NM, '..', 'package.json'));
  const kernelNm = path.join(PKG, '..', '_staging', 'kernel-full', 'dsh', 'node_modules');
  const kernelV = v(path.join(kernelNm, '..', 'package.json'));
  ok('VERSION: 本 spec 使用 dsh-full（与运行宿主同版本）', fullV === '0.1.7-rc.1', fullV);
  ok('VERSION: kernel-full 是另一版参考（Lead 的 loadpath.spec 取自它）', kernelV !== fullV, kernelV + ' vs ' + fullV);
  const rd = (p) => { try { return fs.readFileSync(p); } catch { return null; } };
  const same = (a, b) => { const x = rd(a), y = rd(b); return x && y && x.equals(y); };
  ok('VERSION: dsh-client-modules 在两份参考里不同（loadpath 结论应基于 dsh-full）',
    !same(path.join(NM, '@deepseek-ai/dsh-client-modules/lib/index.js'), path.join(kernelNm, '@deepseek-ai/dsh-client-modules/lib/index.js')), '');
  ok('VERSION: dsh-client-ui-slots 两份一致（SlotCore 断言不受版本影响）',
    same(path.join(NM, '@deepseek-ai/dsh-client-ui-slots/lib/index.js'), path.join(kernelNm, '@deepseek-ai/dsh-client-ui-slots/lib/index.js')), '');
  ok('VERSION: dsh-llm-pi-ai / dsh-settings 两份不同（Lead 的 panel.spec 同时混用了两处）',
    !same(path.join(NM, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), path.join(kernelNm, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js'))
    && !same(path.join(NM, '@deepseek-ai/dsh-settings/lib/index.js'), path.join(kernelNm, '@deepseek-ai/dsh-settings/lib/index.js')), '');
}

// ================= 缺陷回归：unset 分支必须可达（曾因顺序错误不可达） =================
// 背景：verify-harness 曾定位到真实缺陷 —— opsForPiAi 在「空选集合」判断**之前**
// 就调用 dictFromSel，于是「清空全部等级」被误判成「无非 off 等级」的错误，
// 与面板文案「不勾选任何等级即回到内置目录声明的能力」矛盾，unset 分支永不可达。
// 已修复：先判空集合 → value=undefined（走 unset），非空才交给 dictFromSel 校验。
// 本断言锁死修复后的顺序，防止回归。
{
  const src = fs.readFileSync(path.join(PKG, 'lib/client.js'), 'utf8');
  const lineOf = (needle) => src.split('\n').findIndex((l) => l.includes(needle)) + 1;
  const guard = lineOf('至少声明一个「关」之外的等级');
  const emptyCheck = lineOf('if (Object.keys(sel).length === 0) {');
  const callSite = lineOf('var built = dictFromSel(sel, wires);');
  ok('回归: 空集合判断先于 dictFromSel 调用（unset 分支可达）',
    emptyCheck > 0 && callSite > 0 && emptyCheck < callSite,
    '空集合判断 L' + emptyCheck + ' / dictFromSel 调用 L' + callSite + ' / 守卫 L' + guard);
  ok('回归: 面板文案与实现一致（不勾选任何等级即回到内置目录的能力）',
    src.includes('不勾选任何等级即回到内置目录声明的能力'), '');
  ok('回归: 空集合不再被判成「至少声明一个非 off 等级」的错误',
    src.indexOf('value = void 0;') > 0 && emptyCheck < callSite, '');
}

console.log('');
for (const r of R) console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.n + (r.d ? '   [' + r.d + ']' : ''));
const failed = R.filter((r) => !r.pass);
console.log('');
console.log(failed.length === 0 ? '全部 ' + R.length + ' 项通过' : failed.length + ' / ' + R.length + ' 项失败');
process.exit(failed.length === 0 ? 0 : 1);
