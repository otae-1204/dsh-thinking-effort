// @dsh-external/dsh-thinking-effort — 提供商卡片内的「思考强度」面板（纯客户端插件）。
//
// 席位：settings.models.provider-card（keyed，scope root，dispatch entryKey = settingsNs）。
// 宿主在每张渲染了目录行的提供商卡片里派发它：已保存行的卡片、其首次运行的 setup 形态、
// 以及「添加提供商」草稿卡。手工声明的草稿卡在保存前没有目录行，故不派发。
//
// 写入：ctx.remote.settings.describe() 读有效值 + 用户层 + revision；
//       ctx.remote.settings.mutate(ns, ops, revision) 写用户层（ops 的 path 相对该分区根）。
//
// 两套适配器的能力差异（决定了面板形态）：
//   llm-pi-ai     模型级 reasoningEfforts（等级→wire 拼写字典；off 可为 null=支持但不发送）
//                 + 路由级 reasoning（默认档）。
//   llm-deepseek  catalogModel 无模型级推理字段：全路由共享 thinking(enabled|disabled)
//                 与 reasoningEffort(off|low|high|max)，且 thinking=disabled 时只允许 off。
window.__ModuleLoader__.load({
  id: "@dsh-external/dsh-thinking-effort",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var h = React.createElement;

    var PLUGIN_ID = "@dsh-external/dsh-thinking-effort";
    var SLOT = "settings.models.provider-card";
    var CSS_TAG = PLUGIN_ID + "/panel.css";

    // pi-ai 的等级词表，与 dsh-llm-pi-ai 的 THINKING_LEVELS 同序。
    var PI_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    var PI_LABELS = { off: "关", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最大" };
    // DeepSeek 的路由级档位，与 dsh-llm-deepseek 的 reasoningEffort 联合类型一致。
    var DS_LEVELS = ["off", "low", "high", "max"];
    var DS_LABELS = { off: "关", low: "低", high: "高", max: "最大" };

    // 目录派发键就是 settingsNs。前四个覆盖随包发布的适配器；
    // 其余的自定义 entry id 在挂载后按 listConfigurableProviders 补齐。
    var STATIC_KEYS = ["llm-pi-ai", "llm-deepseek", "llm-deepseek-api-key", "llm-deepseek-account"];

    var CSS =
      ".THE_root{box-sizing:border-box;margin-top:12px;padding:12px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.24));border-radius:8px;display:flex;flex-direction:column;gap:10px;font-size:var(--dsh-content-font-size-secondary,13px)}" +
      ".THE_head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}" +
      ".THE_title{font-weight:600;flex:0 0 auto}" +
      ".THE_summary{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px}" +
      ".THE_headBtns{display:flex;gap:6px;align-items:center;flex:0 0 auto}" +
      ".THE_link{cursor:pointer;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;padding:0;text-decoration:underline}" +
      ".THE_link:disabled{cursor:default;opacity:.5}" +
      ".THE_linkOn{color:var(--dsw-static-blue-450,#2f6fed)}" +
      ".THE_modelBody{display:flex;flex-direction:column;gap:8px}" +
      ".THE_hint{color:var(--dsw-alias-label-tertiary);line-height:1.6}" +
      ".THE_model{display:flex;flex-direction:column;gap:8px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-secondary,rgba(128,128,128,.06))}" +
      ".THE_modelHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
      ".THE_id{font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;color:var(--dsw-alias-label-secondary)}" +
      ".THE_tag{font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.3));border-radius:999px;padding:0 6px}" +
      ".THE_chips{display:flex;gap:6px;flex-wrap:wrap}" +
      ".THE_chip{cursor:pointer;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.35));border-radius:999px;padding:2px 10px;background:transparent;color:inherit;font:inherit;line-height:20px}" +
      ".THE_chipOn{border-color:var(--dsw-static-blue-450,#2f6fed);color:var(--dsw-static-blue-450,#2f6fed)}" +
      ".THE_chip:disabled{cursor:default;opacity:.5}" +
      ".THE_row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
      ".THE_wire{display:flex;gap:8px;flex-wrap:wrap;padding-left:2px}" +
      ".THE_wireItem{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}" +
      ".THE_input,.THE_select{background:var(--dsw-alias-bg-primary,transparent);color:inherit;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.35));border-radius:6px;padding:2px 6px;font:inherit}" +
      ".THE_input{width:88px}" +
      ".THE_btn{cursor:pointer;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.35));border-radius:6px;padding:3px 12px;background:transparent;color:inherit;font:inherit}" +
      ".THE_btn:disabled{cursor:default;opacity:.5}" +
      ".THE_primary{border-color:var(--dsw-static-blue-450,#2f6fed);color:var(--dsw-static-blue-450,#2f6fed)}" +
      ".THE_status{color:var(--dsw-alias-label-tertiary)}" +
      ".THE_warn{color:var(--dsw-static-amber-500,#c98a00)}" +
      ".THE_err{color:var(--dsw-static-red-500,#d33)}";

    function ensureStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') !== null) return;
      var tag = document.createElement("style");
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }
    function dropStyles() {
      if (typeof document === "undefined") return;
      var tag = document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]');
      if (tag !== null) tag.remove();
    }

    // ---- 远端调用与路径工具 ----

    // Remote 调用回 { ok, value } / { ok, error }；这里统一成 { value } / { error }。
    function unwrap(res) {
      if (res !== null && typeof res === "object" && "ok" in res) {
        if (res.ok) return { value: res.value };
        var message = res.error !== null && typeof res.error === "object" ? res.error.message : res.error;
        return { error: typeof message === "string" && message.length > 0 ? message : "请求被拒绝" };
      }
      return { value: res };
    }

    // 与宿主 ui-settings 的 getPath 同语义：数组按数字下标取值。
    function getPath(value, path) {
      var current = value;
      for (var i = 0; i < path.length; i++) {
        if (Array.isArray(current)) { current = current[Number(path[i])]; continue; }
        if (current === null || typeof current !== "object") return void 0;
        current = current[path[i]];
      }
      return current;
    }

    function isPlainObject(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    // 面板形态由适配器决定：先看命名空间，再按配置形状兜底（自定义 entry id 的情形）。
    function layoutOf(ns, profile) {
      if (typeof ns === "string") {
        if (ns.indexOf("llm-pi-ai") === 0) return "pi-ai";
        if (ns.indexOf("llm-deepseek") === 0) return "deepseek";
      }
      if (isPlainObject(profile)) {
        if (Array.isArray(profile.models) || "modelOverrides" in profile || "reasoning" in profile) return "pi-ai";
        if ("thinking" in profile || "reasoningEffort" in profile) return "deepseek";
      }
      return "unknown";
    }

    // 已声明的等级集合：字典里出现键即「声明」，值为 null 表示支持但不发送。
    function declaredFrom(dict) {
      var sel = {};
      if (!isPlainObject(dict)) return sel;
      for (var i = 0; i < PI_LEVELS.length; i++) {
        var level = PI_LEVELS[i];
        if (Object.prototype.hasOwnProperty.call(dict, level)) sel[level] = true;
      }
      return sel;
    }

    function wiresFrom(dict) {
      var wires = {};
      for (var i = 0; i < PI_LEVELS.length; i++) {
        var level = PI_LEVELS[i];
        var declared = isPlainObject(dict) && Object.prototype.hasOwnProperty.call(dict, level);
        var wire = declared ? dict[level] : void 0;
        wires[level] = wire === null ? "" : typeof wire === "string" ? wire : level === "off" ? "" : level;
      }
      return wires;
    }

    // 面板列出的模型：优先 models 列表；列表为空时退回 modelOverrides 的键。
    function listModels(profile) {
      var entries = [];
      if (!isPlainObject(profile)) return entries;
      if (Array.isArray(profile.models) && profile.models.length > 0) {
        for (var i = 0; i < profile.models.length; i++) {
          var model = profile.models[i];
          if (!isPlainObject(model) || typeof model.id !== "string") continue;
          entries.push({ id: model.id, index: i, source: "models", efforts: model.reasoningEfforts });
        }
        return entries;
      }
      if (isPlainObject(profile.modelOverrides)) {
        var ids = Object.keys(profile.modelOverrides);
        for (var j = 0; j < ids.length; j++) {
          var override = profile.modelOverrides[ids[j]];
          entries.push({ id: ids[j], index: -1, source: "override", efforts: isPlainObject(override) ? override.reasoningEfforts : void 0 });
        }
      }
      return entries;
    }

    // 从命名空间视图取面板的初始草稿。
    function draftFromView(view, base, ns) {
      var profile = getPath(view.value, base);
      var layout = layoutOf(ns, profile);
      var entries = listModels(profile);
      var sel = {};
      var wires = {};
      var flags = {};
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.efforts === false) { flags[entry.id] = "non-reasoning"; sel[entry.id] = {}; wires[entry.id] = wiresFrom(void 0); continue; }
        if (entry.efforts === void 0) { flags[entry.id] = "inherit"; sel[entry.id] = {}; wires[entry.id] = wiresFrom(void 0); continue; }
        flags[entry.id] = "declared";
        sel[entry.id] = declaredFrom(entry.efforts);
        wires[entry.id] = wiresFrom(entry.efforts);
      }
      var draft = {
        layout: layout,
        profile: profile,
        entries: entries,
        sel: sel,
        wires: wires,
        flags: flags,
        routeDefault: layout === "deepseek" ? (isPlainObject(profile) ? profile.reasoningEffort : void 0) : (isPlainObject(profile) ? profile.reasoning : void 0),
        thinking: isPlainObject(profile) ? profile.thinking : void 0,
        advanced: {}
      };
      draft.original = JSON.stringify({ sel: draft.sel, wires: draft.wires, routeDefault: draft.routeDefault, thinking: draft.thinking });
      return draft;
    }

    // 选中集合 → reasoningEfforts 字典。off 的空 wire 写 null（支持但不发送）。
    function dictFromSel(sel, wires) {
      var out = {};
      var beyondOff = false;
      for (var i = 0; i < PI_LEVELS.length; i++) {
        var level = PI_LEVELS[i];
        if (sel[level] !== true) continue;
        var wire = wires[level];
        if (level === "off") { out.off = wire === void 0 || wire === "" ? null : wire; continue; }
        if (typeof wire !== "string" || wire.length === 0) return { error: "等级「" + PI_LABELS[level] + "」需要一个非空的 wire 拼写" };
        out[level] = wire;
        beyondOff = true;
      }
      if (!beyondOff) return { error: "至少声明一个「关」之外的等级；若该模型不支持思考，请清空全部等级（保留内置目录的能力）" };
      return { dict: out };
    }

    // ---- 写入 ----

    // pi-ai：逐模型写 reasoningEfforts，路由默认写 reasoning。
    // 用户层已有同长 models 数组时按下标做最小改动；否则整数组写入（下标写入会造出对象而非数组）。
    function opsForPiAi(draft, base, view) {
      var ops = [];
      var profile = draft.profile;
      var userModels = getPath(view.user, base.concat(["models"]));
      var useIndex = Array.isArray(userModels) && Array.isArray(profile.models) && userModels.length === profile.models.length;
      var nextModels = Array.isArray(profile.models) ? clone(profile.models) : void 0;
      var changed = false;
      for (var i = 0; i < draft.entries.length; i++) {
        var entry = draft.entries[i];
        var sel = draft.sel[entry.id] || {};
        var wires = draft.wires[entry.id] || {};
        var before = JSON.stringify(declaredFrom(entry.efforts)) + "|" + JSON.stringify(wiresFrom(entry.efforts));
        var after = JSON.stringify(sel) + "|" + JSON.stringify(wires);
        if (before === after) continue;
        changed = true;
        // 注意顺序：空集合代表「未声明」→ 必须 unset 回落内置目录，
        // 而不是交给 dictFromSel 判成「无非 off 等级」的错误（空 dict 确实非法，
        // 但未声明与声明空 dict 是两回事）。
        var value;
        if (Object.keys(sel).length === 0) {
          value = void 0;
        } else {
          var built = dictFromSel(sel, wires);
          if (built.error !== void 0) return { error: "模型 " + entry.id + "：" + built.error };
          value = built.dict;
        }
        if (entry.source === "override") {
          var overridePath = base.concat(["modelOverrides", entry.id, "reasoningEfforts"]);
          ops.push(value === void 0 ? { op: "unset", path: overridePath } : { op: "set", path: overridePath, value: value });
          continue;
        }
        if (useIndex) {
          var indexPath = base.concat(["models", String(entry.index), "reasoningEfforts"]);
          ops.push(value === void 0 ? { op: "unset", path: indexPath } : { op: "set", path: indexPath, value: value });
          continue;
        }
        if (nextModels === void 0) return { error: "该路由没有可写的模型列表" };
        if (value === void 0) Reflect.deleteProperty(nextModels[entry.index], "reasoningEfforts");
        else nextModels[entry.index].reasoningEfforts = value;
      }
      if (changed && !useIndex && nextModels !== void 0) ops.push({ op: "set", path: base.concat(["models"]), value: nextModels });
      var routePath = base.concat(["reasoning"]);
      var routeValue = typeof draft.routeDefault === "string" && draft.routeDefault.length > 0 ? draft.routeDefault : void 0;
      if ((isPlainObject(profile) ? profile.reasoning : void 0) !== routeValue) {
        ops.push(routeValue === void 0 ? { op: "unset", path: routePath } : { op: "set", path: routePath, value: routeValue });
      }
      return { ops: ops };
    }

    // DeepSeek：只有路由级 thinking 与 reasoningEffort，且两者有联动约束。
    function opsForDeepSeek(draft, base) {
      var ops = [];
      var profile = draft.profile;
      var thinking = draft.thinking === "enabled" || draft.thinking === "disabled" ? draft.thinking : void 0;
      var effort = typeof draft.routeDefault === "string" && draft.routeDefault.length > 0 ? draft.routeDefault : void 0;
      if (thinking === "disabled" && effort !== void 0 && effort !== "off") {
        return { error: "llm-deepseek 只允许在 thinking 关闭时配置 reasoningEffort \"off\"；请改为「关」或恢复 thinking" };
      }
      var currentThinking = isPlainObject(profile) ? profile.thinking : void 0;
      var currentEffort = isPlainObject(profile) ? profile.reasoningEffort : void 0;
      if (currentThinking !== thinking) ops.push(thinking === void 0 ? { op: "unset", path: base.concat(["thinking"]) } : { op: "set", path: base.concat(["thinking"]), value: thinking });
      if (currentEffort !== effort) ops.push(effort === void 0 ? { op: "unset", path: base.concat(["reasoningEffort"]) } : { op: "set", path: base.concat(["reasoningEffort"]), value: effort });
      return { ops: ops };
    }

    // ---- 组件 ----

    var CTX = null;

    function Chip(props) {
      return h("button", {
        type: "button",
        className: "THE_chip" + (props.on ? " THE_chipOn" : ""),
        disabled: props.disabled,
        onClick: props.onClick
      }, props.label);
    }

    function ThinkingEffortPanel(props) {
      var provider = isPlainObject(props.provider) ? props.provider : {};
      var ns = typeof provider.settingsNs === "string" ? provider.settingsNs : "";
      var base = Array.isArray(provider.settingsPath) ? provider.settingsPath.map(String) : [];

      var stateHook = React.useState({ status: "loading", error: null, view: null, writable: true });
      var state = stateHook[0];
      var setState = stateHook[1];
      var draftHook = React.useState(null);
      var draft = draftHook[0];
      var setDraft = draftHook[1];
      var busyHook = React.useState(false);
      var busy = busyHook[0];
      var setBusy = busyHook[1];
      var msgHook = React.useState(null);
      var message = msgHook[0];
      var setMessage = msgHook[1];
      var nonceHook = React.useState(0);
      var nonce = nonceHook[0];
      var setNonce = nonceHook[1];
      // 折叠状态：默认收起，避免整块面板把设置页撑得很长。
      var openHook = React.useState(false);
      var open = openHook[0];
      var setOpen = openHook[1];

      React.useEffect(function () {
        var live = true;
        setState({ status: "loading", error: null, view: null, writable: true });
        Promise.resolve()
          .then(function () { return CTX.remote.settings.describe(); })
          .then(function (res) {
            if (!live) return;
            var u = unwrap(res);
            if (u.error !== void 0) { setState({ status: "error", error: u.error, view: null, writable: true }); return; }
            var views = isPlainObject(u.value) && Array.isArray(u.value.namespaces) ? u.value.namespaces : [];
            var view = null;
            for (var i = 0; i < views.length; i++) if (views[i].ns === ns) { view = views[i]; break; }
            if (view === null) {
              setState({ status: "error", error: "设置分区 " + ns + " 当前不可用（该提供商尚未作为配置条目挂载）", view: null, writable: true });
              return;
            }
            setState({ status: "ready", error: null, view: view, writable: isPlainObject(u.value) ? u.value.writable !== false : true });
            setDraft(draftFromView(view, base, ns));
          })
          .catch(function (error) { if (live) setState({ status: "error", error: String(error && error.message ? error.message : error), view: null, writable: true }); });
        return function () { live = false; };
      }, [ns, nonce]);

      function save() {
        if (draft === null || state.view === null) return;
        var built = draft.layout === "deepseek" ? opsForDeepSeek(draft, base) : opsForPiAi(draft, base, state.view);
        if (built.error !== void 0) { setMessage({ kind: "error", text: built.error }); return; }
        if (built.ops.length === 0) { setMessage({ kind: "ok", text: "没有需要保存的改动" }); return; }
        setBusy(true);
        setMessage(null);
        Promise.resolve()
          .then(function () { return CTX.remote.settings.mutate(ns, built.ops, state.view.revision); })
          .then(function (res) {
            var u = unwrap(res);
            if (u.error !== void 0) { setMessage({ kind: "error", text: u.error }); setBusy(false); return; }
            setMessage({ kind: "ok", text: "已保存，共 " + built.ops.length + " 处改动" });
            setBusy(false);
            setNonce(nonce + 1);
          })
          .catch(function (error) {
            setMessage({ kind: "error", text: String(error && error.message ? error.message : error) });
            setBusy(false);
          });
      }

      function patchDraft(change) {
        setDraft(function (current) {
          if (current === null) return current;
          var next = {};
          for (var key in current) next[key] = current[key];
          change(next);
          return next;
        });
      }

      function toggleLevel(id, level) {
        patchDraft(function (next) {
          var sel = {};
          for (var key in next.sel[id]) sel[key] = next.sel[id][key];
          if (sel[level] === true) delete sel[level]; else sel[level] = true;
          next.sel[id] = sel;
        });
        setMessage(null);
      }

      function setWire(id, level, value) {
        patchDraft(function (next) {
          var wires = {};
          for (var key in next.wires[id]) wires[key] = next.wires[id][key];
          wires[level] = value;
          next.wires[id] = wires;
        });
        setMessage(null);
      }

      function toggleAdvanced(id) {
        patchDraft(function (next) {
          var advanced = {};
          for (var key in next.advanced) advanced[key] = next.advanced[key];
          advanced[id] = !advanced[id];
          next.advanced = advanced;
        });
      }

      function setRouteDefault(value) {
        patchDraft(function (next) {
          next.routeDefault = value === "" ? void 0 : value;
          // llm-deepseek 的不变量：thinking 关闭时只允许 off。
          if (next.layout === "deepseek" && next.thinking === "disabled" && next.routeDefault !== void 0 && next.routeDefault !== "off") next.routeDefault = "off";
        });
        setMessage(null);
      }

      function setThinking(value) {
        patchDraft(function (next) {
          next.thinking = value === "" ? void 0 : value;
          if (next.thinking === "disabled" && next.routeDefault !== void 0 && next.routeDefault !== "off") next.routeDefault = "off";
        });
        setMessage(null);
      }

      var children = [];

      // 头部摘要：收起时也能一眼看出关键状态，不必展开。
      var summary = "";
      if (state.status === "loading") summary = "读取中…";
      else if (state.status === "error") summary = "读取失败";
      else if (draft !== null) {
        if (draft.layout === "unknown") summary = "该适配器不支持";
        else if (!isPlainObject(draft.profile)) summary = "尚未保存到配置层";
        else if (draft.layout === "deepseek") {
          summary = "路由级 · " + (draft.thinking === void 0 ? "跟随默认" : draft.thinking === "enabled" ? "开启思考" : "关闭思考")
            + (draft.routeDefault === void 0 ? "" : " · " + (DS_LABELS[draft.routeDefault] || draft.routeDefault));
        } else {
          var declaredCount = 0;
          for (var dc = 0; dc < draft.entries.length; dc++) {
            var sid = draft.entries[dc].id;
            if (draft.flags[sid] === "declared") declaredCount++;
          }
          summary = draft.entries.length + " 个模型 · 已声明 " + declaredCount;
        }
      }

      // 只有「已就绪且有草稿」才值得折叠；读取中/出错/无草稿的正文很短，始终显示。
      var collapsible = state.status === "ready" && draft !== null;
      var collapsed = collapsible && open !== true;

      var headChildren = [
        h("div", { className: "THE_title", key: "title" }, "思考强度"),
        h("div", { className: "THE_summary", key: "sum", title: summary }, summary)
      ];
      var headBtns = [];
      if (collapsible) {
        headBtns.push(h("button", {
          className: "THE_btn", key: "toggle", type: "button",
          "aria-expanded": collapsed ? "false" : "true",
          onClick: function () { setOpen(!(open === true)); }
        }, collapsed ? "展开" : "收起"));
      }
      headBtns.push(h("button", { className: "THE_btn", key: "reload", type: "button", disabled: busy, onClick: function () { setMessage(null); setNonce(nonce + 1); } }, "刷新"));
      headChildren.push(h("div", { className: "THE_headBtns", key: "btns" }, headBtns));
      children.push(h("div", { className: "THE_head", key: "head" }, headChildren));

      if (collapsed) return h("div", { className: "THE_root" }, children);

      if (state.status === "loading") {
        children.push(h("div", { className: "THE_hint", key: "hint" }, "读取中…"));
        return h("div", { className: "THE_root" }, children);
      }
      if (state.status === "error") {
        children.push(h("div", { className: "THE_err", key: "err" }, state.error));
        return h("div", { className: "THE_root" }, children);
      }
      if (draft === null) return h("div", { className: "THE_root" }, children);

      var readOnly = state.writable === false;
      var layout = draft.layout;

      if (layout === "unknown") {
        children.push(h("div", { className: "THE_warn", key: "unknown" },
          "该提供商所属的适配器没有公开可配置的思考强度字段（" + ns + "）。本面板只支持 llm-pi-ai 与 llm-deepseek 两类适配器。"));
        return h("div", { className: "THE_root" }, children);
      }

      if (!isPlainObject(draft.profile)) {
        children.push(h("div", { className: "THE_hint", key: "dormant" },
          "该提供商尚未保存到配置层，因此没有可写的配置档。请先保存提供商，保存后此处即可配置思考强度。"));
        return h("div", { className: "THE_root" }, children);
      }

      if (layout === "pi-ai") {
        children.push(h("div", { className: "THE_hint", key: "hint" },
          "为每个模型勾选它支持的思考等级；不勾选任何等级即回到内置目录声明的能力。若某接口不认档位名作为参数值，可在对应模型行里展开「自定义参数值」逐个改写。"));
      } else {
        children.push(h("div", { className: "THE_hint", key: "hint" },
          "llm-deepseek 的推理档位是路由级的：本提供商的全部模型共享同一套 thinking 与 reasoningEffort。"));
      }

      if (layout === "deepseek") {
        var thinkingOptions = [h("option", { value: "", key: "auto" }, "跟随默认"), h("option", { value: "enabled", key: "on" }, "开启思考"), h("option", { value: "disabled", key: "off" }, "关闭思考")];
        var effortOptions = [h("option", { value: "", key: "auto" }, "跟随默认")];
        for (var i = 0; i < DS_LEVELS.length; i++) effortOptions.push(h("option", { value: DS_LEVELS[i], key: DS_LEVELS[i] }, DS_LABELS[DS_LEVELS[i]]));
        children.push(h("div", { className: "THE_row", key: "ds" }, [
          h("label", { className: "THE_wireItem", key: "t" }, ["thinking", h("select", { className: "THE_select", value: draft.thinking === void 0 ? "" : draft.thinking, disabled: readOnly || busy, onChange: function (event) { setThinking(event.target.value); } }, thinkingOptions)]),
          h("label", { className: "THE_wireItem", key: "e" }, ["reasoningEffort", h("select", { className: "THE_select", value: draft.routeDefault === void 0 ? "" : draft.routeDefault, disabled: readOnly || busy, onChange: function (event) { setRouteDefault(event.target.value); } }, effortOptions)])
        ]));
      } else {
        var routeOptions = [h("option", { value: "", key: "auto" }, "跟随适配器默认")];
        for (var r = 0; r < PI_LEVELS.length; r++) routeOptions.push(h("option", { value: PI_LEVELS[r], key: PI_LEVELS[r] }, PI_LABELS[PI_LEVELS[r]]));
        children.push(h("div", { className: "THE_row", key: "route" }, [
          h("label", { className: "THE_wireItem", key: "l" }, ["路由默认档位（新会话的初始选择）", h("select", { className: "THE_select", value: draft.routeDefault === void 0 ? "" : draft.routeDefault, disabled: readOnly || busy, onChange: function (event) { setRouteDefault(event.target.value); } }, routeOptions)])
        ]));
      }

      if (layout === "pi-ai") {
        if (draft.entries.length === 0) {
          children.push(h("div", { className: "THE_hint", key: "nodels" },
            "该路由的模型由内置目录提供，配置里没有 models 列表；请先在模型列表中声明模型，再回到此处声明它的思考等级。"));
        }
        for (var m = 0; m < draft.entries.length; m++) {
          children.push(renderModelRow(draft, draft.entries[m], readOnly, busy, toggleLevel, setWire, toggleAdvanced));
        }
      }

      var actions = [h("button", { className: "THE_btn THE_primary", key: "save", type: "button", disabled: readOnly || busy, onClick: save }, busy ? "保存中…" : "保存")];
      if (message !== null) actions.push(h("span", { className: message.kind === "error" ? "THE_err" : "THE_status", key: "msg" }, message.text));
      if (readOnly) actions.push(h("span", { className: "THE_warn", key: "ro" }, "当前浏览器不可写设置"));
      children.push(h("div", { className: "THE_actions", key: "actions" }, actions));

      return h("div", { className: "THE_root" }, children);
    }

    function renderModelRow(draft, entry, readOnly, busy, toggleLevel, setWire, toggleAdvanced) {
      var sel = draft.sel[entry.id] || {};
      var wires = draft.wires[entry.id] || {};
      var flag = draft.flags[entry.id];
      var chips = [];
      for (var i = 0; i < PI_LEVELS.length; i++) {
        var level = PI_LEVELS[i];
        chips.push(h(Chip, {
          key: level,
          label: PI_LABELS[level],
          on: sel[level] === true,
          disabled: readOnly || busy,
          onClick: function (l) { return function () { toggleLevel(entry.id, l); }; }(level)
        }));
      }
      var anySelected = false;
      for (var k = 0; k < PI_LEVELS.length; k++) if (sel[PI_LEVELS[k]] === true) { anySelected = true; break; }
      var head = [
        h("span", { className: "THE_id", key: "id" }, entry.id),
        entry.source === "override" ? h("span", { className: "THE_tag", key: "tag" }, "modelOverrides") : null,
        flag === "inherit" ? h("span", { className: "THE_tag", key: "inh" }, "继承内置目录") : null,
        flag === "non-reasoning" ? h("span", { className: "THE_tag", key: "nr" }, "已标记为非推理模型") : null,
        // 高级项：仅当勾选了档位才有意义（没勾就没有 wire 可填）。做成次要文字链接，
        // 避免每个模型行都挂一个显眼按钮。
        anySelected ? h("button", {
          className: "THE_link" + (draft.advanced[entry.id] ? " THE_linkOn" : ""),
          key: "adv", type: "button", disabled: readOnly || busy,
          title: "档位名默认就是发给接口的参数值；仅当该接口不认这套命名时才需要改",
          onClick: function () { toggleAdvanced(entry.id); }
        }, draft.advanced[entry.id] ? "收起参数值" : "自定义参数值") : null
      ];
      var parts = [h("div", { className: "THE_modelHead", key: "head" }, head), h("div", { className: "THE_chips", key: "chips" }, chips)];
      if (draft.advanced[entry.id]) {
        var wireItems = [];
        for (var j = 0; j < PI_LEVELS.length; j++) {
          var lv = PI_LEVELS[j];
          if (sel[lv] !== true) continue;
          wireItems.push(h("label", { className: "THE_wireItem", key: lv }, [
            PI_LABELS[lv],
            h("input", {
              className: "THE_input",
              value: wires[lv] === void 0 ? "" : wires[lv],
              placeholder: lv === "off" ? "留空 = 不发送" : lv,
              disabled: readOnly || busy,
              onChange: function (l) { return function (event) { setWire(entry.id, l, event.target.value); }; }(lv)
            })
          ]));
        }
        if (wireItems.length === 0) wireItems.push(h("span", { className: "THE_hint", key: "none" }, "尚未勾选任何等级"));
        parts.push(h("div", { className: "THE_wire", key: "wires" }, [
          h("div", { className: "THE_hint", key: "wtitle" }, "自定义参数值（留空即用档位名本身）")
        ].concat(wireItems)));
      }
      return h("div", { className: "THE_model", key: entry.id }, parts);
    }

    // remote.llm 用于按实际目录补齐派发键（适配器可用任意 entry id 作 settingsNs）。
    var inject = ["slots", "remote", "remote.settings", "remote.llm"];

    function apply(ctx) {
      CTX = ctx;
      ctx.effect(function () {
        ensureStyles();
        return function () { dropStyles(); };
      }, PLUGIN_ID + ": styles");

      var registered = {};
      function registerKey(key) {
        if (typeof key !== "string" || key.length === 0 || registered[key] === true) return;
        registered[key] = true;
        // 回调必须返回 register 的 disposer：slots.inject 用 ctx.effect 运行回调，
        // cordis 只收集回调返回的清理函数。
        ctx.slots.inject(SLOT, function () {
          return ctx.slots.register({ name: SLOT, key: key }, ThinkingEffortPanel);
        });
      }
      for (var i = 0; i < STATIC_KEYS.length; i++) registerKey(STATIC_KEYS[i]);

      // 适配器可用任意 entry id 作为 settingsNs，故按实际目录补齐派发键。
      ctx.effect(function () {
        var live = true;
        Promise.resolve()
          .then(function () { return ctx.remote.llm.listConfigurableProviders(); })
          .then(function (res) {
            if (!live) return;
            var u = unwrap(res);
            var list = Array.isArray(u.value) ? u.value : isPlainObject(u.value) && Array.isArray(u.value.entries) ? u.value.entries : [];
            for (var j = 0; j < list.length; j++) if (isPlainObject(list[j])) registerKey(list[j].settingsNs);
          })
          .catch(function () {});
        return function () { live = false; };
      }, PLUGIN_ID + ": keys");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
