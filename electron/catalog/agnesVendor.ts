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
    path: "/agnesapi",
    pathFrom: "host-root",
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

/** The 2.5 query contract also supports model keys resolved at runtime. */
export const AGNES_VIDEO_25_QUERY_OP: HttpOperation = agnesVideoQueryOp("{{model.modelKey}}");
