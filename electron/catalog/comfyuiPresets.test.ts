import { describe, expect, it } from "vitest";
import { COMFYUI_PRESETS, WAN22_I2V_PRESET } from "./comfyuiPresets";
import { analyzeComfyWorkflow, buildImportedWorkflow, parseComfyApiWorkflow, reconcileComfyWorkflow } from "./comfyuiWorkflowImport";
import { parseObjectInfoIndex } from "../comfyuiObjectInfo";

describe("WAN2.2 预置模板（官方图 API 化）", () => {
  const graph = parseComfyApiWorkflow(WAN22_I2V_PRESET.workflowText);

  it("是合法 API 格式图，且分析出「视频 + 图生视频」形状", () => {
    const a = analyzeComfyWorkflow(graph);
    expect(a.outputNodes.some((o) => o.nodeId === "108" && o.kind === "video")).toBe(true);
    // 正向提示词追溯到 107（128.positive → ["107",0]）
    expect(a.suggested.promptNodeId).toBe("107");
    expect(a.suggested.firstFrameNodeId).toBe("97");
  });

  it("binding 指向的节点/输入真实存在", () => {
    const b = WAN22_I2V_PRESET.binding;
    expect(graph[b.promptNodeId!]?.inputs?.[b.promptInputKey!]).toBeDefined();
    expect(graph[b.firstFrameNodeId!]?.inputs?.[b.firstFrameInputKey!]).toBeDefined();
    for (const p of b.params ?? []) {
      expect(graph[p.nodeId]?.inputs?.[p.inputKey], `${p.nodeId}.${p.inputKey}`).toBeDefined();
    }
  });

  it("按 binding 建图：taskKind=image_to_video，占位注入到位、参数默认保真", () => {
    const built = buildImportedWorkflow(graph, WAN22_I2V_PRESET.binding);
    expect(built.taskKind).toBe("image_to_video");
    expect(built.kind).toBe("video");
    expect(built.templatedGraph["107"].inputs?.text).toBe("{{request.prompt}}");
    expect(built.templatedGraph["97"].inputs?.image).toBe("{{request.params.first_frame_url}}");
    expect(built.templatedGraph["128"].inputs?.width).toBe("{{request.params.comfy_width}}");
    expect(built.templatedGraph["110"].inputs?.noise_seed).toBe("{{request.params.comfy_seed}}");
    const defaults = Object.fromEntries(built.parameters.map((p) => [p.key, p.default]));
    expect(defaults.comfy_width).toBe(720);
    expect(defaults.comfy_length).toBe(81);
  });

  it("清单 ↔ 图 不漂移：models[] 与图中 loader 文件名互为超集（改一边必改另一边）", () => {
    const listed = new Set(WAN22_I2V_PRESET.models.map((m) => m.file));
    const inGraph = new Set<string>();
    for (const node of Object.values(graph)) {
      for (const [key, value] of Object.entries(node.inputs ?? {})) {
        if (typeof value === "string" && /^(unet_name|lora_name|clip_name|vae_name)$/.test(key)) inGraph.add(value);
      }
    }
    expect([...inGraph].sort()).toEqual([...listed].sort());
  });

  it("缺件闸：本机没有 wan 文件 → 全部 6 个文件被点名；装齐 → 零缺件", () => {
    // 每个 loader 都给同一份「本机文件」超集选项（reconcile 只做成员判定，超集无害）。
    const enums = (files: string[]) => ({
      LoadImage: { input: { required: {} } },
      CLIPLoader: { input: { required: { clip_name: [files] } } },
      VAELoader: { input: { required: { vae_name: [files] } } },
      UNETLoader: { input: { required: { unet_name: [files] } } },
      LoraLoaderModelOnly: { input: { required: { lora_name: [files] } } },
      ModelSamplingSD3: { input: { required: {} } },
      CLIPTextEncode: { input: { required: {} } },
      WanImageToVideo: { input: { required: {} } },
      KSamplerAdvanced: { input: { required: { sampler_name: [["euler"]], scheduler: [["simple"]], add_noise: [["enable", "disable"]], return_with_leftover_noise: [["enable", "disable"]] } } },
      VAEDecode: { input: { required: {} } },
      CreateVideo: { input: { required: {} } },
      SaveVideo: { input: { required: {} } },
    });
    const allFiles = WAN22_I2V_PRESET.models.map((m) => m.file);
    const bare = reconcileComfyWorkflow(graph, parseObjectInfoIndex(enums(["placeholder-not-installed.safetensors"])));
    expect(bare.unknownNodeTypes).toEqual([]);
    expect(new Set(bare.missingEnumValues.map((m) => m.value))).toEqual(new Set(allFiles));
    const full = reconcileComfyWorkflow(graph, parseObjectInfoIndex(enums(allFiles)));
    expect(full.missingEnumValues).toEqual([]);
  });

  it("清单登记完整：每个文件带目录 + 官方 HF 下载链", () => {
    for (const m of WAN22_I2V_PRESET.models) {
      expect(m.dir).toMatch(/^(diffusion_models|loras|text_encoders|vae)$/);
      expect(m.url).toMatch(/^https:\/\/huggingface\.co\/Comfy-Org\//);
      expect(m.url.endsWith(m.file)).toBe(true);
    }
    expect(COMFYUI_PRESETS.length).toBeGreaterThan(0);
  });
});
