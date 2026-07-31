import { describe, it, expect, vi } from "vitest";
import { buildAgentModelEntries, formatAvailableModelsForPrompt, listAvailableModelsForAgent, selectStoryboardVideoDefault } from "./availableModels";
import type { AgentModelEntry } from "./availableModels";
import type { ModelOption } from "../../../config/models";
import { preloadModelOptions } from "../../../config/modelCatalogCache";

vi.mock("../../../config/modelCatalogCache", () => ({
  preloadModelOptions: vi.fn(),
}));

// 用 meta.archetypeId 显式命中内置档案（resolveArchetypeForModel 优先看 archetypeId）。
function opt(over: Partial<ModelOption>): ModelOption {
  return { value: "v", label: "L", ...over };
}

describe("buildAgentModelEntries", () => {
  it("命中档案的模型 join 出 modes + params", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "seedance-2", label: "即梦 Seedance", vendor: "kie", meta: { archetypeId: "seedance-2" } }),
    ]);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.modelKey).toBe("seedance-2");
    expect(e.kind).toBe("video");
    expect(e.archetypeId).toBe("seedance-2");
    expect(e.modes.length).toBeGreaterThan(0);
    // 每个 mode 带 vendorTerm（真名）+ params schema
    expect(e.modes[0].vendorTerm).toBeTruthy();
    expect(Array.isArray(e.modes[0].params)).toBe(true);
    // seedance 默认模式有 aspect_ratio 参数（计划卡比例 chip 的来源）
    const allParamKeys = e.modes.flatMap((m) => m.params.map((p) => p.key));
    expect(allParamKeys).toContain("aspect_ratio");
    // T8：每个 mode 带参考槽（agent 据此只连模型真支持的边）。seedance omni 有 image_ref 角色参考。
    const omni = e.modes.find((m) => m.slots.some((s) => s.kind === "image_ref"));
    expect(omni).toBeTruthy();
    expect(omni?.slots.find((s) => s.kind === "image_ref")?.characterIndexed).toBe(true);
  });

  it("纯文生模型的模式 slots 为空（不接参考边）", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "imagen-4", label: "Imagen 4", meta: { archetypeId: "imagen-4" } }),
    ]);
    expect(entries[0].modes.every((m) => m.slots.length === 0)).toBe(true);
  });

  it("Codex Img2 出现在 agent 可选图片模型里，并继承 GPT Image 2 双模式", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "codex-img2", modelKey: "codex-img2", label: "Codex Img2（GPT Image 2）", vendor: "codex", meta: { archetypeId: "gpt-image-2" } }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      modelKey: "codex-img2",
      vendor: "codex",
      kind: "image",
      archetypeId: "gpt-image-2",
    });
    expect(entries[0].modes.map((m) => m.modeId)).toEqual(["t2i", "i2i"]);
  });

  it("图生 3D 模式暴露原生能力标签", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "hunyuan3d-v3.1", label: "混元3D", vendor: "runninghub", meta: { archetypeId: "hunyuan3d" } }),
    ]);
    const imageMode = entries[0].modes.find((mode) => mode.modeId === "image");
    expect(entries[0].kind).toBe("model3d");
    expect(imageMode?.capabilities).toContainEqual({
      capabilityId: "image.multiview.reconstruct3d",
      tier: "native",
      maxOutputs: 1,
    });
  });

  it("无档案的模型被跳过", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "some-unknown-model-xyz", label: "未知", vendor: "x" }),
    ]);
    expect(entries).toHaveLength(0);
  });

  it("同一 modelKey 去重（image/video 两边重复）", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "seedance-2", modelKey: "seedance-2", meta: { archetypeId: "seedance-2" } }),
      opt({ value: "seedance-2", modelKey: "seedance-2", meta: { archetypeId: "seedance-2" } }),
    ]);
    expect(entries).toHaveLength(1);
  });

  it("即梦 Web 图片向 Agent 暴露全部型号、各型号模式和参数", () => {
    const [entry] = buildAgentModelEntries([
      opt({
        value: "jimeng-web-image",
        modelKey: "jimeng-web-image",
        label: "即梦 Web 图片",
        vendor: "jimeng-web",
        meta: { archetypeId: "jimeng-web-image" },
      }),
    ]);

    expect(entry.defaultVariantId).toBe("v5_0_pro");
    expect(entry.variants.map((variant) => [variant.variantId, variant.label])).toEqual([
      ["v5_0_pro", "图片 5.0 Pro"],
      ["v5_0_lite", "图片 5.0 Lite"],
      ["v4_7", "图片 4.7"],
      ["v4_6", "图片 4.6"],
      ["v4_5", "图片 4.5"],
      ["v4_1", "图片 4.1"],
      ["v4_0", "图片 4.0"],
      ["v3_1", "图片 3.1"],
      ["v3_0", "图片 3.0"],
    ]);

    const lite = entry.variants.find((variant) => variant.variantId === "v5_0_lite");
    expect(lite?.modes.map((mode) => mode.modeId)).toEqual(["t2i", "edit"]);
    expect(
      lite?.modes[0].params.find((param) => param.key === "resolution_type")?.options.map((option) => option.value),
    ).toEqual(["2K", "4K"]);

    const legacy = entry.variants.find((variant) => variant.variantId === "v3_0");
    expect(legacy?.modes.map((mode) => mode.modeId)).toEqual(["t2i"]);
    expect(
      legacy?.modes[0].params.find((param) => param.key === "ratio")?.options.map((option) => option.value),
    ).not.toContain("智能");
  });

  it("即梦 Web 视频向 Agent 暴露 mini/Fast VIP/VIP/Fast/标准型号", () => {
    const [entry] = buildAgentModelEntries([
      opt({
        value: "jimeng-web-seedance-2.0",
        modelKey: "jimeng-web-seedance-2.0",
        label: "即梦 Web Seedance 2.0",
        vendor: "jimeng-web",
        meta: { archetypeId: "jimeng-web-seedance-2" },
      }),
    ]);

    expect(entry.defaultVariantId).toBe("mini");
    expect(entry.variants.map((variant) => variant.variantId)).toEqual([
      "mini",
      "fast_vip",
      "vip",
      "fast",
      "standard",
    ]);
    const vip = entry.variants.find((variant) => variant.variantId === "vip");
    expect(
      vip?.modes[0].params.find((param) => param.key === "video_resolution")?.options.map((option) => option.value),
    ).toEqual(["720P", "1080P", "4K"]);
    expect(vip?.modes[0].params.map((param) => param.key)).toContain("generation_count");
  });

  it("空输入返回空", () => {
    expect(buildAgentModelEntries([])).toEqual([]);
  });
});

describe("listAvailableModelsForAgent", () => {
  it("loads image, video and model3d catalogs", async () => {
    vi.mocked(preloadModelOptions).mockResolvedValue([]);
    await listAvailableModelsForAgent();
    expect(preloadModelOptions).toHaveBeenCalledWith("image");
    expect(preloadModelOptions).toHaveBeenCalledWith("video");
    expect(preloadModelOptions).toHaveBeenCalledWith("model3d");
  });
});

describe("formatAvailableModelsForPrompt", () => {
  it("空清单返回空串（不注入）", () => {
    expect(formatAvailableModelsForPrompt([])).toBe("");
  });

  it("列出 modelKey + 模式 + 参数选项", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "seedance-2", label: "即梦 Seedance", meta: { archetypeId: "seedance-2" } }),
    ]);
    const text = formatAvailableModelsForPrompt(entries);
    expect(text).toContain("modelKey=seedance-2");
    expect(text).toContain("aspect_ratio[");
    expect(text).toContain("9:16");
    // T8：提示词里带每个模式的参考槽，让 agent 按模型真实能力连边
    expect(text).toContain("参考槽:");
  });

  it("纯文生模型在提示词里标注「不接参考边」", () => {
    const entries = buildAgentModelEntries([
      opt({ value: "imagen-4", label: "Imagen 4", meta: { archetypeId: "imagen-4" } }),
    ]);
    expect(formatAvailableModelsForPrompt(entries)).toContain("纯文生,不接参考边");
  });

  it("即梦型号以 variantId 和型号专属参数写入 Agent 提示词", () => {
    const entries = buildAgentModelEntries([
      opt({
        value: "jimeng-web-image",
        modelKey: "jimeng-web-image",
        label: "即梦 Web 图片",
        vendor: "jimeng-web",
        meta: { archetypeId: "jimeng-web-image" },
      }),
    ]);
    const text = formatAvailableModelsForPrompt(entries);

    expect(text).toContain("variantId=v5_0_lite");
    expect(text).toContain("图片 5.0 Lite");
    expect(text).toContain("resolution_type[2K,4K]");
    expect(text).toContain("variantId=v3_0");
    expect(text).toContain("型号必须填写 variantId");
  });
});

describe("selectStoryboardVideoDefault", () => {
  it("skips an earlier text-only video model in favor of a later reference-capable model", () => {
    const entry = (modelKey: string, modes: AgentModelEntry["modes"]): AgentModelEntry => ({
      modelKey,
      modelAlias: null,
      vendor: "test",
      label: modelKey,
      kind: "video",
      archetypeId: modelKey,
      defaultModeId: modes[0].modeId,
      modes,
      variants: [],
    });
    const textOnly = entry("text-only", [{
      modeId: "t2v", vendorTerm: "文生视频", intent: "text", hint: "", params: [], slots: [], capabilities: [],
    }]);
    const imageVideo = entry("image-video", [{
      modeId: "i2v", vendorTerm: "图生视频", intent: "single", hint: "", params: [],
      slots: [{ kind: "first_frame", label: "首帧", max: 1 }],
      capabilities: [],
    }]);

    expect(selectStoryboardVideoDefault([textOnly, imageVideo])).toEqual({
      modelKey: "image-video",
      modeId: "i2v",
    });
  });

  it("prefers a multi-image full-reference mode over first-frame mode for narrative shots", () => {
    const seedance: AgentModelEntry = {
      modelKey: "jimeng-web-seedance-2.0",
      modelAlias: null,
      vendor: "jimeng-web",
      label: "即梦 Web Seedance 2.0",
      kind: "video",
      archetypeId: "jimeng-web-seedance-2",
      defaultModeId: "t2v",
      modes: [
        {
          modeId: "i2v",
          vendorTerm: "图生视频",
          intent: "single",
          hint: "",
          params: [],
          slots: [{ kind: "first_frame", label: "首帧", max: 1 }],
          capabilities: [],
        },
        {
          modeId: "multimodal",
          vendorTerm: "全能参考",
          intent: "character",
          hint: "",
          params: [],
          slots: [{ kind: "image_ref", label: "角色参考", max: 9 }],
          capabilities: [],
        },
      ],
      variants: [],
    };

    expect(selectStoryboardVideoDefault([seedance])).toEqual({
      modelKey: "jimeng-web-seedance-2.0",
      modeId: "multimodal",
    });
  });
});
