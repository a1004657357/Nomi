// 即梦 Web / Seedance 扩展桥供应商种子。
//
// 这是 Nomi 里的实验性网页登录通道：catalog 只暴露一个本地 runtime vendor；
// 运行时先接 Seedance2 Chrome 扩展的本地任务服务器（Nomi 独占 127.0.0.1:3457），
// 后续可把底层替换成 Electron 内置 Web Worker，而画布模型身份不变。

export const JIMENG_WEB_BRIDGE_INSTANCE_ID = "nomi-jimeng-runner-v1";
export const JIMENG_WEB_LEGACY_BASE_URLS = [
  "http://127.0.0.1:3456",
  "http://localhost:3456",
] as const;

export const JIMENG_WEB_VENDOR_SEED = {
  key: "jimeng-web",
  name: "即梦 Web（网页登录实验）",
  baseUrl: "http://127.0.0.1:3457",
  authType: "none" as const,
  authHeader: null,
} as const;

export const JIMENG_WEB_SEEDANCE_MODEL_SEED = {
  modelKey: "jimeng-web-seedance-2.0",
  labelZh: "即梦 Web Seedance 2.0（实验）",
  kind: "video" as const,
  archetypeId: "jimeng-web-seedance-2",
} as const;

export const JIMENG_WEB_IMAGE_MODEL_SEED = {
  modelKey: "jimeng-web-image",
  labelZh: "即梦 Web 图片（实验）",
  kind: "image" as const,
  archetypeId: "jimeng-web-image",
} as const;
