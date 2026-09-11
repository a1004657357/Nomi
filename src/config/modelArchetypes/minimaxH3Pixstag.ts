import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Pixstag MiniMax-H3 能力档案。与 kie（image_url/reference_* 扁平键）/ apimart
// （first_frame_image/image_urls 扁平键）不是同一条线缆——Pixstag 走 MiniMax v2 官方
// content 数组（{type, <type>:{url}, role}，与火山方舟同形），故独立档案（同 kie/apimart 先例）。
// 参数面与 apimart H3 的差异来自 Pixstag 官方文档：duration 4-30（apimart 4-15）、
// resolution 多 720P/1080P 档、ratio 恒含 adaptive、多 use_context_ir / return_last_frame。

const options = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const RATIO: ModelParameterControl = { key: "ratio", label: "比例", type: "select", options: options(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]), defaultValue: "adaptive" };
const RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: options(["2K", "1080P", "768P", "720P"]), defaultValue: "2K" };
const DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 30, defaultValue: 5 };
const AIGC_WATERMARK: ModelParameterControl = { key: "aigc_watermark", label: "添加水印", type: "boolean", options: [], defaultValue: false };
const CONTEXT_IR: ModelParameterControl = { key: "use_context_ir", label: "提示词优化(Context-IR)", type: "boolean", options: [], defaultValue: false };
const RETURN_LAST_FRAME: ModelParameterControl = { key: "return_last_frame", label: "返回尾帧图", type: "boolean", options: [], defaultValue: false };

const PARAMS: ModelParameterControl[] = [RATIO, RESOLUTION, DURATION, AIGC_WATERMARK, CONTEXT_IR, RETURN_LAST_FRAME];

// content 项槽（asContentItem）：构造层按 kind 派生 type/role（first_frame→image_url+role:first_frame、
// image_ref→image_url+role:reference_image…），传输层整串透传进 content 数组。
const MODES: ModelArchetype["modes"] = [
  {
    id: "t2v",
    intent: "text",
    vendorTerm: "文生视频",
    hint: "纯文字生成视频，720P–2K，4–30 秒",
    promptRequired: true,
    transportTaskKind: "text_to_video",
    slots: [],
    params: PARAMS,
  },
  {
    id: "first",
    intent: "single",
    vendorTerm: "首帧",
    hint: "首帧图驱动，可选尾帧",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_image_content", asContentItem: true },
      { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "last_image_content", asContentItem: true },
    ],
    params: PARAMS,
  },
  {
    id: "firstlast",
    intent: "firstlast",
    vendorTerm: "首尾帧",
    hint: "首帧 + 尾帧锁定变化",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_image_content", asContentItem: true },
      { kind: "last_frame", label: "尾帧", min: 1, max: 1, inputKey: "last_image_content", asContentItem: true },
    ],
    params: PARAMS,
  },
  {
    id: "ref",
    intent: "character",
    vendorTerm: "多模态参考",
    hint: "参考图 / 视频 / 音频（图≤9 视频≤3 音频≤3）",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "image_ref", label: "参考图", min: 0, max: 9, characterIndexed: true, inputKey: "image_contents", asContentItem: true },
      { kind: "video_ref", label: "参考视频", min: 0, max: 3, inputKey: "video_contents", asContentItem: true },
      { kind: "audio_ref", label: "参考音频", min: 0, max: 3, inputKey: "audio_contents", asContentItem: true },
    ],
    params: PARAMS,
  },
];

export const MINIMAX_H3_PIXSTAG_ARCHETYPE: ModelArchetype = {
  id: "minimax-h3-pixstag",
  family: "minimax",
  label: "MiniMax H3",
  kind: "video",
  sources: [
    {
      url: "https://pixstag.com/docs/api",
      checkedAt: "2026-09-12",
      vendorKey: "pixstag",
      covers: "MiniMax-H3 文生/首尾帧/多模态参考的 POST /api/v2/video_generation 参数（duration 4-30、ratio 含 adaptive、resolution 720P-2K、aigc_watermark/use_context_ir/return_last_frame）、content[].role 契约与 query 轮询响应形状",
    },
  ],
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["MiniMax-H3"],
  modes: MODES,
};
