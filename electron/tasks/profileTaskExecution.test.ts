import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpOperation, Mapping, Model, Vendor } from "../catalog/types";
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("executeProfileOperation AGNES preflight", () => {
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
