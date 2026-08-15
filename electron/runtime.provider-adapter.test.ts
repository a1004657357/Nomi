import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "./catalog/types";

let mockedUserDataRoot = "";
const roots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-adapter-runtime-"));
  roots.push(mockedUserDataRoot);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("executeProfileOperation adapter verification seam", () => {
  it("uses the injected local asset reader while preserving the production localization pipeline", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/output.png" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchFn);
    const { executeProfileOperation } = await import("./runtime");
    const now = "2026-08-07T00:00:00.000Z";
    const vendor: Vendor = {
      key: "blind-example",
      name: "Blind Example",
      enabled: false,
      baseUrlHint: "https://api.example.com/v1",
      authType: "bearer",
      assetIngestion: { strategy: "inline-base64", accepts: ["image"] },
      createdAt: now,
      updatedAt: now,
    };
    const model: Model = {
      vendorKey: vendor.key,
      modelKey: "paint-v2",
      labelZh: "Paint V2",
      kind: "image",
      enabled: false,
      createdAt: now,
      updatedAt: now,
    };

    await executeProfileOperation({
      vendor,
      model,
      apiKey: "sk-test",
      request: {
        kind: "image_edit",
        prompt: "preserve the blue square",
        extras: {
          modelKey: model.modelKey,
          referenceImages: ["nomi-local://adapter-test/reference.png"],
        },
      },
      operation: {
        method: "POST",
        path: "/images/edits",
        body: {
          model: "{{model.modelKey}}",
          prompt: "{{request.prompt}}",
          image: "{{request.params.image_url}}",
        },
      },
      localAssetReader: (url) =>
        url === "nomi-local://adapter-test/reference.png"
          ? { bytes: Buffer.from("png-fixture"), contentType: "image/png", fileName: "reference.png" }
          : null,
    });

    const body = JSON.parse(String((fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body || "{}"));
    expect(body.image).toBe(`data:image/png;base64,${Buffer.from("png-fixture").toString("base64")}`);
  });
});
