import { describe, it, expect } from "vitest";
import { buildPlannedNodeMeta, resolvePlannedNodeArgs } from "./plannedNodeMeta";
import { buildAgentModelEntries, type AgentModelEntry } from "./availableModels";
import type { ModelOption } from "../../../config/models";
import { getArchetypeById } from "../../../config/modelArchetypes";
import { buildArchetypeInputParams } from "../nodes/controls/archetypeMeta";

function entryByKey(): Map<string, AgentModelEntry> {
  const entries = buildAgentModelEntries([
    { value: "seedance-2", label: "即梦 Seedance", vendor: "kie", meta: { archetypeId: "seedance-2" } } as ModelOption,
  ]);
  return new Map(entries.map((e) => [e.modelKey, e]));
}

function jimengEntryByKey(): Map<string, AgentModelEntry> {
  const entries = buildAgentModelEntries([
    {
      value: "jimeng-web-image",
      modelKey: "jimeng-web-image",
      label: "即梦 Web 图片",
      vendor: "jimeng-web",
      meta: { archetypeId: "jimeng-web-image" },
    } as ModelOption,
    {
      value: "jimeng-web-seedance-2.0",
      modelKey: "jimeng-web-seedance-2.0",
      label: "即梦 Web Seedance 2.0",
      vendor: "jimeng-web",
      meta: { archetypeId: "jimeng-web-seedance-2" },
    } as ModelOption,
  ]);
  return new Map(entries.map((entry) => [entry.modelKey, entry]));
}

describe("buildPlannedNodeMeta", () => {
  it("无 modelKey 返回 undefined（走原自动选）", () => {
    expect(buildPlannedNodeMeta({}, entryByKey())).toBeUndefined();
  });

  it("modelKey 不在清单返回 undefined", () => {
    expect(buildPlannedNodeMeta({ modelKey: "not-available" }, entryByKey())).toBeUndefined();
  });

  it("有效 modelKey 自铺全 vendor/label/archetype + 默认参数", () => {
    const meta = buildPlannedNodeMeta({ modelKey: "seedance-2" }, entryByKey());
    expect(meta).toBeTruthy();
    expect(meta!.modelKey).toBe("seedance-2");
    expect(meta!.modelVendor).toBe("kie");
    expect(meta!.modelLabel).toBe("即梦 Seedance");
    expect(meta!.archetype).toMatchObject({ id: "seedance-2" });
    // 默认参数已铺（seedance aspect_ratio 默认 16:9）
    expect(meta!.aspect_ratio).toBe("16:9");
  });

  it("agent 的合法参数覆盖默认", () => {
    const meta = buildPlannedNodeMeta(
      { modelKey: "seedance-2", params: { aspect_ratio: "9:16" } },
      entryByKey(),
    );
    expect(meta!.aspect_ratio).toBe("9:16");
  });

  it("非法参数值被丢弃，保留默认", () => {
    const meta = buildPlannedNodeMeta(
      { modelKey: "seedance-2", params: { aspect_ratio: "999:1" } },
      entryByKey(),
    );
    expect(meta!.aspect_ratio).toBe("16:9"); // 非法 → 回默认
  });

  it("非标量参数值被忽略", () => {
    const meta = buildPlannedNodeMeta(
      { modelKey: "seedance-2", params: { aspect_ratio: { bad: 1 } } },
      entryByKey(),
    );
    expect(meta!.aspect_ratio).toBe("16:9");
  });

  it("Agent 选择图片 5.0 Lite 后写入 variantId，并映射到实际即梦模型", () => {
    const meta = buildPlannedNodeMeta(
      {
        modelKey: "jimeng-web-image",
        variantId: "v5_0_lite",
        modeId: "t2i",
        params: { ratio: "9:16", resolution_type: "4K" },
      },
      jimengEntryByKey(),
    )!;

    expect(meta.modelKey).toBe("jimeng-web-image");
    expect(meta.archetype).toEqual({
      id: "jimeng-web-image",
      modeId: "t2i",
      variantId: "v5_0_lite",
    });
    expect(meta.ratio).toBe("9:16");
    expect(meta.resolution_type).toBe("4K");

    const archetype = getArchetypeById("jimeng-web-image")!;
    expect(buildArchetypeInputParams(meta, archetype).model).toBe("jimeng-image-5.0-lite");
  });

  it("图片 3.0 不支持参考图改图时回落到 t2i，并使用旧型号参数约束", () => {
    const meta = buildPlannedNodeMeta(
      {
        modelKey: "jimeng-web-image",
        variantId: "v3_0",
        modeId: "edit",
        params: { ratio: "智能", resolution_type: "4K" },
      },
      jimengEntryByKey(),
    )!;

    expect(meta.archetype).toEqual({
      id: "jimeng-web-image",
      modeId: "t2i",
      variantId: "v3_0",
    });
    expect(meta.ratio).toBe("1:1");
    expect(meta.resolution_type).toBe("2K");
  });

  it("即梦视频 VIP 保留 4K 和生成数量参数", () => {
    const meta = buildPlannedNodeMeta(
      {
        modelKey: "jimeng-web-seedance-2.0",
        variantId: "vip",
        modeId: "i2v",
        params: { ratio: "9:16", video_resolution: "4K", duration: 8, generation_count: 3 },
      },
      jimengEntryByKey(),
    )!;

    expect(meta.archetype).toMatchObject({ variantId: "vip", modeId: "i2v" });
    expect(meta.video_resolution).toBe("4K");
    expect(meta.generation_count).toBe(3);
    const archetype = getArchetypeById("jimeng-web-seedance-2")!;
    expect(buildArchetypeInputParams(meta, archetype).model).toBe("jimeng-seedance-2.0-vip");
  });
});

describe("resolvePlannedNodeArgs — 批准≡执行(消灭对账出入)", () => {
  it("非法参数 → 折成执行后的默认值,使计划与执行一致", () => {
    // agent 写了非法 aspect_ratio,执行会回退默认;批准时就对齐 → 对账零出入。
    const node = { clientId: "k1", kind: "video", title: "镜头", modelKey: "seedance-2", params: { aspect_ratio: "999:1" } };
    const resolved = resolvePlannedNodeArgs(node, entryByKey());
    expect((resolved.params as Record<string, unknown>).aspect_ratio).toBe("16:9");
    expect(resolved.modelKey).toBe("seedance-2");
    expect(resolved.title).toBe("镜头"); // 其它字段原样保留
  });

  it("解析后的 params 与 buildPlannedNodeMeta 的参数子集一致(同源,故对账必匹配)", () => {
    const node = { clientId: "k1", kind: "video", modelKey: "seedance-2", params: { aspect_ratio: "999:1" } };
    const resolved = resolvePlannedNodeArgs(node, entryByKey());
    const meta = buildPlannedNodeMeta(node, entryByKey())!;
    const { modelKey: _mk, modelLabel: _ml, archetype: _arch, modelVendor: _mv, ...metaParams } = meta;
    expect(resolved.params).toEqual(metaParams);
    expect(resolved.modelKey).toBe(meta.modelKey);
  });

  it("无 modelKey → 原样返回(不动)", () => {
    const node = { clientId: "k1", kind: "image", title: "镜头" };
    expect(resolvePlannedNodeArgs(node, entryByKey())).toEqual(node);
  });

  it("模型不可用 → 剥掉 modelKey/modeId/params(与执行回退自动选一致)", () => {
    const node = { clientId: "k1", kind: "video", title: "镜头", modelKey: "not-available", variantId: "vip", modeId: "i2v", params: { x: 1 } };
    const resolved = resolvePlannedNodeArgs(node, entryByKey());
    expect(resolved.modelKey).toBeUndefined();
    expect(resolved.variantId).toBeUndefined();
    expect(resolved.modeId).toBeUndefined();
    expect(resolved.params).toBeUndefined();
    expect(resolved.title).toBe("镜头");
  });

  it("批准参数保留 Agent 选择的型号", () => {
    const resolved = resolvePlannedNodeArgs(
      {
        clientId: "i1",
        kind: "image",
        modelKey: "jimeng-web-image",
        variantId: "v5_0_lite",
        modeId: "t2i",
        params: { resolution_type: "4K" },
      },
      jimengEntryByKey(),
    );

    expect(resolved.variantId).toBe("v5_0_lite");
    expect(resolved.params).toMatchObject({ resolution_type: "4K" });
  });
});
