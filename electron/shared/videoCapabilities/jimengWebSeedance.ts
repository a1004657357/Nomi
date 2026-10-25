import { DREAMINA_SEEDANCE_ARCHETYPE } from "./dreaminaSeedance";
import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

const opt = (values: Array<string | number>): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

const RATIO: ModelParameterControl = {
  key: "ratio",
  label: "比例",
  type: "select",
  options: opt(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]),
  defaultValue: "16:9",
};
const LOW_RESOLUTION: ModelParameterControl = {
  key: "video_resolution",
  label: "清晰度",
  type: "select",
  options: opt(["720P"]),
  defaultValue: "720P",
};
const VIP_RESOLUTION: ModelParameterControl = {
  ...LOW_RESOLUTION,
  options: opt(["720P", "1080P", "4K"]),
};
const DURATION: ModelParameterControl = {
  key: "duration",
  label: "时长(秒)",
  type: "number",
  options: [],
  min: 4,
  max: 15,
  defaultValue: 5,
};
const GENERATION_COUNT: ModelParameterControl = {
  key: "generation_count",
  label: "生成数量",
  type: "select",
  options: opt([1, 2, 3, 4]),
  defaultValue: 1,
};

const STANDARD_PARAMS = [RATIO, LOW_RESOLUTION, DURATION];
const MINI_PARAMS = [...STANDARD_PARAMS, GENERATION_COUNT];
const VIP_PARAMS = [RATIO, VIP_RESOLUTION, DURATION, GENERATION_COUNT];
const replaceParams = (next: ModelParameterControl[]) => () => next;
const allModes = (params: ModelParameterControl[]) =>
  Object.fromEntries(DREAMINA_SEEDANCE_ARCHETYPE.modes.map((mode) => [mode.id, replaceParams(params)]));

export const JIMENG_WEB_SEEDANCE_ARCHETYPE: ModelArchetype = {
  ...DREAMINA_SEEDANCE_ARCHETYPE,
  id: "jimeng-web-seedance-2",
  label: "即梦 Web Seedance 2.0",
  identifierPatterns: ["jimeng-web-seedance-2.0"],
  modes: DREAMINA_SEEDANCE_ARCHETYPE.modes.map((mode) => ({
    ...mode,
    hint: mode.id === "multimodal"
      ? "网页登录全能参考：最多 9 图 / 3 视频；音频参考请改用即梦 CLI"
      : mode.hint,
    slots: mode.id === "multimodal"
      ? mode.slots.filter((slot) => slot.kind !== "audio_ref")
      : [...mode.slots],
    params: STANDARD_PARAMS,
  })),
  variants: [
    {
      id: "mini",
      label: "Seedance 2.0 mini",
      modelKey: "jimeng-seedance-2.0-mini",
      identifierPatterns: ["seedance2.0mini"],
      paramOverrides: allModes(MINI_PARAMS),
    },
    {
      id: "fast_vip",
      label: "Seedance 2.0 Fast VIP",
      modelKey: "jimeng-seedance-2.0-fast-vip",
      identifierPatterns: ["seedance2.0fast_vip"],
      paramOverrides: allModes(VIP_PARAMS),
    },
    {
      id: "vip",
      label: "Seedance 2.0 VIP",
      modelKey: "jimeng-seedance-2.0-vip",
      identifierPatterns: ["seedance2.0_vip"],
      paramOverrides: allModes(VIP_PARAMS),
    },
    {
      id: "fast",
      label: "Seedance 2.0 Fast",
      modelKey: "jimeng-seedance-2.0-fast",
      identifierPatterns: ["seedance2.0fast"],
      paramOverrides: allModes(STANDARD_PARAMS),
    },
    {
      id: "standard",
      label: "Seedance 2.0",
      modelKey: "jimeng-seedance-2.0",
      identifierPatterns: ["seedance2.0"],
      paramOverrides: allModes(STANDARD_PARAMS),
    },
  ],
  defaultVariantId: "mini",
};
