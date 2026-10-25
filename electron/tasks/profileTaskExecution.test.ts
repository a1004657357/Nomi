import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSubmitOutboundDepsForTests } from "../vendor/vendorOutboundGuard";
import type { HttpOperation, Mapping, Model, Vendor } from "../catalog/types";
import { NEWAPI_IMAGE_CREATE_OP, OPENAI_MULTIPART_IMAGE_EDIT_OP } from "../catalog/newapiTransport";
import {
  attachProfileOperationTimingsToRaw,
  executeProfileOperation,
} from "./profileTaskExecution";
import { buildProfileTaskResult } from "../runtime";
import * as metadataTransport from "../hardenedFetch";
import * as profileHttpRequest from "../catalog/profileHttpRequest";
import * as vendorHttp from "../vendor/vendorHttp";
import * as submissionWindow from "../vendorSubmissionRateLimiter";

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
  // This file tests orchestration, not the application route/DNS policy owner.
  vi.spyOn(metadataTransport, "hardenedFetch").mockRejectedValue(new Error("Unexpected metadata transport"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected vendor transport"); }));
  setSubmitOutboundDepsForTests({
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
    isApplicationProxyActive: () => false,
  });
});
afterEach(() => {
  setSubmitOutboundDepsForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const publicImageUrl = "https://cdn.example.com/frame.png";

function agnesFixture() {
  const metadata = vi.mocked(metadataTransport.hardenedFetch).mockResolvedValue({
    status: 206, contentType: "image/png", bytes: Buffer.alloc(0), finalUrl: publicImageUrl, truncated: false,
  });
  const build = vi.spyOn(profileHttpRequest, "buildProfileHttpRequest");
  const submit = vi.spyOn(vendorHttp, "requestJson");
  // Do not reserve slots in the user's persistent ledger. Rejection must never reach here.
  const rate = vi.spyOn(submissionWindow, "waitForVendorSubmissionWindow").mockResolvedValue(null);
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    video_id: "video-1", status: "queued",
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const input: Parameters<typeof executeProfileOperation>[0] = {
    vendor, model, apiKey: "test-key", operation,
    request: {
      kind: "image_to_video", prompt: "subtle camera push-in",
      extras: { image_url: publicImageUrl, modelKey: model.modelKey },
    },
  };
  const expectProbe = () => {
    expect(metadata).toHaveBeenCalledExactlyOnceWith(publicImageUrl, {
      method: "GET", headers: { Range: "bytes=0-0" }, signal: expect.any(AbortSignal),
      timeoutMs: 12_000, headersOnly: true, outboundStage: "submit", throwOnNon2xx: false,
    });
  };
  return { input, metadata, build, submit, rate, fetchMock, expectProbe };
}

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
    const f = agnesFixture();
    const original = JSON.stringify(f.input.request);
    const executed = await executeProfileOperation(f.input);

    expect(executed.timings).toEqual({
      assetLocalizationMs: expect.any(Number),
      localizedAssetCount: 0,
      publicAssetProbeMs: expect.any(Number),
      submissionRateLimitMs: 0,
      providerRequestMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
    f.expectProbe();
    expect(f.build).toHaveBeenCalledTimes(1);
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.rate).not.toHaveBeenCalled(); // This original call has no create stage.
    expect(f.metadata.mock.invocationCallOrder[0]).toBeLessThan(f.build.mock.invocationCallOrder[0]);
    expect(f.build.mock.invocationCallOrder[0]).toBeLessThan(f.submit.mock.invocationCallOrder[0]);
    expect(f.submit.mock.invocationCallOrder[0]).toBeLessThan(f.fetchMock.mock.invocationCallOrder[0]);
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    expect(f.fetchMock.mock.calls[0]?.[0]).toBe("https://apihub.agnes-ai.com/v1/videos");
    expect(f.fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    const submittedBody = JSON.parse(String(f.fetchMock.mock.calls[0]?.[1]?.body || "{}")) as {
      image?: unknown;
      prompt?: unknown;
    };
    expect(submittedBody).toMatchObject({
      image: "https://cdn.example.com/frame.png",
      prompt: "subtle camera push-in",
    });
    expect(Array.isArray(submittedBody.image)).toBe(false);
    expect(JSON.stringify(f.input.request)).toBe(original);
    expect(executed.response).toEqual({ video_id: "video-1", status: "queued" });
  });

  it("localizes a local reference to its fresh public original before probe, build and one submit", async () => {
    const f = agnesFixture();
    const localUrl = "nomi-local://asset/fixture/frame.png";
    const read = vi.fn(() => ({
      bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"),
      contentType: "image/png", fileName: "frame.png", originalUrl: publicImageUrl, ageMs: 0,
    }));
    f.input.stage = "create";
    f.input.request.extras!.image_url = localUrl;
    f.input.localAssetReader = read;
    const original = JSON.stringify(f.input.request);
    const executed = await executeProfileOperation(f.input);

    expect(read).toHaveBeenCalledWith(localUrl);
    f.expectProbe();
    expect(read.mock.invocationCallOrder[0]).toBeLessThan(f.metadata.mock.invocationCallOrder[0]);
    expect(f.metadata.mock.invocationCallOrder[0]).toBeLessThan(f.build.mock.invocationCallOrder[0]);
    expect(f.build.mock.invocationCallOrder[0]).toBeLessThan(f.rate.mock.invocationCallOrder[0]);
    expect(f.rate.mock.invocationCallOrder[0]).toBeLessThan(f.submit.mock.invocationCallOrder[0]);
    expect(f.build).toHaveBeenCalledTimes(1);
    expect(f.build.mock.calls[0]?.[0].request.extras?.image_url).toBe(publicImageUrl);
    expect(f.rate).toHaveBeenCalledExactlyOnceWith("agnes", "video");
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.fetchMock).toHaveBeenCalledTimes(1); // No upload: the original URL is fresh.
    expect(f.fetchMock.mock.calls[0]?.[0]).toBe("https://apihub.agnes-ai.com/v1/videos");
    expect(JSON.parse(String(f.fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ image: publicImageUrl });
    expect(executed.timings.localizedAssetCount).toBe(1);
    expect(JSON.stringify(f.input.request)).toBe(original);
  });

  it.each([
    { reason: "metadata transport refusal", error: new Error("offline metadata refusal"), message: /offline metadata refusal/ },
    { reason: "expired URL", status: 403, contentType: "image/png", message: /HTTP 403/ },
    { reason: "HTML landing page", status: 200, contentType: "text/html", message: /不是图片/ },
  ])("stops $reason before any build, vendor call or rate reservation without retrying", async rejection => {
    const f = agnesFixture();
    f.input.stage = "create";
    if (rejection.error) f.metadata.mockRejectedValue(rejection.error);
    else f.metadata.mockResolvedValue({ status: rejection.status!, contentType: rejection.contentType!, bytes: Buffer.alloc(0), finalUrl: publicImageUrl, truncated: false });

    await expect(executeProfileOperation(f.input)).rejects.toThrow(rejection.message);
    f.expectProbe(); // Exactly one real probe-to-transport call, even on refusal.
    expect(f.build).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.rate).not.toHaveBeenCalled();
    expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { reason: "network outcome unknown", error: new TypeError("offline fetch failed"), structured: { category: "submission-unknown", retryable: false } },
    { reason: "timeout outcome unknown", error: new DOMException("offline timed out", "TimeoutError"), structured: { category: "submission-unknown", retryable: false } },
    { reason: "retryable upstream logical error", response: { code: 500, message: "offline upstream failure" }, status: 200, structured: { category: "server", retryable: true } },
    { reason: "explicit generation outcome unknown", response: { error: { code: "generation_outcome_unknown", message: "offline outcome unknown" } }, status: 502, structured: { category: "submission-unknown", retryable: false } },
  ])("does not resubmit media after $reason", async failure => {
    const f = agnesFixture();
    f.input.stage = "create";
    if (failure.error) f.fetchMock.mockRejectedValue(failure.error);
    else f.fetchMock.mockResolvedValue(new Response(JSON.stringify(failure.response), { status: failure.status, headers: { "Content-Type": "application/json" } }));

    await expect(executeProfileOperation(f.input)).rejects.toMatchObject({
      structured: failure.structured,
    });
    f.expectProbe();
    expect(f.build).toHaveBeenCalledTimes(1);
    expect(f.rate).toHaveBeenCalledExactlyOnceWith("agnes", "video");
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.submit.mock.calls[0]?.[8]).toMatchObject({ role: "media-submit" });
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    expect(f.fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
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
