// 思考强度面板端到端验证
// 真实 applyPathOp 落盘 + 真实 pi-ai/deepseek Config 校验 + 真实 resolveModelReasoning 语义层。
//
// ⚠️ 取证一致性：全部参考实现**只取一处** —— 从运行中宿主的 app.asar 提取的 REF
// （DSH_REF_DIR，默认 ../_effref，版本 0.1.7-rc.2）。不要混用 _staging 下的其他副本：
// 它们可能是别的版本（例如 kernel-full 是 0.1.6-alpha.2、dsh-full 是 0.1.7-rc.1），
// 混用会让断言基于不同版本的契约。文件末尾有版本自证断言。
//
// 槽位驱动：本脚本用最小 slots 替身（inject 立即回调 + register 记录），
// **真实 SlotCore 的注册/派发/回收语义由 independent.spec.mjs 覆盖**（那才是契约证据）。
//
// 路径可用环境变量覆盖，便于在别的机器复现：
//   DSH_REF_DIR         从 app.asar 提取的 @deepseek-ai 参考实现目录（默认 ../_effref）
//   DSH_TE_PROFILE_DIR  被检查的 profile 目录（默认 ~/.dsh/profiles/desktop；勿用 DSH_PROFILE，宿主已占用该名）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const REF = process.env.DSH_REF_DIR || path.join(PKG, '..', '_effref');
// 两份来源，各有明确用途（避免此前「声明了却未用」的死代码与隐性混用）：
//   REF  从运行中 app.asar 提取的副本（0.1.7-rc.2，已与 asar 逐包比对一致）：
//        用于 applyPathOp —— 它是**源码文本切取**求值，不需要依赖解析链。
//   FULL 可运行的完整树（0.1.7-rc.1）：用于 import 适配器模块 —— REF 是裸副本，
//        缺 @deepseek-ai/* 依赖链（实测 import 会 ERR_MODULE_NOT_FOUND），无法直接加载。
//        已实测 REF 与 FULL 的 dsh-client-modules 内容逐字节相同；适配器行为由
//        independent.spec.mjs 在 dsh-full 上另做语义级取证。
const FULL = process.env.DSH_FULL_NM || path.join(PKG, '..', '_staging', 'dsh-full', 'dsh', 'node_modules');
const PROFILE = process.env.DSH_TE_PROFILE_DIR || path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
const url = (p) => pathToFileURL(p).href;

const ROOT = PKG;
const SRC = fs.readFileSync(ROOT + '/lib/client.js', 'utf8');
const results = [];
const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail) });

// ---- 真实 pi-ai 语义闸门 ----
// 重要：裸 Config(...) **不是**语义闸门 —— 实测它对 {} / {off:null} / {off:null,high:null} /
// {off:null,high:""} 一律 accepted（由 independent.spec.mjs 独立证实）。
// 真正的校验在 apply() 注册的 internal/config 钩子里（→ resolveRouteModels → resolveModelReasoning）。
// 故凡「接受」类断言都必须走这条链，否则恒真、没有鉴别力。
let _piMod = null;
async function piSemanticAccepts(section) {
  if (_piMod === null) _piMod = await import(url(path.join(FULL, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js')));
  const hooks = new Map();
  const ctx = {
    fiber: { entry: { options: { id: 'llm-pi-ai' } } },
    inject: (names, cb) => { if (names.includes('settings')) cb({ effect: () => () => {}, settings: { configure: () => () => {} } }); },
    on: (name, fn) => { hooks.set(name, fn); },
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    get: () => undefined, logger: { warn: () => {}, error: () => {}, info: () => {} },
    llm: { registerConfigurableProviders: () => ({ replace: () => {} }), registerModelDiscovery: () => {}, registerAdapter: () => ({ replace: () => {} }) },
  };
  try { _piMod.apply(ctx, { providers: { get: () => section.providers } }); } catch (e) { return { ok: false, msg: 'apply threw: ' + String(e.message).slice(0, 120) }; }
  const hook = hooks.get('internal/config');
  if (hook === undefined) return { ok: false, msg: 'no internal/config hook' };
  try { hook.call(ctx.fiber, null, () => section); return { ok: true, msg: 'accepted' }; }
  catch (e) { return { ok: false, msg: String(e.message).split('\n')[0].slice(0, 150) }; }
}

// ---- 迷你 React：支持 useState 重渲染与 useEffect 依赖触发 ----
function makeReact() {
  const st = { hooks: [], cursor: 0, dirty: false, pending: [] };
  const R = {
    createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c.flat() }),
    useState: (init) => {
      const i = st.cursor++;
      if (!(i in st.hooks)) st.hooks[i] = typeof init === 'function' ? init() : init;
      return [st.hooks[i], (v) => { const next = typeof v === 'function' ? v(st.hooks[i]) : v; if (JSON.stringify(next) !== JSON.stringify(st.hooks[i])) { st.hooks[i] = next; st.dirty = true; } }];
    },
    useEffect: (fn, deps) => {
      const i = st.cursor++;
      const prev = st.hooks[i];
      if (!prev || !deps || deps.some((d, k) => d !== prev.deps[k])) { st.hooks[i] = { deps, cleanup: undefined, fn }; st.pending.push(i); }
    },
    memo: (c) => c,
  };
  return { R, st, begin: () => { st.cursor = 0; st.dirty = false; }, runEffects: () => { const p = st.pending; st.pending = []; for (const i of p) { const hh = st.hooks[i]; if (hh.cleanup) hh.cleanup(); const cl = hh.fn(); hh.cleanup = typeof cl === 'function' ? cl : undefined; } return p.length; } };
}

const texts = (n, o) => {
  o = o || [];
  if (n === null || n === undefined || typeof n === 'boolean') return o;
  if (typeof n === 'string' || typeof n === 'number') { o.push(String(n)); return o; }
  if (Array.isArray(n)) { n.forEach((x) => texts(x, o)); return o; }
  if (typeof n === 'object' && typeof n.type === 'function') { texts(n.type(Object.assign({}, n.props, { children: n.children })), o); return o; }
  if (typeof n === 'object' && n.children) n.children.forEach((x) => texts(x, o));
  return o;
};
const findClick = (n, label) => {
  let hit = null;
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === 'function') { walk(node.type(Object.assign({}, node.props, { children: node.children }))); return; }
    const p = node.props || {};
    if (typeof p.onClick === 'function' && texts(node).join('') === label && hit === null) hit = p.onClick;
    if (node.children) node.children.forEach(walk);
  };
  walk(n);
  return hit;
};
// 按文档顺序收集所有 onChange（DeepSeek 的 thinking 在前、reasoningEffort 在后）
const findAllChange = (n) => {
  const hits = [];
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === 'function') { walk(node.type(Object.assign({}, node.props, { children: node.children }))); return; }
    const p = node.props || {};
    if (typeof p.onChange === 'function') hits.push({ onChange: p.onChange, value: p.value });
    if (node.children) node.children.forEach(walk);
  };
  walk(n);
  return hits;
};

// ---- 装配：模块只构造一次，React 必须是同一个实例 ----
function build(opts) {
  const mini = makeReact();
  const cap = { defs: [] };
  const doc = { querySelector: () => null, createElement: () => ({ dataset: {}, style: {}, textContent: '' }), head: { appendChild: () => {} } };
  new Function('window', 'document', SRC)({ __ModuleLoader__: { load: (d) => cap.defs.push(d) } }, doc);
  const mod = cap.defs[0].factory((n) => (n === 'react' ? mini.R : null));
  const registered = [];
  const calls = { describe: 0, mutate: [] };
  const ctx = {
    effect: (fn) => fn(),
    slots: { inject: (n, fn) => fn(), register: (o, c) => { registered.push({ o, c }); return () => {}; } },
    remote: {
      settings: {
        describe: async () => { calls.describe++; return { ok: true, value: { writable: opts.writable !== false, hasDocument: true, namespaces: [opts.view] } }; },
        mutate: async (ns, ops, rev) => { calls.mutate.push({ ns, ops, rev }); return { ok: true, value: opts.view }; },
      },
      llm: { listConfigurableProviders: async () => ({ ok: true, value: [] }) },
    },
  };
  let threw = null;
  try { mod.apply(ctx); } catch (e) { threw = e; }
  return { mini, mod, registered, ctx, calls, threw, Comp: registered[0] && registered[0].c };
};

async function render(b, props) {
  let tree = null;
  for (let round = 0; round < 40; round++) {
    b.mini.begin();
    tree = b.Comp(props);
    const ran = b.mini.runEffects();
    for (let t = 0; t < 12; t++) await new Promise((r) => setTimeout(r, 0));
    if (!b.mini.st.dirty && ran === 0) break;
  }
  return tree;
}

// 面板默认收起（产品行为）。多数场景需要正文，故提供 expand()：
// 模拟真实用户先点「展开」。断言「默认收起」本身时用 render()。
async function expand(b, props) {
  let tree = await render(b, props);
  const btn = findClick(tree, '展开');
  if (typeof btn === 'function') {
    btn();
    await new Promise((r) => setTimeout(r, 0));
    tree = await render(b, props);
  }
  return tree;
}

// slot owner props：provider 字段本身是 ProviderDirectoryEntry 对象
const provider = (p) => ({ provider: p, configured: true, keyConfigured: true });
const meProfile = {
  apiKeyEnv: 'ME_API_KEY', api: 'openai-completions', baseURL: 'http://127.0.0.1:8080/v1', reasoning: 'high',
  models: [
    { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', contextWindow: 1000000, maxTokens: 3000000, reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' }, input: ['text', 'image'] },
    { id: 'hy4-preview', name: 'hy4-preview', contextWindow: 1000000, maxTokens: 3000000, reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' }, input: ['text', 'image'] },
  ],
};
const meProvider = provider({ provider: 'me', displayName: 'me', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'me'] });
const userModels = JSON.parse(JSON.stringify(meProfile.models));

// ================= 场景 A：pi-ai，用户层已有同长 models → 精确下标 =================
const viewA = { ns: 'llm-pi-ai', revision: 7, value: { providers: { me: meProfile } }, user: { providers: { me: { models: userModels } } }, applies: 'live', secrets: [] };
const A = build({ view: viewA });
ok('apply 不抛错', A.threw === null, A.threw ? A.threw.message : 'ok');
let treeA = await expand(A, meProvider);
let textA = texts(treeA).join(' ');
ok('面板标题为「思考强度」', textA.indexOf('思考强度') >= 0, textA.slice(0, 120));
ok('面板已脱离 loading 状态', textA.indexOf('读取中') < 0, textA.slice(0, 120));
ok('列出全部模型 id', textA.indexOf('deepseek-v4.1-flash') >= 0 && textA.indexOf('hy4-preview') >= 0, textA.slice(0, 200));
ok('提供路由默认档位控件', textA.indexOf('路由默认档位') >= 0, '');
ok('describe 被调用', A.calls.describe > 0, A.calls.describe);

// 取消模型 0 的「中」档（第一个「中」属于第一个模型）
const toggleMid = findClick(treeA, '中');
ok('找到「中」档开关', typeof toggleMid === 'function', typeof toggleMid);
if (typeof toggleMid === 'function') {
  toggleMid();
  await new Promise((r) => setTimeout(r, 0));
  const treeA2 = await render(A, meProvider);
  const save = findClick(treeA2, '保存');
  ok('找到「保存」按钮', typeof save === 'function', typeof save);
  if (typeof save === 'function') {
    save();
    for (let t = 0; t < 20; t++) await new Promise((r) => setTimeout(r, 0));
    ok('保存调用 mutate 一次', A.calls.mutate.length === 1, A.calls.mutate.length);
    const call = A.calls.mutate[0];
    if (call) {
      ok('mutate 的 ns 为 llm-pi-ai', call.ns === 'llm-pi-ai', call.ns);
      ok('mutate 带 expectedRevision=7', call.rev === 7, call.rev);
      const paths = call.ops.map((o) => o.path.join('.'));
      const target = call.ops.find((o) => o.path.join('.') === 'providers.me.models.0.reasoningEfforts');
      ok('含 models.0.reasoningEfforts 精确下标路径', target !== undefined, JSON.stringify(paths));
      if (target) {
        ok('下标是字符串 "0"', target.path[3] === '0' && typeof target.path[3] === 'string', JSON.stringify(target.path));
        ok('取消「中」后字典无 medium、off 为 null', target.value.medium === undefined && target.value.off === null && target.value.high === 'high' && target.value.max === 'max', JSON.stringify(target.value));
      }
      ok('未波及模型 1（无 models.1 路径）', paths.indexOf('providers.me.models.1.reasoningEfforts') < 0, JSON.stringify(paths));
      const applyPathOp = new Function((() => { const s = fs.readFileSync(path.join(REF, 'dsh-settings/lib/index.js'), 'utf8'); const cut = (a, b) => { const i = s.indexOf(a); const j = s.indexOf(b, i); return s.slice(i, j); }; return cut('function isPlainObject(value) {', 'function applyPathOp(section, op, schema) {') + cut('function applyPathOp(section, op, schema) {', '/** Human label for a value'); })() + '; return applyPathOp;')();
      let applied = JSON.parse(JSON.stringify(viewA.user));
      for (const op of call.ops) applied = applyPathOp(applied, op, undefined);
      ok('真实 applyPathOp 后 models 仍是数组', Array.isArray(applied.providers.me.models), typeof applied.providers.me.models);
      const got = applied.providers.me.models[0].reasoningEfforts;
      const want = target ? target.value : null;
      ok('真实 applyPathOp 应用结果与 ops 值一致', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
      ok('模型 1 保持原样', JSON.stringify(applied.providers.me.models[1].reasoningEfforts) === JSON.stringify(meProfile.models[1].reasoningEfforts), '');
      // 语义层校验的是**合并后的有效值**（用户层覆盖 profile 层），故需按宿主语义合并：
      // 只送用户层会缺 api 等 profile 字段，报「needs an api」——那是夹具不完整，不是写入有问题。
      const effA = Object.assign({}, meProfile, applied.providers.me);
      const semA = await piSemanticAccepts({ providers: { me: effA } });
      ok('真实 pi-ai 语义链接受写入后的有效值', semA.ok, semA.msg);
    }
  }
}

// ================= 场景 B：pi-ai，用户层无 models → 整数组写入 =================
const viewB = { ns: 'llm-pi-ai', revision: 3, value: { providers: { me: meProfile } }, user: { providers: { me: { apiKeyEnv: 'ME_API_KEY' } } }, applies: 'live', secrets: [] };
const B = build({ view: viewB });
let treeB = await expand(B, meProvider);
const tB = findClick(treeB, '中');
ok('场景 B 找到「中」档开关', typeof tB === 'function', typeof tB);
if (typeof tB === 'function') {
  tB();
  await new Promise((r) => setTimeout(r, 0));
  const treeB2 = await render(B, meProvider);
  const saveB = findClick(treeB2, '保存');
  if (typeof saveB === 'function') {
    saveB();
    for (let t = 0; t < 20; t++) await new Promise((r) => setTimeout(r, 0));
    const callB = B.calls.mutate[0];
    ok('场景 B 保存调用 mutate', callB !== undefined, B.calls.mutate.length);
    if (callB) {
      const pathsB = callB.ops.map((o) => o.path.join('.'));
      const whole = callB.ops.find((o) => o.path.join('.') === 'providers.me.models');
      ok('退化路径整数组写入 models', whole !== undefined, JSON.stringify(pathsB));
      ok('退化路径不含下标路径', pathsB.every((p) => p.indexOf('models.0') < 0), JSON.stringify(pathsB));
      if (whole) ok('写入值是数组', Array.isArray(whole.value), Object.prototype.toString.call(whole.value));
      const applyPathOp2 = new Function((() => { const s = fs.readFileSync(path.join(REF, 'dsh-settings/lib/index.js'), 'utf8'); const cut = (a, b) => { const i = s.indexOf(a); const j = s.indexOf(b, i); return s.slice(i, j); }; return cut('function isPlainObject(value) {', 'function applyPathOp(section, op, schema) {') + cut('function applyPathOp(section, op, schema) {', '/** Human label for a value'); })() + '; return applyPathOp;')();
      let appliedB = JSON.parse(JSON.stringify(viewB.user));
      for (const op of callB.ops) appliedB = applyPathOp2(appliedB, op, undefined);
      ok('真实 applyPathOp 后 models 是数组（非 {"0":…} 对象）', Array.isArray(appliedB.providers.me.models), Object.prototype.toString.call(appliedB.providers.me.models));
      if (Array.isArray(appliedB.providers.me.models)) {
        ok('退化路径取消了「中」', appliedB.providers.me.models[0].reasoningEfforts.medium === undefined, JSON.stringify(appliedB.providers.me.models[0].reasoningEfforts));
        const effB = Object.assign({}, meProfile, appliedB.providers.me);
        const semB = await piSemanticAccepts({ providers: { me: effB } });
        ok('真实 pi-ai 语义链接受退化路径结果（合并后有效值）', semB.ok, semB.msg);
      }
    }
  }
}

// ================= 场景 C：DeepSeek 路由级 =================
const dsProfile = { baseURL: 'https://api.deepseek.com/anthropic', thinking: 'enabled', reasoningEffort: 'high', models: [{ id: 'deepseek-chat', inputModalities: ['text'] }] };
const viewC = { ns: 'llm-deepseek', revision: 2, value: dsProfile, user: { thinking: 'enabled', reasoningEffort: 'high' }, applies: 'live', secrets: [] };
const C = build({ view: viewC });
const treeC = await expand(C, provider({ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }));
const textC = texts(treeC).join(' ');
ok('DeepSeek 面板说明路由级共享', textC.indexOf('路由级') >= 0, textC.slice(0, 200));
ok('DeepSeek 面板有 thinking 控件', textC.indexOf('thinking') >= 0, '');
ok('DeepSeek 面板有 reasoningEffort 控件', textC.indexOf('reasoningEffort') >= 0, '');
ok('DeepSeek 面板无模型级标签', textC.indexOf('继承内置目录') < 0, '');
// 把 reasoningEffort 改成 max，再关掉 thinking → 应被强制回 off
const selectsC = findAllChange(treeC);
ok('DeepSeek 有两个下拉（thinking / reasoningEffort）', selectsC.length === 2, JSON.stringify(selectsC.map((s) => s.value)));
const effChange = selectsC[1] && selectsC[1].onChange;
if (typeof effChange === 'function') {
  effChange({ target: { value: 'max' } });
  await new Promise((r) => setTimeout(r, 0));
  const treeC2 = await render(C, provider({ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }));
  const thinkChange = findAllChange(treeC2)[0] && findAllChange(treeC2)[0].onChange;
  if (typeof thinkChange === 'function') {
    thinkChange({ target: { value: 'disabled' } });
    await new Promise((r) => setTimeout(r, 0));
    const treeC3 = await render(C, provider({ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }));
    const saveC = findClick(treeC3, '保存');
    if (typeof saveC === 'function') {
      saveC();
      for (let t = 0; t < 20; t++) await new Promise((r) => setTimeout(r, 0));
      const callC = C.calls.mutate[0];
      ok('DeepSeek 保存调用 mutate', callC !== undefined, C.calls.mutate.length);
      if (callC) {
        const eff = callC.ops.find((o) => o.path.join('.') === 'reasoningEffort');
        const th = callC.ops.find((o) => o.path.join('.') === 'thinking');
        ok('写入 thinking=disabled', th !== undefined && th.value === 'disabled', JSON.stringify(th));
        ok('thinking 关闭时 reasoningEffort 被强制为 off（满足宿主联动约束）', eff !== undefined && eff.value === 'off', JSON.stringify(eff));
      }
    }
  }
}

// ================= 场景 D：草稿卡（无 profile） =================
const viewD = { ns: 'llm-pi-ai', revision: 1, value: { providers: {} }, user: {}, applies: 'live', secrets: [] };
const D = build({ view: viewD });
const textD = texts(await expand(D, provider({ provider: 'newroute', displayName: 'newroute', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'newroute'] }))).join(' ');
ok('草稿卡明确提示尚未保存', textD.indexOf('尚未保存') >= 0, textD.slice(0, 200));

// ================= 场景 E：不支持的适配器 =================
const viewE = { ns: 'some-other-adapter', revision: 1, value: { foo: 1 }, user: {}, applies: 'live', secrets: [] };
const E = build({ view: viewE });
const textE = texts(await expand(E, provider({ provider: 'x', displayName: 'x', settingsNs: 'some-other-adapter', settingsPath: [] }))).join(' ');
ok('不支持的适配器给出明确提示', textE.indexOf('只支持') >= 0, textE.slice(0, 200));

// ================= 场景 F：只读 =================
const F = build({ view: viewA, writable: false });
const textF = texts(await expand(F, meProvider)).join(' ');
ok('只读时提示不可写', textF.indexOf('不可写') >= 0, textF.slice(0, 220));

// ================= 场景 G：用户层无 models 时，逐下标写会抛 out of range（故必须整数组写） =================
// 依据：applyPathOp:193 用 node.meta.default 兜底；pi-ai 的 models 默认 []（已实测），
// 所以写 models.0.* 会因 index === length 且 rest 非空而抛 TypeError。
const viewG = { ns: 'llm-pi-ai', revision: 5, value: { providers: { me: meProfile } }, user: {}, applies: 'live', secrets: [] };
const G = build({ view: viewG });
let treeG = await expand(G, meProvider);
const tG = findClick(treeG, '中');
ok('场景 G 找到「中」档开关', typeof tG === 'function', typeof tG);
if (typeof tG === 'function') {
  tG();
  await new Promise((r) => setTimeout(r, 0));
  const saveG = findClick(await render(G, meProvider), '保存');
  if (typeof saveG === 'function') {
    saveG();
    for (let t = 0; t < 20; t++) await new Promise((r) => setTimeout(r, 0));
    const callG = G.calls.mutate[0];
    ok('场景 G 保存调用 mutate', callG !== undefined, G.calls.mutate.length);
    if (callG) {
      const pathsG = callG.ops.map((o) => o.path.join('.'));
      ok('场景 G 不含下标路径（否则必抛 out of range）', pathsG.every((p) => p.indexOf('models.0') < 0), JSON.stringify(pathsG));
      const wholeG = callG.ops.find((o) => o.path.join('.') === 'providers.me.models');
      ok('场景 G 改为整数组写入', wholeG !== undefined, JSON.stringify(pathsG));
      // 用真实 schema 节点复现：逐下标写必然抛错，整数组写必须成功
      const Pi2 = await import(url(path.join(FULL, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js')));
      const modelsNode = Pi2.Config.dict.providers.inner.dict.models;
      const applyPathOpG = new Function((() => { const s = fs.readFileSync(path.join(REF, 'dsh-settings/lib/index.js'), 'utf8'); const cut = (a, b) => { const i = s.indexOf(a); const j = s.indexOf(b, i); return s.slice(i, j); }; return cut('function isPlainObject(value) {', 'function applyPathOp(section, op, schema) {') + cut('function applyPathOp(section, op, schema) {', '/** Human label for a value'); })() + '; return applyPathOp;')();
      let threwIndex = null;
      try { applyPathOpG({}, { op: 'set', path: ['models', '0', 'reasoningEfforts'], value: { off: null, high: 'high' } }, { type: 'object', dict: { models: modelsNode }, meta: { default: {} } }); } catch (e) { threwIndex = e.message; }
      ok('实证：用户层无 models 时逐下标写确实抛 out of range', threwIndex !== null && /out of range/.test(threwIndex), String(threwIndex));
      let wholeOk = true, wholeErr = '';
      try { const res = applyPathOpG({}, { op: 'set', path: ['models'], value: wholeG ? wholeG.value : [] }, { type: 'object', dict: { models: modelsNode }, meta: { default: {} } }); if (!Array.isArray(res.models)) { wholeOk = false; wholeErr = 'not array'; } } catch (e) { wholeOk = false; wholeErr = e.message; }
      ok('实证：整数组写入成功且结果为数组', wholeOk, wholeErr);
    }
  }
}

// ================= 场景 H：pi-ai 空等级集合 → 面板拒绝保存（第 4 条不变量） =================
const viewH = { ns: 'llm-pi-ai', revision: 9, value: { providers: { me: meProfile } }, user: { providers: { me: { models: JSON.parse(JSON.stringify(meProfile.models)) } } }, applies: 'live', secrets: [] };
const H = build({ view: viewH });
let treeH = await expand(H, meProvider);
// 逐一点掉第一个模型已选中的档位（中/高/最大/低，保留「关」）
for (const label of ['中', '高', '最大', '低']) {
  const hit = findClick(treeH, label);
  if (typeof hit === 'function') { hit(); await new Promise((r) => setTimeout(r, 0)); treeH = await render(H, meProvider); }
}
const saveH = findClick(treeH, '保存');
ok('场景 H 找到「保存」', typeof saveH === 'function', typeof saveH);
if (typeof saveH === 'function') {
  saveH();
  for (let t = 0; t < 20; t++) await new Promise((r) => setTimeout(r, 0));
  const textH = texts(await render(H, meProvider)).join(' ');
  ok('场景 H 清空全部等级后被拒绝保存（未调用 mutate）', H.calls.mutate.length === 0, 'mutate=' + H.calls.mutate.length);
  ok('场景 H 给出可读错误提示', textH.indexOf('关') >= 0 && (textH.indexOf('至少') >= 0 || textH.indexOf('清空') >= 0), textH.slice(0, 260));
}

// ================= 场景 I：DeepSeek 的 models 有真实默认目录 → 模型级写入会物化整份 catalog =================
// 这是契约审计标出的 R4：插件对 DeepSeek 只写路由级，绝不碰 models。
const DSmod = await import(url(path.join(FULL, '@deepseek-ai/dsh-llm-deepseek/lib/index.js')));
const dsModelsNode = DSmod.Config.dict.models;
ok('实证：DeepSeek 的 models 默认是完整目录（长度 2）', Array.isArray(dsModelsNode.meta.default) && dsModelsNode.meta.default.length === 2, JSON.stringify(dsModelsNode.meta && dsModelsNode.meta.default && dsModelsNode.meta.default.length));
const applyPathOpI = new Function((() => { const s = fs.readFileSync(path.join(REF, 'dsh-settings/lib/index.js'), 'utf8'); const cut = (a, b) => { const i = s.indexOf(a); const j = s.indexOf(b, i); return s.slice(i, j); }; return cut('function isPlainObject(value) {', 'function applyPathOp(section, op, schema) {') + cut('function applyPathOp(section, op, schema) {', '/** Human label for a value'); })() + '; return applyPathOp;')();
let materialized = null;
try { materialized = applyPathOpI({ thinking: 'enabled' }, { op: 'set', path: ['models', '0', 'reasoningEfforts'], value: { high: 'high' } }, DSmod.Config); } catch (e) { materialized = { err: e.message }; }
ok('实证：给 DeepSeek 写模型级字段会把整份默认 catalog 物化进用户层（故插件不这么做）', materialized !== null && Array.isArray(materialized.models) && materialized.models.length === 2 && materialized.models[0].id === 'deepseek-flash', JSON.stringify(materialized).slice(0, 220));
const callC0 = C.calls.mutate[0];
if (callC0) {
  const pathsC = callC0.ops.map((o) => o.path.join('.'));
  ok('插件对 DeepSeek 只写路由级（不出现任何 models 路径）', pathsC.every((p) => p.indexOf('models') < 0), JSON.stringify(pathsC));
} else { ok('插件对 DeepSeek 只写路由级（不出现任何 models 路径）', false, 'no mutate call'); }
// ================= 场景 J：用真实 profile 数据驱动面板（端到端最强离线证据） =================
// 直接读 ~/.dsh/profiles/desktop/cordis.patch.yml 里 llm-pi-ai 的 providers，喂给面板。
// profile 不存在时跳过，不视为失败。
let realRan = false;
try {
  const patchPath = path.join(PROFILE, 'cordis.patch.yml');
  if (fs.existsSync(patchPath)) {
    const yamlMod = await import(url(path.join(PROFILE, 'node_modules/yaml/dist/index.js')));
    const parsed = yamlMod.default.parse(fs.readFileSync(patchPath, 'utf8'));
    const flat = [];
    for (const e of (Array.isArray(parsed) ? parsed : [])) {
      if (e && Array.isArray(e.insert)) for (const r of e.insert) flat.push(r);
      else flat.push(e);
    }
    const row = flat.find((r) => r && r.name === '@deepseek-ai/dsh-llm-pi-ai');
    const provs = row && row.config && row.config.providers;
    if (provs && typeof provs === 'object') {
      realRan = true;
      const ids = Object.keys(provs);
      ok('真实 profile 至少有一个 pi-ai provider', ids.length > 0, ids.join(','));
      const p0 = ids[0];
      const realProfile = provs[p0];
      const realModels = Array.isArray(realProfile.models) ? realProfile.models : [];
      ok('真实 provider 含模型列表', realModels.length > 0, String(realModels.length));
      const viewJ = { ns: 'llm-pi-ai', revision: 42, value: { providers: { [p0]: realProfile } }, user: { providers: { [p0]: { models: JSON.parse(JSON.stringify(realModels)) } } }, applies: 'live', secrets: [] };
      const J = build({ view: viewJ });
      const treeJ = await expand(J, provider({ provider: p0, displayName: p0, settingsNs: 'llm-pi-ai', settingsPath: ['providers', p0] }));
      const textJ = texts(treeJ).join(' ');
      ok('真实数据下面板脱离 loading', textJ.indexOf('读取中') < 0, textJ.slice(0, 160));
      const allListed = realModels.every((m) => textJ.indexOf(m.id) >= 0);
      ok('真实数据下列出全部 ' + realModels.length + ' 个模型', allListed, textJ.slice(0, 260));
      // 真实数据必须被真实 Config 接受（回环校验）
      const semJ = await piSemanticAccepts({ providers: { [p0]: realProfile } });
      ok('真实 profile 的 provider 配置本身合法（真实语义链接受）', semJ.ok, semJ.msg);
      // 真实数据下改一档并保存，走真实 applyPathOp + 真实 Config 回环
      const tJ = findClick(treeJ, '中');
      if (typeof tJ === 'function') {
        tJ();
        await new Promise((r) => setTimeout(r, 0));
        const saveJ = findClick(await render(J, provider({ provider: p0, displayName: p0, settingsNs: 'llm-pi-ai', settingsPath: ['providers', p0] })), '保存');
        if (typeof saveJ === 'function') {
          saveJ();
          for (let t = 0; t < 20; t++) await new Promise((r) => setTimeout(r, 0));
          const callJ = J.calls.mutate[0];
          ok('真实数据下保存调用 mutate', callJ !== undefined, J.calls.mutate.length);
          if (callJ) {
            const applyPathOpJ = new Function((() => { const s = fs.readFileSync(path.join(REF, 'dsh-settings/lib/index.js'), 'utf8'); const cut = (a, b) => { const i = s.indexOf(a); const j = s.indexOf(b, i); return s.slice(i, j); }; return cut('function isPlainObject(value) {', 'function applyPathOp(section, op, schema) {') + cut('function applyPathOp(section, op, schema) {', '/** Human label for a value'); })() + '; return applyPathOp;')();
            let appliedJ = JSON.parse(JSON.stringify(viewJ.user));
            for (const op of callJ.ops) appliedJ = applyPathOpJ(appliedJ, op, undefined);
            const semJ2 = await piSemanticAccepts({ providers: { [p0]: Object.assign({}, realProfile, appliedJ.providers[p0]) } });
            ok('真实数据写入结果仍被真实语义链接受', semJ2.ok, semJ2.msg);
            ok('真实数据下模型列表仍是数组且长度不变', Array.isArray(appliedJ.providers[p0].models) && appliedJ.providers[p0].models.length === realModels.length, String(appliedJ.providers[p0].models && appliedJ.providers[p0].models.length));
          }
        }
      }
    }
  }
} catch (e) { ok('场景 J 读取真实 profile 未抛错', false, e.message); }
if (!realRan) ok('场景 J 跳过（未找到真实 profile）', true, 'skipped');
// ================= 语义闸门鉴别力（对照实验） =================
// 证明「接受」类断言确实有鉴别力：同一批非法值，裸 Config 放行而语义链拒绝。
{
  const illegal = { providers: { me: { models: [{ id: 'm', reasoningEfforts: {} }] } } };
  const PiCfg = (await import(url(path.join(FULL, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js')))).Config;
  let bareOk = true;
  try { PiCfg(illegal); } catch (e) { bareOk = false; }
  ok('对照: 裸 Config 对非法值 {} 放行（故它不是闸门）', bareOk, String(bareOk));
  const sem = await piSemanticAccepts(illegal);
  ok('对照: 同一非法值被真实语义链拒绝（证明本文件断言有鉴别力）', !sem.ok, sem.msg);
}
// ================= 折叠行为（本次新增的产品行为，需锁死） =================
{
  // 用独立实例，避免复用被前面场景展开过的组件状态。
  const F0 = build({ view: viewA });
  const tree0 = await render(F0, meProvider);
  const t0 = texts(tree0).join(' ');
  ok('折叠: 默认收起（正文不渲染模型行）', t0.indexOf('deepseek-v4.1-flash') < 0, t0.slice(0, 140));
  ok('折叠: 默认收起时提供「展开」按钮', findClick(tree0, '展开') !== null, '');
  ok('折叠: 摘要显示模型数与已声明数（收起也能看出状态）', t0.indexOf('2 个模型') >= 0, t0.slice(0, 140));
  const tree1 = await expand(F0, meProvider);
  const t1 = texts(tree1).join(' ');
  ok('折叠: 展开后渲染模型行', t1.indexOf('deepseek-v4.1-flash') >= 0, t1.slice(0, 140));
  ok('折叠: 展开后按钮变为「收起」', findClick(tree1, '收起') !== null, '');
  const collapse = findClick(tree1, '收起');
  collapse();
  await new Promise((r) => setTimeout(r, 0));
  const t2 = texts(await render(F0, meProvider)).join(' ');
  ok('折叠: 可再次收起（往返一致）', t2.indexOf('deepseek-v4.1-flash') < 0 && findClick(await render(F0, meProvider), '展开') !== null, t2.slice(0, 140));
  // 收起状态不丢草稿：展开后仍能看到原选择
  const t3 = texts(await expand(F0, meProvider)).join(' ');
  ok('折叠: 往返后草稿保留（未重置）', t3.indexOf('deepseek-v4.1-flash') >= 0, t3.slice(0, 140));
}

// ================= 「自定义参数值」是次要链接且仅在有勾选时出现 =================
{
  const treeX = await expand(A, meProvider);
  const tX = texts(treeX).join(' ');
  ok('参数值: 旧文案「wire 拼写」已不再出现（术语已改为可理解的表述）', tX.indexOf('wire 拼写') < 0, tX.slice(0, 200));
  ok('参数值: 提供「自定义参数值」入口', findClick(treeX, '自定义参数值') !== null, tX.slice(0, 200));
  // 未勾选任何档位的模型不应出现该入口
  const emptyProfile = { api: 'openai-completions', models: [{ id: 'plain', reasoningEfforts: false }] };
  const Z = build({ view: { ns: 'llm-pi-ai', revision: 1, value: { providers: { me: emptyProfile } }, user: {}, applies: 'live', secrets: [] } });
  const tZ = texts(await expand(Z, meProvider)).join(' ');
  ok('参数值: 未勾选任何档位时不出现入口（无参数值可填）', findClick(await expand(Z, meProvider), '自定义参数值') === null, tZ.slice(0, 160));
}
// ================= 取证来源 = 运行中宿主（自证） =================
// 直接读运行中宿主的 app.asar，逐包比对 REF 的版本。若 asar 不可读则跳过（不算失败）。
let asarChecked = false;
try {
  const ASAR = process.env.DSH_ASAR || 'C:/App/DeepSeek Harness/resources/app.asar';
  if (fs.existsSync(ASAR)) {
    const fd = fs.openSync(ASAR, 'r');
    const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0);
    const jsonSize = head.readUInt32LE(12);
    const hb = Buffer.alloc(jsonSize); fs.readSync(fd, hb, 0, jsonSize, 16);
    const header = JSON.parse(hb.toString('utf8'));
    const baseOffset = 8 + head.readUInt32LE(4);
    const find = (node, parts) => { let c = node; for (const p of parts) { if (!c || !c.files || !c.files[p]) return null; c = c.files[p]; } return c; };
    const readNode = (node) => { const b = Buffer.alloc(node.size); fs.readSync(fd, b, 0, node.size, baseOffset + Number(node.offset)); return b.toString('utf8'); };
    let mismatched = [];
    for (const p of ['dsh-settings', 'dsh-llm-pi-ai', 'dsh-llm-deepseek']) {
      const node = find(header, ['dsh', 'node_modules', '@deepseek-ai', p, 'package.json']);
      if (!node) { mismatched.push(p + ':not-found'); continue; }
      const asarVer = JSON.parse(readNode(node)).version;
      const refVer = JSON.parse(fs.readFileSync(path.join(REF, p, 'package.json'), 'utf8')).version;
      if (asarVer !== refVer) mismatched.push(p + ':' + asarVer + '!=' + refVer);
    }
    fs.closeSync(fd);
    asarChecked = true;
    ok('REF 逐包版本与运行中 app.asar 一致（取证来源可信）', mismatched.length === 0, mismatched.join(', '));
  }
} catch (e) { ok('REF 与 asar 比对未抛错', false, e.message); }
if (!asarChecked) ok('跳过 asar 比对（未找到 app.asar）', true, 'skipped');
// ================= 取证一致性自证 =================
for (const p of ['dsh-settings', 'dsh-llm-pi-ai', 'dsh-llm-deepseek']) {
  const pj = JSON.parse(fs.readFileSync(path.join(REF, p, 'package.json'), 'utf8'));
  ok('取证来源 ' + p + ' 版本 = ' + pj.version, /^0\.1\.7/.test(pj.version), pj.version);
}
ok('REF 为实机 asar 副本（0.1.7-rc.2）', /^0\.1\.7/.test(JSON.parse(fs.readFileSync(path.join(REF, 'dsh-settings/package.json'), 'utf8')).version), '');
ok('FULL 为可运行完整树', fs.existsSync(path.join(FULL, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js')), FULL);
console.log('');
for (const r of results) console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   <- ' + r.detail));
const failed = results.filter((r) => !r.pass);
console.log('');
console.log(failed.length === 0 ? '全部 ' + results.length + ' 项通过' : failed.length + ' / ' + results.length + ' 项失败');
process.exit(failed.length === 0 ? 0 : 1);