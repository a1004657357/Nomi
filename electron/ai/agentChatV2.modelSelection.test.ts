import { describe, expect, it } from "vitest";
import { orderTextModelsForAgent } from "./vendorLanguageModel";
import type { Model } from "../catalog/types";

function text(modelKey: string, vendorKey: string): Model {
  return {
    modelKey,
    vendorKey,
    labelZh: modelKey,
    kind: "text",
    enabled: true,
    createdAt: "",
    updatedAt: "",
  };
}

describe("orderTextModelsForAgent", () => {
  it("prefers the exact vendor+model pair when two providers expose the same model id", () => {
    const rows = [
      text("glm-5.2", "ark-cn-beijing-volces-com"),
      text("glm-5.2", "zai-local"),
      text("MiniMax-M2.7", "minimax-local"),
    ];

    expect(orderTextModelsForAgent(rows, { vendorKey: "zai-local", modelKey: "glm-5.2" })[0]).toMatchObject({
      vendorKey: "zai-local",
      modelKey: "glm-5.2",
    });
  });

  it("keeps legacy model-only preferences working as a fallback", () => {
    const rows = [
      text("doubao-seed-2.0-lite", "ark-cn-beijing-volces-com"),
      text("glm-5.2", "zai-local"),
    ];

    expect(orderTextModelsForAgent(rows, { modelKey: "glm-5.2" })[0]).toMatchObject({
      vendorKey: "zai-local",
      modelKey: "glm-5.2",
    });
  });
});
