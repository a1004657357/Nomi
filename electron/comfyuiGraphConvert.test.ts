import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

import { looksLikeUiWorkflow } from "./comfyuiGraphConvert";

describe("looksLikeUiWorkflow（决定要不要试自动转换）", () => {
  it("界面格式（nodes[]/links[]）→ true", () => {
    expect(looksLikeUiWorkflow(JSON.stringify({ nodes: [], links: [], version: 0.4 }))).toBe(true);
    expect(looksLikeUiWorkflow(JSON.stringify({ links: [[1, 2, 0, 3, 0, "IMAGE"]] }))).toBe(true);
  });

  it("API 格式 → false（别对已经能用的图做无谓转换）", () => {
    expect(looksLikeUiWorkflow(JSON.stringify({ "1": { class_type: "SaveImage", inputs: {} } }))).toBe(false);
  });

  it("坏 JSON / 空 → false（交给既有解析器报「不是合法 JSON」）", () => {
    expect(looksLikeUiWorkflow("{bad")).toBe(false);
    expect(looksLikeUiWorkflow("")).toBe(false);
  });
});
