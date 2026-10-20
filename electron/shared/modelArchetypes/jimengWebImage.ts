import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

const opt = (values: Array<string | number>): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

const modernRatio: ModelParameterControl = {
  key: "ratio",
  label: "比例",
  type: "select",
  options: opt(["智能", "21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]),
  defaultValue: "智能",
};
const legacyRatio: ModelParameterControl = {
  ...modernRatio,
  options: opt(["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]),
  defaultValue: "1:1",
};
const proResolution: ModelParameterControl = {
  key: "resolution_type",
  label: "清晰度",
  type: "select",
  options: opt(["1K", "2K", "4K"]),
  defaultValue: "2K",
};
const modernResolution: ModelParameterControl = {
  ...proResolution,
  options: opt(["2K", "4K"]),
};
const legacyResolution: ModelParameterControl = {
  ...proResolution,
  options: opt(["1K", "2K"]),
};
const generationCount: ModelParameterControl = {
  key: "generation_count",
  label: "生成数量",
  type: "select",
  options: opt([1, 2, 3, 4]),
  defaultValue: 1,
};
const MODERN_PARAMS: ModelParameterControl[] = [modernRatio, modernResolution, generationCount];
const PRO_PARAMS: ModelParameterControl[] = [modernRatio, proResolution, generationCount];
const LEGACY_PARAMS: ModelParameterControl[] = [legacyRatio, legacyResolution, generationCount];

const replaceParams = (next: ModelParameterControl[]) => () => next;
const allModes = (params: ModelParameterControl[]) => ({
  t2i: replaceParams(params),
  edit: replaceParams(params),
});

export const JIMENG_WEB_IMAGE_ARCHETYPE: ModelArchetype = {
  id: "jimeng-web-image",
  family: "jimeng-web-image",
  label: "即梦 Web 图片",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["jimeng-web-image"],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "使用已登录的即梦网页生成图片",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: MODERN_PARAMS,
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "参考图改图",
      hint: "上传参考图并在即梦网页中生成新图片",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 10, inputKey: "input_images" }],
      params: MODERN_PARAMS,
    },
  ],
  variants: [
    { id: "v5_0_pro", label: "图片 5.0 Pro", modelKey: "jimeng-image-5.0-pro", paramOverrides: allModes(PRO_PARAMS) },
    { id: "v5_0_lite", label: "图片 5.0 Lite", modelKey: "jimeng-image-5.0-lite", paramOverrides: allModes(MODERN_PARAMS) },
    { id: "v4_7", label: "图片 4.7", modelKey: "jimeng-image-4.7", paramOverrides: allModes(MODERN_PARAMS) },
    { id: "v4_6", label: "图片 4.6", modelKey: "jimeng-image-4.6", paramOverrides: allModes(MODERN_PARAMS) },
    { id: "v4_5", label: "图片 4.5", modelKey: "jimeng-image-4.5", paramOverrides: allModes(MODERN_PARAMS) },
    { id: "v4_1", label: "图片 4.1", modelKey: "jimeng-image-4.1", paramOverrides: allModes(MODERN_PARAMS) },
    { id: "v4_0", label: "图片 4.0", modelKey: "jimeng-image-4.0", paramOverrides: allModes(MODERN_PARAMS) },
    {
      id: "v3_1",
      label: "图片 3.1",
      modelKey: "jimeng-image-3.1",
      supportedModeIds: ["t2i"],
      paramOverrides: { t2i: replaceParams(LEGACY_PARAMS) },
    },
    {
      id: "v3_0",
      label: "图片 3.0",
      modelKey: "jimeng-image-3.0",
      supportedModeIds: ["t2i"],
      paramOverrides: { t2i: replaceParams(LEGACY_PARAMS) },
    },
  ],
  defaultVariantId: "v5_0_pro",
};
