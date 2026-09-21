import { describe, expect, it, vi } from "vitest";
import { buildPavoWebTaskPayload, queryPavoWebTask, resolvePavoWebBaseUrl, submitPavoWebTask } from "./bridge";
import { PAVO_WEB_BRIDGE_INSTANCE_ID } from "../catalog/pavoWeb";

describe("Pavo Web bridge", () => {
  it("accepts only loopback HTTP bridge URLs", () => {
    expect(resolvePavoWebBaseUrl("http://127.0.0.1:3458/")).toBe("http://127.0.0.1:3458");
    expect(() => resolvePavoWebBaseUrl("https://example.com")).toThrow(/只允许连接本机/);
  });

  it("requires an idempotency key before building a real task", async () => {
    await expect(buildPavoWebTaskPayload({
      kind: "text_to_video",
      prompt: "test",
      extras: { modelKey: "pavo-agnes-video-2.5-flash" },
    })).rejects.toThrow(/缺少幂等标识/);
  });

  it("maps Agnes Flash controls and references to the extension contract", async () => {
    const payload = await buildPavoWebTaskPayload({
      kind: "image_to_video",
      prompt: "人物转身走向窗边",
      extras: {
        idempotencyKey: "grant-1",
        modelKey: "pavo-agnes-video-2.5-flash",
        firstFrameUrl: "data:image/png;base64,aGVsbG8=",
        aspect_ratio: "9:16",
        duration: "10",
        size: "720P",
      },
    });
    expect(payload).toMatchObject({
      idempotencyKey: "grant-1",
      mediaType: "video",
      expectedResultCount: 1,
      modelConfig: {
        model: "Agnes Video 2.5 Flash",
        referenceMode: "首尾帧",
        aspectRatio: "9:16",
        duration: "10s",
        resolution: "720P",
      },
    });
    expect(payload.referenceFiles).toHaveLength(1);
  });

  it("submits through a compatible connected Pavo bridge", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/")) {
        return new Response(JSON.stringify({
          name: "Pavo Web Task Bridge",
          instanceId: PAVO_WEB_BRIDGE_INSTANCE_ID,
          sseClients: 1,
          taskStore: { total: 0 },
        }), { status: 200 });
      }
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ taskCodes: ["PAVO-1"] }), { status: 200 });
    }) as typeof fetch;
    const result = await submitPavoWebTask({
      request: {
        kind: "text_to_video",
        prompt: "test",
        extras: { idempotencyKey: "grant-1", modelKey: "pavo-agnes-video-2.5-flash" },
      },
      fetchImpl,
    });
    expect(result.taskCode).toBe("PAVO-1");
  });

  it("downloads a completed result and writes it to the project asset store", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/api/tasks")) {
        return new Response(JSON.stringify({ tasks: [{ taskCode: "PAVO-1", status: "completed" }] }), { status: 200 });
      }
      if (href.includes("/api/files?")) {
        return new Response(JSON.stringify({
          files: [{ fileId: "F1", taskCode: "PAVO-1", filename: "result.mp4", mimeType: "video/mp4" }],
        }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
    }) as typeof fetch;
    const writeAsset = vi.fn(() => ({ id: "asset-1", name: "result.mp4", data: { url: "nomi-local://result.mp4" } }));
    const result = await queryPavoWebTask({
      taskCode: "PAVO-1",
      request: { kind: "text_to_video", prompt: "test", extras: {} },
      projectId: "project-1",
      nodeId: "node-1",
      writeAsset,
      fetchImpl,
    });
    expect(result.status).toBe("succeeded");
    expect(result.assets[0]).toMatchObject({ type: "video", url: "nomi-local://result.mp4", assetId: "asset-1" });
    expect(writeAsset).toHaveBeenCalledOnce();
  });
});
