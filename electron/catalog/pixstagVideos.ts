// Pixstag 视频模型的 curated 传输配方（单源）。契约逐项对账自 pixstag.com/docs/api（2026-09-12）：
//   POST /api/v2/video_generation { model, content[], duration 4-30, ratio adaptive|21:9|16:9|4:3|1:1|3:4|9:16,
//                                   resolution 720P|768P|1080P|2K, aigc_watermark, use_context_ir,
//                                   return_last_frame } → { task_id }
//
// content 数组与火山方舟 content 项同形（{type, <type>:{url}, role}，见 archetypeMeta asContentItem
// 构造）：文本项恒在第一位，媒体项由槽声明产出、空则模板丢弃（M2 模式投影保证只发当前模式的键）。
// 参考通道上限沿用 MiniMax H3 官方契约（9 图 / 3 视频 / 3 音频，同 apimart H3 档案）。

import type { HttpOperation, ProfileKind } from "./types";

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

const TEXT_CONTENT = { type: "text", text: "{{request.prompt}}" };
// content 项槽（asContentItem 构造层产出整项对象，模板整串透传；键随档案声明走，见 minimaxH3Pixstag.ts）
const FIRST_IMAGE_CONTENT = "{{request.params.first_image_content}}";
const LAST_IMAGE_CONTENT = "{{request.params.last_image_content}}";
const IMAGE_REF_CONTENTS = "{{request.params.image_contents}}";
const VIDEO_REF_CONTENTS = "{{request.params.video_contents}}";
const AUDIO_REF_CONTENTS = "{{request.params.audio_contents}}";

function createOp(content: unknown[]): HttpOperation {
  return {
    method: "POST",
    path: "/api/v2/video_generation",
    headers: CREATE_HEADERS,
    body: {
      model: "{{model.modelKey}}",
      content,
      duration: "{{request.params.duration}}",
      ratio: "{{request.params.ratio}}",
      resolution: "{{request.params.resolution}}",
      aigc_watermark: "{{request.params.aigc_watermark}}",
      use_context_ir: "{{request.params.use_context_ir}}",
      return_last_frame: "{{request.params.return_last_frame}}",
    },
    response_mapping: { task_id: "task_id" },
    provider_meta_mapping: { task_id: "task_id" },
    // headless/MCP 路的 wire 下限（vendor 必填字段兜底；UI 路已按档案默认填值，零影响）。
    defaultParams: { duration: 5, ratio: "adaptive", resolution: "2K" },
  };
}

/** 文生（content 仅文本项）。首尾帧/多模态参考走 I2V（各 content 项空则丢弃）。 */
const T2V_CREATE = createOp([TEXT_CONTENT]);
const I2V_CREATE = createOp([
  TEXT_CONTENT,
  FIRST_IMAGE_CONTENT,
  LAST_IMAGE_CONTENT,
  IMAGE_REF_CONTENTS,
  VIDEO_REF_CONTENTS,
  AUDIO_REF_CONTENTS,
]);

export type PixstagVideoModel = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation }[];
};

export const PIXSTAG_VIDEO_MODELS: PixstagVideoModel[] = [
  {
    modelKey: "MiniMax-H3",
    labelZh: "MiniMax H3",
    archetypeId: "minimax-h3-pixstag",
    mappings: [
      { id: "seed-pixstag-minimax-h3-text_to_video", taskKind: "text_to_video", name: "MiniMax H3 · 文生视频", create: T2V_CREATE },
      { id: "seed-pixstag-minimax-h3-image_to_video", taskKind: "image_to_video", name: "MiniMax H3 · 图生视频", create: I2V_CREATE },
    ],
  },
];
