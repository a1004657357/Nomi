import { describe, expect, it, vi } from "vitest";
import { buildPavoWebTaskPayload, probePavoWebServer, queryPavoWebTask, resolvePavoWebBaseUrl, submitPavoWebTask } from "./bridge";
import { PAVO_WEB_BRIDGE_INSTANCE_ID } from "../catalog/pavoWeb";

describe("Pavo Web bridge", () => {
  it("binds bounded Flash retries to the original canvas owner", async () => {
    const payload = await buildPavoWebTaskPayload({ kind: "image_to_video", prompt: "reference test",
      extras: { idempotencyKey: "owned", projectId: "project-a", nodeId: "node-a" } });
    expect(payload).toMatchObject({ owner: { projectId: "project-a", nodeId: "node-a" }, retryPolicy: { maxAttempts: 3 } });
    const ownerless = await buildPavoWebTaskPayload({ kind: "text_to_video", prompt: "test", extras: { idempotencyKey: "ownerless" } });
    expect(ownerless.retryPolicy).toBeUndefined();
  });
  it("does not collect a stale attempt file or write a result into a different original node", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).includes('/api/files?')
      ? Response.json({files:[{fileId:'old',taskCode:'root',attemptTaskCode:'root',mimeType:'video/mp4'}]})
      : Response.json({task:{taskCode:'root',attemptTaskCode:'retry',status:'completed',pavoConversationId:'c',syncedFileCount:1,owner:{projectId:'p',nodeId:'n'}}})) as typeof fetch;
    const writeAsset=vi.fn();
    const args={taskCode:'root',request:{kind:'text_to_video' as const,prompt:'test',extras:{}},projectId:'p',nodeId:'n',writeAsset,fetchImpl};
    expect((await queryPavoWebTask(args)).status).toBe('running');
    await expect(queryPavoWebTask({...args,nodeId:'different'})).rejects.toThrow(/归属/);
    expect(writeAsset).not.toHaveBeenCalled();
  });
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
          safetyContractVersion: 1,
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
      if (href.endsWith("/api/tasks/PAVO-1")) {
        return new Response(JSON.stringify({ task: { taskCode: "PAVO-1", status: "completed", pavoConversationId: "C1", syncedFileCount: 1 } }), { status: 200 });
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

  it("rejects older bridges even when their instance ID matches", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ name: "Pavo Web Task Bridge", instanceId: PAVO_WEB_BRIDGE_INSTANCE_ID })) as typeof fetch;
    expect((await probePavoWebServer(undefined, fetchImpl)).ok).toBe(false);
  });

  it.each(["6", "15"])("rejects unsupported Pavo duration %s before submission", async (duration) => {
    await expect(buildPavoWebTaskPayload({ kind: "text_to_video", prompt: "test", extras: { idempotencyKey: "test", duration } })).rejects.toThrow(/时长/);
  });

  it("maps image tasks to the image media contract with clamped count", async () => {
    const payload = await buildPavoWebTaskPayload({
      kind: "text_to_image",
      prompt: "赛博都市夜景",
      extras: {
        idempotencyKey: "grant-img-1",
        modelKey: "pavo-web-image",
        generation_count: 9,
        input_images: ["data:image/png;base64,aGVsbG8="],
        aspect_ratio: "1:1",
      },
    });
    expect(payload).toMatchObject({
      idempotencyKey: "grant-img-1",
      mediaType: "image",
      expectedResultCount: 4,
      modelConfig: { count: 4, aspectRatio: "1:1" },
    });
    expect(payload.modelConfig.model).toBeUndefined();
    expect(payload.referenceFiles).toHaveLength(1);
  });

  it("rejects malformed image ratio before submission", async () => {
    await expect(buildPavoWebTaskPayload({
      kind: "text_to_image",
      prompt: "test",
      extras: { idempotencyKey: "g", aspect_ratio: "超宽" },
    })).rejects.toThrow(/比例格式无效/);
  });

  it("rejects unsupported task kinds instead of guessing video", async () => {
    await expect(buildPavoWebTaskPayload({
      kind: "text_to_audio",
      prompt: "test",
      extras: { idempotencyKey: "g" },
    })).rejects.toThrow(/不支持该生成类型/);
  });

  it("collects every image result instead of dropping extras", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/api/tasks/PAVO-IMG")) {
        return new Response(JSON.stringify({ task: { taskCode: "PAVO-IMG", status: "completed", pavoConversationId: "C9", syncedFileCount: 2 } }), { status: 200 });
      }
      if (href.includes("/api/files?")) {
        return new Response(JSON.stringify({
          files: [
            { fileId: "F2", taskCode: "PAVO-IMG", filename: "b.png", mimeType: "image/png", uploadedAt: "2026-10-20T02:00:00Z" },
            { fileId: "F1", taskCode: "PAVO-IMG", filename: "a.png", mimeType: "image/png", uploadedAt: "2026-10-20T01:00:00Z" },
            { fileId: "F3", taskCode: "PAVO-IMG", filename: "noise.mp4", mimeType: "video/mp4", uploadedAt: "2026-10-20T03:00:00Z" },
          ],
        }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    const writeAsset = vi.fn(() => ({ id: "asset-img", name: "a.png", data: { url: "nomi-local://a.png" } }));
    const result = await queryPavoWebTask({
      taskCode: "PAVO-IMG",
      request: { kind: "text_to_image", prompt: "test", extras: {} },
      projectId: "project-1",
      nodeId: "node-1",
      writeAsset,
      fetchImpl,
    });
    expect(result.status).toBe("succeeded");
    expect(result.assets).toHaveLength(2);
    expect(result.assets.every(asset => asset.type === "image")).toBe(true);
    expect(writeAsset).toHaveBeenCalledTimes(2);
    // 混进来的视频文件不得计入图片结果
    expect(result.raw).toMatchObject({pavoWeb:{pickedFileIds:["F1", "F2"]}});
  });

  it("rejects video bytes served for an image task", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/api/tasks/")) return Response.json({ task: { taskCode: "PAVO-IMG", status: "completed", pavoConversationId: "C9", syncedFileCount: 1 } });
      if (href.includes("/api/files?")) return Response.json({ files: [{ fileId: "F1", taskCode: "PAVO-IMG", mimeType: "image/png" }] });
      return new Response(new Uint8Array([1]), { headers: { "content-type": "video/mp4" } });
    }) as typeof fetch;
    const writeAsset = vi.fn();
    await expect(queryPavoWebTask({ taskCode: "PAVO-IMG", request: { kind: "text_to_image", prompt: "test" }, projectId: "project-1", writeAsset, fetchImpl })).rejects.toThrow(/不是图片/);
    expect(writeAsset).not.toHaveBeenCalled();
  });

  it.each(["pending", "awaiting_result", "completed"])("does not resubmit or import unbound %s tasks", async (status) => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      return String(url).includes("/api/tasks/")
        ? Response.json({ task: { taskCode: "PAVO-1", status } })
        : Response.json({ files: [{ fileId: "other", taskCode: "PAVO-2", mimeType: "video/mp4" }] });
    }) as typeof fetch;
    const writeAsset = vi.fn();
    const result = await queryPavoWebTask({ taskCode: "PAVO-1", request: { kind: "text_to_video", prompt: "test" }, projectId: "project-1", writeAsset, fetchImpl });
    expect(result.status).toBe(status === "pending" ? "queued" : "running");
    expect(writeAsset).not.toHaveBeenCalled();
  });

  it.each(["text/html", "video/mp4"])("rejects invalid downloaded output (%s)", async (mime) => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/api/tasks/")) return Response.json({ task: { taskCode: "PAVO-1", status: "completed", pavoConversationId: "C1", syncedFileCount: 1 } });
      if (href.includes("/api/files?")) return Response.json({ files: [{ fileId: "F1", taskCode: "PAVO-1", mimeType: "video/mp4" }] });
      return new Response(mime === "text/html" ? "login required" : new Uint8Array(), { headers: { "content-type": mime } });
    }) as typeof fetch;
    const writeAsset = vi.fn();
    await expect(queryPavoWebTask({ taskCode: "PAVO-1", request: { kind: "text_to_video", prompt: "test" }, projectId: "project-1", writeAsset, fetchImpl })).rejects.toThrow(/视频|为空/);
    expect(writeAsset).not.toHaveBeenCalled();
  });
});
