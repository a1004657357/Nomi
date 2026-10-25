import { describe, expect, it, vi } from "vitest";
import { buildLanguageModelForVendor, resolveLanguageModelBaseURL } from "./vendorLanguageModel";
import type { Model, Vendor } from "../catalog/types";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => process.cwd() } }));
vi.mock("./buildAiSdkModel", () => ({ buildAiSdkModel: (input: unknown) => input }));

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

  it("keeps subscription endpoints on their existing version path", () => {
    expect(
      resolveLanguageModelBaseURL(vendor({
        key: "volcengine-agent-plan",
        providerKind: "openai-responses",
        baseUrlHint: "https://ark.cn-beijing.volces.com/api/plan/v3",
      })),
    ).toBe("https://ark.cn-beijing.volces.com/api/plan/v3");
    expect(
      resolveLanguageModelBaseURL(vendor({
        key: "kimi-code",
        baseUrlHint: "https://api.kimi.com/coding/v1",
      })),
    ).toBe("https://api.kimi.com/coding/v1");
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

const model: Model = { modelKey: 'key', modelAlias: ' alias ', vendorKey: 'relay', labelZh: 'Model',
  enabled: true, kind: 'text', createdAt: '', updatedAt: '' };

describe('shared model connection identity', () => {
  it('normalizes model alias and explicit default Anthropic URL before either runtime consumes it', () => {
    expect(buildLanguageModelForVendor(vendor({ providerKind: 'anthropic', baseUrlHint: '  ' }), model, 'key'))
      .toMatchObject({ kind: 'anthropic', baseURL: 'https://api.anthropic.com/v1', modelId: 'alias' });
  });
  it('keeps a custom Anthropic endpoint and compatible version joining', () => {
    expect(buildLanguageModelForVendor(vendor({ providerKind: 'anthropic', baseUrlHint: ' https://relay.test/messages/ ' }), model, 'key'))
      .toMatchObject({ baseURL: 'https://relay.test/messages/' });
    expect(buildLanguageModelForVendor(vendor({ providerKind: 'openai-compatible', baseUrlHint: 'https://relay.test/v1/' }), model, ''))
      .toMatchObject({ baseURL: 'https://relay.test/v1' });
  });
});
