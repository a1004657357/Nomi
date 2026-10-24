import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSubmitOutboundDepsForTests } from "../vendor/vendorOutboundGuard";
import type { HttpOperation, Mapping, Model, Vendor } from "../catalog/types";
import { NEWAPI_IMAGE_CREATE_OP, OPENAI_MULTIPART_IMAGE_EDIT_OP } from "../catalog/newapiTransport";
import {
  attachProfileOperationTimingsToRaw,
  buildProfileTaskResult,
  executeProfileOperation,
} from "./profileTaskExecution";

const vendor: Vendor = {
  key: "agnes",
  name: "Agnes AI",
  enabled: true,
  baseUrlHint: "https://apihub.agnes-ai.com",
  authType: "bearer",
  authHeader: "Authorization",
  createdAt: "",
  updatedAt: "",
};

const model: Model = {
  modelKey: "agnes-video-v2.0",
  vendorKey: "agnes",
  labelZh: "Agnes Video V2.0",
  kind: "video",
  enabled: true,
  createdAt: "",
  updatedAt: "",
};

const operation: HttpOperation = {
  method: "POST",
  path: "/v1/videos",
  headers: {
    Authorization: "Bearer {{user_api_key}}",
    "Content-Type": "application/json",
  },
  body: {
    model: "{{model.modelKey}}",
    prompt: "{{request.prompt}}",
    image: "{{request.params.image_url}}",
  },
};

const mapping: Mapping = {
  id: "agnes-i2v-test",
  vendorKey: "agnes",
  taskKind: "image_to_video",
  modelKey: model.modelKey,
  name: "Agnes i2v",
  enabled: true,
  create: operation,
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  setSubmitOutboundDepsForTests({
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
    isApplicationProxyActive: () => false,
  });
});
afterEach(() => {
  setSubmitOutboundDepsForTests(null);
  vi.unstubAllGlobals();
});

describe("executeProfileOperation AGNES preflight", () => {
  it("snapshots the actual multipart edit size with one upload", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ url: "https://cdn.example/original.png" }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const executed = await executeProfileOperation({
      vendor: { ...vendor, key: "fixture-images" }, model: { ...model, kind: "image", vendorKey: "fixture-images" }, apiKey: "offline-test-key",
      request: { kind: "image_edit", prompt: "edit a boat", extras: { aspect_ratio: "1:1", resolution: "1K", referenceImages: ["data:image/png;base64,b3JpZ2luYWw="] } },
      operation: OPENAI_MULTIPART_IMAGE_EDIT_OP,
    });
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("size")).toBe("1024x1024");
    expect(form.getAll("image[]")).toHaveLength(1);
    expect(executed.expectedImageSize).toBe("1024x1024");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("snapshots compiled outgoing pixels rather than the 1K UI label", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ url: "https://cdn.example/original.png" }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const executed = await executeProfileOperation({
      vendor: { ...vendor, key: "fixture-images" }, model: { ...model, kind: "image", vendorKey: "fixture-images" }, apiKey: "offline-test-key",
      request: { kind: "text_to_image", prompt: "a boat", extras: { aspect_ratio: "1:1", resolution: "1K" } },
      operation: NEWAPI_IMAGE_CREATE_OP,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ size: "1024x1024" });
    expect(executed.expectedImageSize).toBe("1024x1024");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("stores phase timings beside provider raw data without replacing provider fields", () => {
    const raw = attachProfileOperationTimingsToRaw(
      { video_id: "video-1", status: "queued" },
      {
        assetLocalizationMs: 12,
        localizedAssetCount: 1,
        publicAssetProbeMs: 30,
        submissionRateLimitMs: 0,
        providerRequestMs: 80,
        totalMs: 122,
      },
    );

    expect(raw).toEqual({
      video_id: "video-1",
      status: "queued",
      __nomi: {
        profileOperation: {
          assetLocalizationMs: 12,
          localizedAssetCount: 1,
          publicAssetProbeMs: 30,
          submissionRateLimitMs: 0,
          providerRequestMs: 80,
          totalMs: 122,
        },
      },
    });
  });

  it("probes the localized public image before submitting image-to-video", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(Buffer.from([137]), {
        status: 206,
        headers: { "Content-Type": "image/png" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        video_id: "video-1",
        status: "queued",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const executed = await executeProfileOperation({
      vendor,
      model,
      apiKey: "test-key",
      request: {
        kind: "image_to_video",
        prompt: "subtle camera push-in",
        extras: {
          image_url: "https://cdn.example.com/frame.png",
          modelKey: model.modelKey,
        },
      },
      operation,
    });

    expect(executed.timings).toEqual({
      assetLocalizationMs: expect.any(Number),
      localizedAssetCount: 0,
      publicAssetProbeMs: expect.any(Number),
      submissionRateLimitMs: 0,
      providerRequestMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://cdn.example.com/frame.png");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: { Range: "bytes=0-0" },
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://apihub.agnes-ai.com/v1/videos");
    const submittedBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body || "{}")) as {
      image?: unknown;
      prompt?: unknown;
    };
    expect(submittedBody).toMatchObject({
      image: "https://cdn.example.com/frame.png",
      prompt: "subtle camera push-in",
    });
    expect(Array.isArray(submittedBody.image)).toBe(false);
  });

  it("records result asset persistence separately from provider execution", async () => {
    const timings = {
      assetLocalizationMs: 12,
      localizedAssetCount: 1,
      publicAssetProbeMs: 8,
      submissionRateLimitMs: 0,
      providerRequestMs: 40,
      totalMs: 60,
    };
    const normalized = await buildProfileTaskResult({
      response: { video_id: "video-1", status: "queued" },
      mapping,
      operation,
      request: {
        kind: "image_to_video",
        prompt: "subtle move",
        extras: { image_url: "https://cdn.example.com/frame.png" },
      },
      taskIdFallback: "fallback",
      wantedKind: "video",
      operationTimings: timings,
    });

    // totalMs = 输入 totalMs + 真实测量的 assetPersistenceMs（0/1ms 抖动）——精确值断言必 flaky，
    // 锁语义而非锁数字：其余字段原样透传，totalMs 恰好加上了分离记录的 assetPersistenceMs。
    expect(normalized.result.raw).toMatchObject({
      __nomi: {
        profileOperation: {
          ...timings,
          totalMs: expect.any(Number),
          assetPersistenceMs: expect.any(Number),
        },
      },
    });
    const recorded = (normalized.result.raw as {
      __nomi?: { profileOperation?: { totalMs: number; assetPersistenceMs: number } };
    }).__nomi?.profileOperation;
    expect(recorded?.totalMs).toBe(timings.totalMs + (recorded?.assetPersistenceMs ?? 0));
  });
});
