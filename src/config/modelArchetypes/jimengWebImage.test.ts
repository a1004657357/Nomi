import { describe, expect, it } from "vitest";
import { resolveArchetypeForModel, specializeArchetypeForVariant } from "./index";

describe("即梦 Web 图片档案", () => {
  it("暴露官网当前图片型号，并按型号收窄清晰度", () => {
    const archetype = resolveArchetypeForModel({
      vendorKey: "jimeng-web",
      modelKey: "jimeng-web-image",
      meta: { archetypeId: "jimeng-web-image" },
    });

    expect(archetype).toMatchObject({
      id: "jimeng-web-image",
      kind: "image",
      defaultModeId: "t2i",
    });
    expect(archetype?.modes.map((mode) => mode.transportTaskKind)).toEqual([
      "text_to_image",
      "image_edit",
    ]);
    expect(archetype?.modes.find((mode) => mode.id === "edit")?.slots).toEqual([
      expect.objectContaining({ kind: "image_ref", min: 1, max: 10, inputKey: "input_images" }),
    ]);
    expect(archetype?.variants?.map((variant) => [variant.label, variant.modelKey])).toEqual([
      ["图片 5.0 Pro", "jimeng-image-5.0-pro"],
      ["图片 5.0 Lite", "jimeng-image-5.0-lite"],
      ["图片 4.7", "jimeng-image-4.7"],
      ["图片 4.6", "jimeng-image-4.6"],
      ["图片 4.5", "jimeng-image-4.5"],
      ["图片 4.1", "jimeng-image-4.1"],
      ["图片 4.0", "jimeng-image-4.0"],
      ["图片 3.1", "jimeng-image-3.1"],
      ["图片 3.0", "jimeng-image-3.0"],
    ]);
    expect(archetype?.defaultVariantId).toBe("v5_0_pro");

    const params = (variantId: string) =>
      specializeArchetypeForVariant(archetype!, variantId).modes.find((mode) => mode.id === "t2i")!.params;
    const values = (variantId: string, key: string) =>
      params(variantId).find((param) => param.key === key)?.options.map((option) => option.value);

    expect(values("v5_0_pro", "ratio")).toContain("智能");
    expect(values("v5_0_pro", "resolution_type")).toEqual(["1K", "2K", "4K"]);
    expect(values("v5_0_lite", "resolution_type")).toEqual(["2K", "4K"]);
    expect(values("v4_7", "resolution_type")).toEqual(["2K", "4K"]);
    expect(values("v5_0_lite", "generation_count")).toEqual([1, 2, 3, 4]);
    expect(params("v5_0_lite").find((param) => param.key === "generation_count")?.defaultValue).toBe(1);
    expect(values("v3_0", "ratio")).not.toContain("智能");
    expect(values("v3_0", "resolution_type")).toEqual(["1K", "2K"]);
    expect(archetype?.variants?.find((variant) => variant.id === "v3_0")).toMatchObject({
      supportedModeIds: ["t2i"],
    });
  });
});
