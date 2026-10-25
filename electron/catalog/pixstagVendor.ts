// Pixstag（pixstag.com）供应商种子 —— 视频生成聚合，当前仅 MiniMax-H3（MiniMax v2 原生线缆）。
// 契约逐项对账自官方文档 pixstag.com/docs/api（2026-09-12 三次抓取交叉核对，R5）：
//   创建  POST /api/v2/video_generation → 顶层 { task_id }
//   轮询  GET  /api/v2/query/video_generation/{task_id}
//         → { task: { id, model, status, error{code,message}, content{ url, last_frame_url, … } } }
//         （视频在 task.content.url，限时下载链接，过期重查即刷新）
//   状态  queued / running / succeeded / failed / cancelled
//
// baseUrl/path 约定（同 apimart 的「裸 baseUrl + 全路径」）：
//   vendor.baseUrl = "https://pixstag.com"（裸，不带 /api/v2）
//   operation.path = 完整 "/api/v2/video_generation" / "/api/v2/query/video_generation/{{…}}"

import type { HttpOperation } from "./types";

/** Pixstag 供应商种子（裸 baseUrl + bearer）。 */
export const PIXSTAG_VENDOR_SEED = {
  key: "pixstag",
  name: "Pixstag",
  baseUrl: "https://pixstag.com",
  authType: "bearer" as const,
  authHeader: "Authorization",
} as const;

/** Pixstag 的 status 动词 → 归一态（官方枚举 queued/running/succeeded/failed/cancelled）。
 *  cancelled 归 failed 桶（终态）：任务被取消后立刻报错，而不是轮询到超时（同火山）。 */
export const PIXSTAG_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["queued"],
  running: ["running"],
  succeeded: ["succeeded"],
  failed: ["failed", "cancelled", "canceled"],
};

/** 视频轮询 op（所有 Pixstag 视频模型共用）。task_id 走路径参数；结果在 task.content.url。 */
export const PIXSTAG_VIDEO_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/api/v2/query/video_generation/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "task.id",
    status: "task.status",
    video_url: "task.content.url",
    error_message: "task.error.message",
  },
};
