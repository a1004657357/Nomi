import { describe, expect, it } from "vitest";
import { PIXSTAG_STATUS_MAPPING, PIXSTAG_VENDOR_SEED, PIXSTAG_VIDEO_QUERY_OP } from "./pixstagVendor";
import { PIXSTAG_VIDEO_MODELS } from "./pixstagVideos";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { firstMappedString, taskStatusFromResponse } from "../tasks/responseParsing";
import type { CatalogState } from "./types";

// 形状锁：照 pixstag.com/docs/api 官方文档的真实请求/响应形状（2026-09-12 三次抓取交叉核对，R5）。
// mock 坐实线缆形状，不需真 key——真实出片另由带 key 的手测/评测路验证。

describe("Pixstag 供应商种子", () => {
  it("裸 baseUrl + bearer（path 自带 /api/v2，避 joinUrl 双前缀）", () => {
    expect(PIXSTAG_VENDOR_SEED.key).toBe("pixstag");
    expect(PIXSTAG_VENDOR_SEED.baseUrl).toBe("https://pixstag.com"); // 裸，不带 /api/v2
    expect(PIXSTAG_VENDOR_SEED.authType).toBe("bearer");
  });

  it("status 归一覆盖官方五态（cancelled 归 failed 桶，被取消立刻终态而非轮询到超时）", () => {
    expect(PIXSTAG_STATUS_MAPPING.succeeded).toEqual(["succeeded"]);
    expect(PIXSTAG_STATUS_MAPPING.failed).toContain("cancelled");
  });
});

describe("Pixstag 视频模型（MiniMax-H3）", () => {
  it("单模型 + 文生/图生两条 mapping，create 打 /api/v2/video_generation", () => {
    expect(PIXSTAG_VIDEO_MODELS.map((m) => m.modelKey)).toEqual(["MiniMax-H3"]);
    const model = PIXSTAG_VIDEO_MODELS[0];
    expect(model.archetypeId).toBe("minimax-h3-pixstag");
    expect(model.mappings.map((m) => m.taskKind)).toEqual(["text_to_video", "image_to_video"]);
    for (const mp of model.mappings) {
      expect(mp.create.path).toBe("/api/v2/video_generation");
      expect(mp.create.defaultParams).toEqual({ duration: 5, ratio: "adaptive", resolution: "2K" });
    }
  });

  it("轮询 op：task_id 走路径参数；结果在 task.content.url（官方 query 响应形状）", () => {
    expect(PIXSTAG_VIDEO_QUERY_OP.path).toBe("/api/v2/query/video_generation/{{providerMeta.task_id}}");
    expect(PIXSTAG_VIDEO_QUERY_OP.response_mapping).toMatchObject({
      status: "task.status",
      video_url: "task.content.url",
      error_message: "task.error.message",
    });
  });

  it("真实 query 响应经 runtime 解析器：succeeded 取到限时 url / failed 取到 error 文案", () => {
    const ok = { task: { id: "t1", status: "succeeded", content: { url: "https://cdn.pixstag.com/v.mp4", last_frame_url: "https://cdn.pixstag.com/f.png" } } };
    const rm = PIXSTAG_VIDEO_QUERY_OP.response_mapping as Record<string, unknown>;
    const url = firstMappedString(ok, rm, "video_url");
    expect(url).toBe("https://cdn.pixstag.com/v.mp4");
    expect(taskStatusFromResponse(ok, rm, undefined, [url])).toBe("succeeded");

    const failed = { task: { id: "t2", status: "failed", error: { code: 1002, message: "insufficient credit" } } };
    expect(firstMappedString(failed, rm, "error_message")).toBe("insufficient credit");
  });

  it("创建 create 响应形状：task_id 在顶层（非 data 包装）", () => {
    const create = PIXSTAG_VIDEO_MODELS[0].mappings[0].create;
    expect(create.response_mapping).toEqual({ task_id: "task_id" });
    expect(firstMappedString({ task_id: "t9" }, create.response_mapping as Record<string, unknown>, "task_id")).toBe("t9");
  });
});

describe("Pixstag 端到端 body 渲染（模板引擎真跑）", () => {
  function render(op: { body?: unknown }, params: Record<string, unknown>) {
    const context = buildTemplateContext({
      request: { prompt: "夜景城市，雨后霓虹" },
      params,
      model: {},
      modelKey: "MiniMax-H3",
      apiKey: "sk-test",
    });
    return buildHttpRequest({ baseUrl: "https://pixstag.com", authType: "bearer", apiKey: "sk-test", context, operation: op as never }).body as Record<string, unknown>;
  }

  it("t2v：content 只有文本项；标量全发；boolean 整串透传保类型", () => {
    const body = render(PIXSTAG_VIDEO_MODELS[0].mappings[0].create, {
      ratio: "16:9", resolution: "2K", duration: 8, aigc_watermark: false, use_context_ir: true, return_last_frame: false,
    });
    expect(body.model).toBe("MiniMax-H3");
    expect(body.content).toEqual([{ type: "text", text: "夜景城市，雨后霓虹" }]);
    expect(body.duration).toBe(8);
    expect(body.ratio).toBe("16:9");
    expect(body.resolution).toBe("2K");
    expect(body.use_context_ir).toBe(true);
  });

  it("i2v：首尾帧 content 项落位（M2：未声明的参考键不进 body）", () => {
    const body = render(PIXSTAG_VIDEO_MODELS[0].mappings[1].create, {
      resolution: "1080P", duration: 10,
      first_image_content: { type: "image_url", image_url: { url: "https://cdn/F.png" }, role: "first_frame" },
      last_image_content: { type: "image_url", image_url: { url: "https://cdn/L.png" }, role: "last_frame" },
    });
    expect(body.content).toEqual([
      { type: "text", text: "夜景城市，雨后霓虹" },
      { type: "image_url", image_url: { url: "https://cdn/F.png" }, role: "first_frame" },
      { type: "image_url", image_url: { url: "https://cdn/L.png" }, role: "last_frame" },
    ]);
    expect((body as { ratio?: unknown }).ratio).toBeUndefined(); // 首尾帧模式不发比例（随输入图）
    expect(body.resolution).toBe("1080P");
  });
});

describe("Pixstag 种子落库（applyBuiltinSeeds）", () => {
  it("空目录：vendor + MiniMax-H3 模型 + 两条 mapping，轮询/状态映射挂全", () => {
    const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
    const { state, changed } = applyBuiltinSeeds(empty, "2026-09-12T00:00:00.000Z");
    expect(changed).toBe(true);
    const vendor = state.vendors.find((v) => v.key === "pixstag");
    expect(vendor?.baseUrlHint).toBe("https://pixstag.com");
    const model = state.models.find((m) => m.vendorKey === "pixstag" && m.modelKey === "MiniMax-H3");
    expect(model?.kind).toBe("video");
    expect((model?.meta as { archetypeId?: string } | undefined)?.archetypeId).toBe("minimax-h3-pixstag");
    const mappings = state.mappings.filter((m) => m.vendorKey === "pixstag");
    expect(mappings.map((m) => m.id)).toEqual([
      "seed-pixstag-minimax-h3-text_to_video",
      "seed-pixstag-minimax-h3-image_to_video",
    ]);
    for (const mp of mappings) {
      expect(mp.query).toEqual(PIXSTAG_VIDEO_QUERY_OP);
      expect(mp.statusMapping).toEqual(PIXSTAG_STATUS_MAPPING);
    }
  });

  it("幂等：再次应用不重复添加", () => {
    const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
    const once = applyBuiltinSeeds(empty, "2026-09-12T00:00:00.000Z").state;
    expect(applyBuiltinSeeds(once, "2026-09-12T01:00:00.000Z").changed).toBe(false);
  });
});
