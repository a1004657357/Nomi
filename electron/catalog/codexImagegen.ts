// Codex 本地图片生成入口：Nomi runtime 通过本机 Codex CLI 调用 imagegen，
// 生成后写入当前项目 assets。vendor 免鉴权、无 HTTP mapping，避免把它
// 伪装成普通远端供应商。

export const CODEX_VENDOR_SEED = {
  key: "codex",
  name: "Codex",
  baseUrl: null,
  authType: "none" as const,
} as const;

export const CODEX_IMG2_MODEL_SEED = {
  modelKey: "codex-img2",
  labelZh: "Codex Img2（GPT Image 2）",
  kind: "image" as const,
} as const;
