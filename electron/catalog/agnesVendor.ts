// Agnes AI（Sapiens AI，新加坡）供应商种子 —— 带免费/default 配额的全模态 OpenAI 兼容网关。
// 2026-06-28 公开实际限速：文本 20 RPM；图片 1K 20、2K 10 RPM；视频 1 RPM。
// 与 apimart 同构（curated 全模态 relay），
// 但形状有 AGNES 专属 quirk（已照官方文档核实：wiki.agnes-ai.com/en/docs/*.md + github.com/AgnesAI-Labs/Agnes-AI）：
//   文本  POST /v1/chat/completions   —— 标准 OpenAI 同步（无 mapping，走 buildLanguageModelForVendor）
//   图片  POST /v1/images/generations —— **同步** { created, data:[{ url | b64_json }] }（data.0.url）
//   视频  POST /v1/videos             —— **异步** { video_id, task_id, status:"queued" }
//   轮询  GET  /agnesapi?video_id=<ID> —— **不在 /v1 下，video_id 走 query 参数**（非路径）
//         → { status, url:<mp4 URL（status=completed 时）>, error }
//           旧版 live 响应也曾使用 remixed_from_video_id，轮询映射需兼容两者。
//   status: queued | in_progress | completed | failed
//
// 两个必处理坑（live + mock 盯死）：
//   ① 轮询是 /agnesapi（非 /v1/...）+ query 参数 → 用绝对 URL + op.query.video_id。
//   ② 成品 mp4 URL 的官方字段是 **url**，但旧版 live 响应曾返回 remixed_from_video_id；
//      两者都不应依赖 runtime 猜测，必须显式 response_mapping.video_url 依次取。
//
// baseUrl/path 约定（避 joinUrl 双前缀，见 apimartVendor.ts:12-14）：
//   vendor.baseUrl = "https://apihub.agnes-ai.com"（**裸**，不带 /v1）
//   op.path = 完整 "/v1/images/generations" / "/v1/videos"；轮询固定官方根路径（非 /v1）。

import type { HttpOperation } from "./types";

/** Agnes 供应商种子（裸 baseUrl + bearer；providerKind 缺省 openai-compatible，文本走 /v1/chat/completions）。 */
export const AGNES_VENDOR_SEED = {
  key: "agnes",
  name: "Agnes AI",
  baseUrl: "https://apihub.agnes-ai.com",
  authType: "bearer" as const,
  authHeader: "Authorization",
} as const;

/** AGNES status 动词 → 归一态。 */
export const AGNES_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["queued", "pending", "submitted"],
  running: ["in_progress", "processing", "running"],
  succeeded: ["completed", "succeeded", "success"],
  failed: ["failed", "error", "cancelled"],
};

/**
 * 视频轮询 op 工厂。2.5 系列的 keyframe/reference 任务要求额外携带 model_name；
 * 成品 URL 优先取 2.5 官方 metadata.url，并兼容 v2.0 顶层 url 与旧版 live 的
 * remixed_from_video_id。
 */
export function agnesVideoQueryOp(modelName?: string): HttpOperation {
  return {
    method: "GET",
    path: "https://apihub.agnes-ai.com/agnesapi",
    headers: { Authorization: "Bearer {{user_api_key}}" },
    query: {
      video_id: "{{providerMeta.video_id}}",
      ...(modelName ? { model_name: modelName } : {}),
    },
    response_mapping: {
      task_id: "video_id",
      status: "status",
      video_url: ["metadata.url", "url", "remixed_from_video_id"],
      error_message: ["error.message", "error"],
    },
  };
}

/** v2.0 兼容轮询；保留原导出供既有数据与测试使用。 */
export const AGNES_VIDEO_QUERY_OP: HttpOperation = agnesVideoQueryOp();

/** Video 2.5 Flash 所有模式都使用带 model_name 的推荐轮询形式。 */
export const AGNES_VIDEO_25_FLASH_QUERY_OP: HttpOperation = agnesVideoQueryOp("agnes-video-2.5-flash");
