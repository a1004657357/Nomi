import { describe, expect, it } from "vitest";
import { resolveLanguageModelBaseURL } from "./vendorLanguageModel";
import type { Vendor } from "../catalog/types";

function vendor(input: Partial<Vendor>): Vendor {
  return {
    key: input.key || "test",
    name: input.name || "Test",
    enabled: input.enabled ?? true,
    baseUrlHint: input.baseUrlHint ?? "https://api.example.com",
    authType: input.authType || "bearer",
    providerKind: input.providerKind || "openai-compatible",
    meta: input.meta,
    createdAt: "",
    updatedAt: "",
  };
}

describe("resolveLanguageModelBaseURL", () => {
  it("defaults OpenAI-compatible text models to /v1", () => {
    expect(resolveLanguageModelBaseURL(vendor({ baseUrlHint: "https://api.example.com" }))).toBe("https://api.example.com/v1");
  });

  it("keeps Anthropic base URLs raw", () => {
    expect(resolveLanguageModelBaseURL(vendor({ providerKind: "anthropic", baseUrlHint: "https://api.anthropic.com/" }))).toBe(
      "https://api.anthropic.com/",
    );
  });

  it("allows raw OpenAI-compatible bases for providers whose chat path is already versioned", () => {
    expect(
      resolveLanguageModelBaseURL(vendor({
        baseUrlHint: "https://open.bigmodel.cn/api/coding/paas/v4/",
        meta: { openAiCompatibleBasePath: "" },
      })),
    ).toBe("https://open.bigmodel.cn/api/coding/paas/v4");
  });

  it("allows custom OpenAI-compatible base paths", () => {
    expect(
      resolveLanguageModelBaseURL(vendor({
        baseUrlHint: "https://relay.example.com/root",
        meta: { openAiCompatibleBasePath: "/openai/v1" },
      })),
    ).toBe("https://relay.example.com/root/openai/v1");
  });
});
