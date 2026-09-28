# dsh-thinking-effort

> **Dsh desktop**（DeepSeek Harness）插件：在「设置 → Models」的提供商卡片里配置**思考强度**。
> 呈现方式与现有的**配置上下文**、**输入类型**一致——同一张卡片内，跟随「添加模型 / 添加提供商」流程出现。

在 **Dsh desktop** 的「设置 → Models」里，为提供商路由与每个模型声明**思考强度**——呈现方式与现有的**配置上下文**、**输入类型**一致：同一张提供商卡片内，跟随「添加模型 / 添加提供商」流程出现。

安装方式见文末「安装」一节，由你自行执行。

---

## 作者

| | |
|---|---|
| 作者 | [otae-1204](https://github.com/otae-1204) |
| 协作 | **DeepSeek Harness** —— 本插件的宿主契约取证、实现与验证均由该 agent 完成 |
| 许可 | MIT |

---

## 1. 可行性评估

**结论：可行。** 宿主开放了恰好够用的注入点，且不需要改动宿主源码。

### 1.1 现有「配置上下文 / 输入类型」是怎么做的

它们**不是**插件席位，而是内置模型设置页 `@deepseek-ai/dsh-client-ui-settings-models` 自己的字段：

| 项 | 载体 | 写入方式 |
|---|---|---|
| 上下文窗口 / 最大输出 | 模型行的 `contextWindow` / `maxTokens` 数字输入 | 整段替换 `models` 数组 |
| 输入类型 | 模型行的 `input` / `inputModalities` 多选 | 同上 |
| 思考强度 | **宿主目前只在适配器 schema 里支持，界面未暴露** | — |

内置页保存时用 `pathOps(base, before, after)`（`dsh-client-ui-settings-models/lib/client.js:1475-1491`）对每个顶层键产出 `set`/`unset`，再调 `ctx.remote.settings.mutate(ns, ops, revision)`。

### 1.2 插件能挂在哪

宿主客户端槽位目录共 85 个键，**与模型配置相关且可被外部插件使用的只有一个**：

`settings.models.provider-card`（`dsh-cordis-client-runner/lib/client.js:4553-4584`，源 `packages/client/ui-settings-models/src/client/slot-contract.ts:33`）

- `kind = keyed`、`scope = root`
- `registerOptions` 只需一个 **`key`**（string，required；占用即替换该占用者）
- `ownerProps = { provider, configured, keyConfigured }`
- `keyDomain` 声明为「任意字符串」，但**实践上必须精确等于目标 provider 的 `settingsNs`**，否则 `renderSlot` 静默渲染 fallback（默认 null），不报错
- 该席位声明在 `settings.section` 条目的 `children` 里，**只在 Models 页挂载期间存在** → 必须用 `ctx.slots.inject(...)` 注册，直接 `register` 会抛 `slot "..." is not declared`

宿主会被 dispatch 的三处（均在 `dsh-client-ui-settings-models/lib/client.js`）：

| 位置 | 行号 | 与 ProviderEditor 的相对顺序 |
|---|---|---|
| 已保存的提供商卡片 | :2213-2229 | **之前** |
| 首次运行的 setup 卡 | :2134-2155 | **之后** |
| 添加提供商的草稿卡 | :2303-2322（`addRow` 存在时） | **之后** |
| 手写 CustomProviderCard 分支 | :2325-2346 | **不 dispatch** |

→ 顺序**不是契约**，插件不得假设自己在编辑区前或后；草稿卡在 `addRow === undefined` 时完全不 dispatch。

### 1.3 写入通道

`ctx.remote.settings`（`dsh-api-settings-controller`）：

    describe()                          → { writable, hasDocument, namespaces: [{ ns, value, base?, user?, schema, applies:"live", secrets, revision }] }
    mutate(ns, ops, expectedRevision?)  → Result
    ops = [{ op:"set", path: string[], value } | { op:"unset", path: string[] }]

- `path` 是**纯字符串数组**（数字下标会被 wire codec 拒绝）
- `ctx.remote.*` 一律返回 **Result**（`{ok:true,value}` / `{ok:false,error}`），**不抛异常**
- 冲突单独归类为 `settings/conflict`，其余为 `settings/rejected`

### 1.4 两个适配器的推理能力并不对等（决定了 UI 必须分叉）

**`llm-pi-ai` —— 模型级**

`reasoningEfforts`：等级 → wire 拼写的字典，7 档 `off|minimal|low|medium|high|xhigh|max`。合法取值是**四态**：

- `undefined`（省略）= 沿用内置目录的能力
- `false` = 显式声明该模型不推理
- `{...}` = 非空字典（至少一个非 `off` 等级；非 `off` 的 wire 不得为空串或 null；`off` 可为 `null`，也可为字符串）
- 空字典 `{}` 与显式 `null` **非法**

路由级默认档位字段是 `reasoning`。

**`llm-deepseek` —— 仅路由级**

`catalogModel`（`dsh-llm-deepseek/lib/index.js:297-308`）**没有任何模型级推理字段**。只有路由级：

- `thinking: "enabled" | "disabled"`
- `reasoningEffort: "off" | "low" | "high" | "max"`（4 档，**不是** 7 档）
- 联动约束（:393）：`thinking === "disabled"` 时 `reasoningEffort` 只能是 `"off"`

→ 对 DeepSeek **写模型级推理字段不会报错，但会被适配器静默丢弃**（schema 层保留、语义层 `resolveModels` 重建时丢掉），并永久留在用户层成为噪声。

### 1.5 关键风险：逐下标写会失败 / 会物化目录

`applyPathOp`（`dsh-settings/lib/index.js:189-212`）在 `input === undefined` 时用 `node.meta.default` 兜底：

    const value = input === void 0 ? node?.meta.default : input;   // :193
    if (Array.isArray(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(head) || ...) throw new TypeError("Config array index is out of range");  // :195
    }

- 数组下标必须是**十进制字符串**（`"0"` 合法；`"01"`/`"-1"`/`"1.5"`/`"a"` 全部非法）
- pi-ai 的 `models` 默认 `[]` → 用户层没有 `models` 时写 `models.0.*` **必抛 out of range**（不会物化成 `{"0":…}` 对象——schemastery 给每个 array 自动填 `meta.default = []`）
- DeepSeek 的 `models` 显式声明 `default(DEFAULT_MODELS)`（2 条 catalog）→ 对它写 `models.0.*` 会把**整份默认目录物化进用户层**，从此该路由不再跟随适配器升级

→ 插件据此采用两条策略：pi-ai **用户层已有同长数组时才用下标，否则整数组写**；DeepSeek **只写路由级，绝不碰 `models`**。

### 1.6 限制（诚实列出）

1. **无法做到与「上下文 / 输入类型」同层级的模型行内联编辑**。宿主没有模型行级槽位，插件只能整张卡片注入一个面板，不能往每行塞控件。
2. **手写 CustomProviderCard 分支拿不到**（宿主未 dispatch 该席位）。
3. **顺序不保证**：面板相对编辑区的位置由宿主自由决定，且三处不一致。
4. **DeepSeek 只能是路由级**，与 pi-ai 的模型级语义不同；统一 UI 必须按适配器分叉，并分别给出 7 档 / 4 档。
5. **纯客户端包也必须挂成 loader 行**：`dsh-client-modules` 的 `resolveMeta(loaderName, baseUrl)` 以 Host Loader 的行名为输入（`dsh-client-modules/lib/index.js:677-707`），包只有作为 loader 行挂载，其 `dsh.client` 才会进入 `__DSH_BOOT__` 图。且插件管理器 `inspectionOf` 硬性要求 `package.json` 声明 `dsh.bundle`，否则 GUI 安装直接 refused（not-a-bundle）。
6. **「自定义参数值」是高级项**：档位名（`low`/`high`…）默认就是发给接口的参数值，即 `thinkingLevelMap`（`dsh-llm-pi-ai/lib/index.js:576-585`）。只有接口不认这套命名时才需要逐个改写，故入口做成次要文字链接，且**仅在勾选了档位后出现**（没勾选就没有参数值可填）。
7. **客户端校验拦不住全部非法值**：`null` / 空串在 **schema 层通过**，只有适配器语义层（`resolveProfiles` → `resolveModelReasoning`）才拒。插件因此在 UI 侧自行实现不变量，而非依赖 schema 报错。

---

## 2. 方案设计

### 2.1 形态

在提供商卡片内注入一个「思考强度」面板。**默认收起**：只显示「思考强度 + 摘要（模型数/已声明数、或 DeepSeek 的档位）+ 展开 + 刷新」，点「展开」才显示正文——避免整块面板把设置页撑得很长。摘要让收起状态也能一眼看出关键信息。

展开后按 `settingsNs` 分派两种布局：

- **`llm-pi-ai`**：逐模型一行，7 个档位开关 + 每档的 wire 拼写输入；底部一个「路由默认档位」下拉（`reasoning`）。三态标注：**继承内置目录** / **非推理模型**（`false`）/ **已声明**。
- **`llm-deepseek`**：明确提示「路由级共享」，两个下拉（`thinking`、`reasoningEffort`，4 档）；`thinking` 关闭时自动把 effort 压回 `off`。
- 其他适配器：明确提示不支持，不渲染任何控件。
- 只读 profile：提示不可写并禁用保存。

### 2.2 写入策略（最小改动）

| 场景 | ops |
|---|---|
| pi-ai，用户层已有同长 `models` | 逐模型 set/unset `[...settingsPath,"models",String(i),"reasoningEfforts"]` |
| pi-ai，用户层无 `models` | 退化：整数组 set `[...settingsPath,"models"]` |
| pi-ai，`modelOverrides` 键 | set/unset `[...settingsPath,"modelOverrides",id,"reasoningEfforts"]` |
| pi-ai，路由默认 | set/unset `[...settingsPath,"reasoning"]` |
| DeepSeek | set/unset `[...settingsPath,"thinking"]` 与 `[...,"reasoningEffort"]` |
| 清空某模型声明 | unset 该路径（回落继承） |

保存调 `mutate(ns, ops, view.revision)`，成功后重新 `describe()`。

---

## 3. 开发实现

包位置：本目录。产物为**手写 `__ModuleLoader__` bundle**，无构建步骤（`scripts/build.sh` 只做一致性断言）。

    package.json          清单：dsh.bundle.patch + dsh.client{platform:"web"}
    cordis.patch.yml      bundle 层：插入 loader 行 id=thinking-effort
    lib/index.js          host 半边桩（导出 name + 空 apply）
    lib/client.js         全部逻辑：exports.apply / exports.inject + ThinkingEffortPanel
    scripts/build.sh      4 步断言
    tests/                4 个 spec + run-all.mjs

关键实现点：

- `inject = ["slots", "remote", "remote.settings", "remote.llm"]`
- 静态注册 `llm-pi-ai` / `llm-deepseek` / `llm-deepseek-api-key` / `llm-deepseek-account` 四个键；再按 `ctx.remote.llm.listConfigurableProviders()` 为其他 `settingsNs` 补键
- 注册一律走 `ctx.slots.inject(SLOT, () => ctx.slots.register({ name, key }, Panel))`，并在 `ctx.effect` 内返回 disposer
- 面板读取链：`describe()` → 按 `ns` 找命名空间视图 → `getPath(view.value, provider.settingsPath)` 得 profile → 取 `models`（空则退回 `modelOverrides` 键）
- 档位字典构造时即校验「至少一个非 `off` 等级、非 `off` 的 wire 非空」，非法即拒绝保存并给出可读提示

---

## 4. 验证结果

`node tests/run-all.mjs` → **4 个脚本，4 通过，0 失败；共 193 项断言全部通过。**

| spec | 断言 | 覆盖 |
|---|---|---|
| `independent.spec.mjs` | 87 | **独立验证**（由 verify-harness 编写，不复用 Lead 断言） |
| `loadpath.spec.mjs` | 11 | 真实 `ClientModuleRegistry.resolveMeta` 接受本包清单 |
| `packaging.spec.mjs` | 19 | 清单声明、bundle 层补丁、与 profile 用户层补丁的合成冲突 |
| `panel.spec.mjs` | 76 | 面板端到端行为（含「裸 `Config` 无鉴别力」对照实验、折叠行为、参数值入口） |

### 4.1 取证来源（可复现的关键前提）

宿主契约**随版本变化**，因此所有断言都锚定到运行中宿主：

| 来源 | 版本 | 用途 |
|---|---|---|
| 运行中 `app.asar`（`C:\App\DeepSeek Harness\resources\app.asar`） | **0.1.7-rc.2** | 权威版本基准 |
| `_effref`（从该 asar 提取） | 0.1.7-rc.2 | `applyPathOp` 源码切取；已逐包与 asar 比对一致 |
| `_staging/dsh-full`（完整依赖树） | 0.1.7-rc.1 | 适配器模块 `import`（`_effref` 是裸副本，缺依赖链无法加载） |

已核实：`_effref` 与 asar 逐包版本**完全一致**；`_effref` 与 `dsh-full` 的 `dsh-client-modules` **内容逐字节相同**（仅版本号标注不同）。`panel.spec.mjs` 内含 asar 比对断言，副本漂移会立刻暴露。

> 早期一版 `loadpath.spec.mjs` 误取了 `_staging/kernel-full`（**0.1.6-alpha.2**，旧版），该问题由独立验证指出并已修正——这正是需要独立验证的原因。

### 4.2 验证使用真实宿主实现（非替身）

- **真实 `SlotRegistry` / `SlotCore`**（`dsh-client-ui-renderer` / `dsh-client-ui-slots`，cordis 服务）：以**真实 cordis 插件身份**挂载本插件，复现 `root → settings.section → settings.models.provider-card` 声明序列，按 `entryKey` 选中、同 key 冲突被拒、`dispose()` 后条目全部回收（无泄漏）
- **真实 `applyPathOp`**（`dsh-settings` 源码切取）应用面板产出的 ops
- **真实远端编解码器**（`settings/mutate` 的 zod schema）校验 ops 过线
- **真实语义闸门**（`pi.apply` 捕获的 `internal/config` 钩子 → `resolveRouteModels` → `resolveModelReasoning`）校验写入结果与全部不变量。
  ⚠️ **裸 `Config(...)` 不是闸门**：独立验证实测它对 `{}` / `{off:null}` / `{off:null,high:null}` / `{off:null,high:""}` **一律放行**。
  故本仓库凡「接受」类断言都走真实语义链，并附**对照实验**（同一非法值：裸 `Config` 放行、语义链拒绝）证明断言确有鉴别力。
- **真实 `resolveModel`** 证明「面板声明的等级确实生效」：写入前该模型只公布 `off`，写入 `{off,low,high}` 后公布 `off/low/high`，路由默认档位被采纳为 `defaultEffort`
- **真实 profile 数据**（`~/.dsh/profiles/desktop/cordis.patch.yml` 里 `llm-pi-ai.providers.me` 的 3 个模型）驱动面板，写入结果回环通过真实校验

### 4.3 开发中发现并修复的真实缺陷

独立验证定位到一个 Lead 实现里的真实缺陷，**已修复并有回归断言锁死**：

- **缺陷**：`opsForPiAi` 在判断「空选集合」**之前**就调用 `dictFromSel`。于是「清空某模型的全部等级」被误判成「至少声明一个非 off 等级」的错误，导致 `unset` 分支**永不可达**，与面板自身文案「不勾选任何等级即回到内置目录声明的能力」矛盾。
- **修复**：先判空集合 → `value = undefined`（走 `unset` 回落继承）；非空才交给 `dictFromSel` 校验。
- **证据（行为级，主证据）**：清空后产出 `{"op":"unset","path":["providers","me","models","0","reasoningEfforts"]}`，真实 `applyPathOp` 后该键消失，真实语义链接受；反证——写成空字典 `{}` 会被真实语义链**拒绝**，故 `unset` 是唯一正确形态。
  上述三条均为**行为级**断言（独立验证作者编写，位于 `independent.spec.mjs` A2 场景）。Lead 另加了一条**源码行序**回归断言（`空集合判断 < dictFromSel 调用`）作为廉价哨兵——它比行为级弱，仅防顺序被改回，**不作为主证据**。

### 4.4 反例（证明测试确有鉴别力）

- 用户层无 `models` 时逐下标写 → 真实 `applyPathOp` **抛 out of range**；整数组写 → 成功且结果是数组
- 下标用数字而非十进制字符串 → **真实 `settings/mutate` 线协议拒收**（`path` 必须是 `string[]`）。
  注意：`applyPathOp` **自己并不拒数字**（隐式转字符串），硬约束来自 wire 编解码器——这是本项最容易误判的一处
- 给 DeepSeek 写模型级字段 → 真实 `applyPathOp` 把**整份 2 条默认 catalog 物化进用户层**（故插件不这么做）
- 空字典 `{}` / 仅 `off` / 非 `off` 为 `null` / 非 `off` 为空串 / 未知等级键 → 真实语义层**全部拒绝**
- DeepSeek 的跨字段约束**也不在 `Config` 里**：`Config({thinking:'disabled', reasoningEffort:'high'})` 接受，拒绝它的是 `resolveAdapterOptions`（已用真实函数补正反例）
- `platform` 非 `web`、缺 `./client` 导出 → 真实 `resolveMeta` 拒绝 / 抛错

### 4.5 未覆盖（诚实声明）

**浏览器内实机渲染与真实点击**未执行：需把包装进 profile 并重启宿主。按你的要求未安装。
上述所有断言均在 Node 内驱动**真实宿主模块**，面板组件由迷你 React 驱动（`useState`/`useEffect`），非浏览器 DOM。

另有两项契约细节无法从 asar 确认（已由独立验证复核）：`ProviderDirectoryEntry` 的 TS interface 原文（asar 内仅 `ownerProps` 字符串一处提及）、`register` 的 `inject` 可用字段全集。

## 5. 安装（由你执行）

**方式 A：手工（可控、可逆）**

1. 编辑 `~/.dsh/profiles/desktop/package.json`：
   - `dsh.profile.bundles` 追加 `"@dsh-external/dsh-thinking-effort"`
   - `dependencies` 追加 `"@dsh-external/dsh-thinking-effort": "link:C:/Code/DSH_Desktop/dsh-thinking-effort"`
2. 在 profile 目录安装：

       pnpm install   # 或：node <你的 dsh 运行时>/dependencies/pnpm/bin/pnpm.mjs install

3. **重启 Dsh desktop**。新包进入既有集合属于 restart-required，热加载不生效。

**方式 B：GUI 插件管理器**：包已声明 `dsh.bundle.patch`，满足 GUI 安装的硬性检查。

**卸载**：从 `bundles` 与 `dependencies` 移除这两行，`pnpm install`，重启。

**⚠️ 互斥规则**：`cordis.patch.yml` 的 loader 行 id 是 `thinking-effort`。走 bundle 层（列入 `bundles`）就**不要**在用户层 `cordis.patch.yml` 再手工 insert 同 id 的行——两条同 id 会让新版 loader 抛 duplicate loader entry id，整个 profile 装载失败。

---

## 6. 测试复现

    node tests/run-all.mjs

路径可用环境变量覆盖（默认指向本机开发期副本）：

| 变量 | 含义 |
|---|---|
| `DSH_REF_DIR` | 从运行中 app.asar 提取的参考实现（默认 `../_effref`，0.1.7-rc.2）——用于 `applyPathOp` 源码切取 |
| `DSH_FULL_NM` | 可运行的完整依赖树（默认 `../_staging/dsh-full/dsh/node_modules`，0.1.7-rc.1）——用于 `import` 适配器模块 |
| `DSH_KERNEL_NM` | 含 `@deepseek-ai/*` 的 `node_modules`（默认自动挑选 `dsh-full`，缺失时回退 `kernel-full`） |
| `DSH_ASAR` | 运行中宿主的 asar 路径（默认 `C:/App/DeepSeek Harness/resources/app.asar`）——用于版本一致性自证 |
| `DSH_TE_PROFILE_DIR` | 被检查的 profile（默认 `~/.dsh/profiles/desktop`）。**勿用 `DSH_PROFILE`**——宿主已占用该名（值为 profile 名而非路径） |