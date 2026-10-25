/**
 * Real-platform fixture, production-generic implementation:
 * fal.ai official queue OpenAPI, fetched 2026-08-15 from
 * https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/wan/v2.2-a14b/image-to-video
 *
 * Platform names and endpoint paths deliberately live only in this test. The runner only provides
 * generic request + poll helpers; no provider branch is allowed in production code.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestJson } = vi.hoisted(() => ({ requestJson: vi.fn() }));

vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

vi.mock("../vendor/vendorHttp", async (importOriginal) => ({
  ...await importOriginal<typeof import('../vendor/vendorHttp')>(),
  requestJson,
  requestMultipart: vi.fn(),
  vendorResponseLimitForKind: () => 8 * 1024 * 1024,
}));

import { CustomCallScriptError, runCustomCallScript } from "./customCallRunner";
import { VendorRequestError } from '../vendor/vendorHttp';
import type { Model, Vendor } from "./types";

const vendor = {
  key: "fixture-platform",
  name: "Fixture platform",
  baseUrlHint: "https://queue.fal.run",
  enabled: true,
  authType: "none",
} as Vendor;

const model = {
  vendorKey: vendor.key,
  modelKey: "fal-ai/wan/v2.2-a14b/image-to-video",
  labelZh: "WAN 2.2 A14B",
  kind: "video",
  enabled: true,
  createdAt: "",
  updatedAt: "",
} as Model;

describe("generic custom call runner × real fal.ai queue fixture", () => {
  beforeEach(() => { requestJson.mockReset(); });
  it("covers submit -> status queue/progress/completed -> result, including first/last frame and Key auth", async () => {
    const statusValues = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
    requestJson.mockImplementation(async (_vendor, _apiKey, method: string, url: string) => {
      if (method === "POST") return { request_id: "req-123", status: "IN_QUEUE" };
      if (url.endsWith("/status")) return { request_id: "req-123", status: statusValues.shift() };
      return { video: { url: "https://cdn.example.test/final.mp4" }, seed: 42 };
    });

    const script = `const endpoint = '/fal-ai/wan/v2.2-a14b/image-to-video'
const headers = { Authorization: 'Key ' + apiKey }
const task = await request({
  method: 'POST', url: endpoint, headers,
  body: { prompt, image_url: references.firstFrame, end_image_url: references.lastFrame },
})
await poll(
  () => request({ method: 'GET', url: endpoint + '/requests/' + task.request_id + '/status', headers }),
  (state) => state.status === 'COMPLETED' ? true : null,
  { intervalMs: 500, timeoutMs: 5000 },
)
const result = await request({ method: 'GET', url: endpoint + '/requests/' + task.request_id, headers })
return result.video.url`;

    const result = await runCustomCallScript({
      vendor,
      model,
      apiKey: "fixture-secret",
      script,
      prompt: "camera pushes in",
      params: {
        first_frame_url: "https://assets.example.test/first.png",
        last_frame_url: "https://assets.example.test/last.png",
      },
      taskKind: "image_to_video",
      modeId: "firstlast",
      timeoutMs: 6000,
    });

    expect(result.assets).toEqual(["https://cdn.example.test/final.mp4"]);
    expect(requestJson).toHaveBeenCalledTimes(5);
    expect(requestJson.mock.calls.map(call => (call[8] as { role: string }).role))
      .toEqual(['media-submit', 'query', 'query', 'query', 'query']);
    const submit = requestJson.mock.calls[0];
    expect(submit[2]).toBe("POST");
    expect(submit[4]).toEqual({ Authorization: "Key fixture-secret" });
    expect(submit[6]).toMatchObject({
      prompt: "camera pushes in",
      image_url: "https://assets.example.test/first.png",
      end_image_url: "https://assets.example.test/last.png",
    });
  }, 10000);

  it('retains the real structured error identity, redacts secrets and never resubmits an unknown submission', async () => {
    requestJson.mockRejectedValueOnce(new VendorRequestError('fixture-secret submission outcome unknown', {
      vendorKey: vendor.key, method: 'POST', url: 'https://queue.fal.run/?key=fixture-secret',
      upstreamMsg: 'fixture-secret connection lost', category: 'submission-unknown', retryable: false,
    }));
    const error = await runCustomCallScript({ vendor, model, apiKey: 'fixture-secret',
      script: "return await request({ method: 'POST', url: '/submit', body: { prompt } })", prompt: 'x', params: {}, taskKind: 'text_to_video',
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(CustomCallScriptError);
    const cause = (error as CustomCallScriptError).causeError as VendorRequestError;
    expect(cause).toBeInstanceOf(VendorRequestError);
    expect(cause.structured).toMatchObject({ category: 'submission-unknown', retryable: false, method: 'POST' });
    expect(JSON.stringify({ message: (error as Error).message, cause: cause.structured, transcript: (error as CustomCallScriptError).transcript })).not.toContain('fixture-secret');
    expect(requestJson).toHaveBeenCalledOnce();
  });
});
