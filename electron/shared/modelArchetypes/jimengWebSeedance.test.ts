import { describe, expect, it } from "vitest";
import { resolveArchetypeForModel, specializeArchetypeForVariant } from "./index";

describe("即梦 Web Seedance 档案", () => {
  it("暴露官网当前 Seedance 2.0 型号，并按会员型号收窄画质和数量", () => {
    const archetype = resolveArchetypeForModel({
      vendorKey: "jimeng-web",
      modelKey: "jimeng-web-seedance-2.0",
      meta: { archetypeId: "jimeng-web-seedance-2" },
    });

    expect(archetype?.variants?.map((variant) => [variant.label, variant.modelKey])).toEqual([
      ["Seedance 2.0 mini", "jimeng-seedance-2.0-mini"],
      ["Seedance 2.0 Fast VIP", "jimeng-seedance-2.0-fast-vip"],
      ["Seedance 2.0 VIP", "jimeng-seedance-2.0-vip"],
      ["Seedance 2.0 Fast", "jimeng-seedance-2.0-fast"],
      ["Seedance 2.0", "jimeng-seedance-2.0"],
    ]);
    expect(archetype?.defaultVariantId).toBe("mini");
    const multimodal = archetype?.modes.find((mode) => mode.id === "multimodal");
    expect(multimodal?.slots.map((slot) => slot.kind)).toEqual(["image_ref", "video_ref"]);
    expect(multimodal?.slots.find((slot) => slot.kind === "video_ref")).toMatchObject({ max: 3 });

    const params = (variantId: string) =>
      specializeArchetypeForVariant(archetype!, variantId).modes.find((mode) => mode.id === "t2v")!.params;
    const values = (variantId: string, key: string) =>
      params(variantId).find((param) => param.key === key)?.options.map((option) => option.value);

    expect(values("mini", "video_resolution")).toEqual(["720P"]);
    expect(values("mini", "generation_count")).toEqual([1, 2, 3, 4]);
    expect(values("vip", "video_resolution")).toEqual(["720P", "1080P", "4K"]);
    expect(values("vip", "generation_count")).toEqual([1, 2, 3, 4]);
    expect(values("standard", "video_resolution")).toEqual(["720P"]);
    expect(params("standard").map((param) => param.key)).not.toContain("generation_count");
    expect(params("standard").find((param) => param.key === "duration")).toMatchObject({
      min: 4,
      max: 15,
      defaultValue: 5,
    });
  });
});
