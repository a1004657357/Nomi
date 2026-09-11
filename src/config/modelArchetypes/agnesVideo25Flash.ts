import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Agnes Video 2.5 Flash：固定 720P，时长必须是字符串 "4"-"12"，只允许单结果。
// mode 不是用户参数，而是由模式固定注入，防止互斥媒体字段被一起发送。
const opt = (values: string[]): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  {
    key: "aspect_ratio",
    label: "比例",
    type: "select",
    options: opt(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]),
    defaultValue: "16:9",
  },
  {
    key: "duration",
    label: "时长(秒)",
    type: "select",
    options: opt(["4", "5", "6", "7", "8", "9", "10", "11", "12"]),
    defaultValue: "5",
  },
];

export const AGNES_VIDEO_25_FLASH_ARCHETYPE: ModelArchetype = {
  id: "agnes-video-2.5-flash",
  family: "agnes-video",
  label: "Agnes Video 2.5 Flash",
  kind: "video",
  sources: [
    {
      url: "https://agnes-ai.com/en/docs/agnes-video-25-flash",
      checkedAt: "2026-08-26",
      vendorKey: "agnes",
      covers: "模型 ID、模式、720P 限制、4-12 秒、最多 5 张参考图、轮询 model_name 与限时免费价格",
    },
  ],
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["agnes-video-2.5-flash"],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成 720P 视频",
      promptRequired: true,
      transportTaskKind: "text_to_video",
      slots: [],
      params: PARAMS,
      fixedParams: { mode: "text" },
    },
    {
      id: "reference",
      intent: "character",
      vendorTerm: "全能参考",
      hint: "使用 1-5 张图片，可附加参考音频",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "image_ref", label: "参考图", min: 1, max: 5, inputKey: "images" },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 5, inputKey: "audios" },
      ],
      params: PARAMS,
      fixedParams: { mode: "reference" },
    },
    {
      id: "firstlast",
      intent: "firstlast",
      vendorTerm: "首尾帧",
      hint: "锁定首帧与尾帧之间的变化",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "image_url" },
        { kind: "last_frame", label: "尾帧", min: 1, max: 1, inputKey: "last_frame" },
      ],
      params: PARAMS,
      fixedParams: { mode: "keyframe" },
    },
    {
      // 放在 image_to_video 模式末尾，使 headless/MCP 缺少显式模式时安全回退为单首帧。
      id: "keyframe",
      intent: "single",
      vendorTerm: "首帧驱动",
      hint: "以一张图片作为实际首帧",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "image_url" }],
      params: PARAMS,
      fixedParams: { mode: "keyframe" },
    },
  ],
};
