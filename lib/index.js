// @dsh-external/dsh-thinking-effort — host 桩。
// 纯客户端插件：全部逻辑在 lib/client.js（浏览器端，经 dsh.client 注入通道加载）。
// host 侧无服务、无工具、无路由；此入口仅为满足包加载契约。
const name = "@dsh-external/dsh-thinking-effort";

function apply() {}

export { apply, name };
