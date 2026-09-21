export const PAVO_WEB_BRIDGE_INSTANCE_ID = "nomi-pavo-web-v1";

export const PAVO_WEB_VENDOR_SEED = {
  key: "pavo-web",
  name: "Pavo Web（网页登录）",
  baseUrl: "http://127.0.0.1:3458",
  authType: "none" as const,
  authHeader: null,
} as const;

export const PAVO_WEB_AGNES_FLASH_MODEL_SEED = {
  modelKey: "pavo-agnes-video-2.5-flash",
  labelZh: "Pavo Web Agnes Video 2.5 Flash",
  kind: "video" as const,
  archetypeId: "agnes-video-2.5-flash",
} as const;
