import { describe, expect, it, vi } from "vitest";
import {
  buildJimengWebTaskPayload,
  probeJimengWebServer,
  queryJimengWebTask,
  resolveJimengWebBaseUrl,
} from "./seedanceBridge";
import { JIMENG_WEB_BRIDGE_INSTANCE_ID } from "../catalog/jimengWeb";
import type { TaskRequest } from "../runtime";

const pngDataUrl = "data:image/png;base64,iVBORw0KGgo=";

describe("jimengWeb seedance bridge", () => {
  it("把 Nomi 档案输入转换成扩展服务器任务 payload", async () => {
    const request: TaskRequest = {
      kind: "image_to_video",
      prompt: "咖啡杯旋转展示",
      extras: {
        archetypeInput: {
          dreamina_cmd: "frames2video",
          frames_first: pngDataUrl,
          frames_last: pngDataUrl,
          ratio: "9:16",
          duration: 4,
          model: "seedance2.0fast",
        },
      },
    };

    const payload = await buildJimengWebTaskPayload(request);

    expect(payload).toMatchObject({
      prompt: "咖啡杯旋转展示",
      realSubmit: true,
      modelConfig: {
        model: "Seedance 2.0 Fast",
        referenceMode: "首尾帧",
        aspectRatio: "9:16",
        duration: "4s",
      },
    });
    expect(payload.referenceFiles).toHaveLength(1);
    expect(payload.referenceFiles[0]).toMatchObject({ fileType: "image/png", base64: pngDataUrl });
  });

  it("查询到 completed + 文件后下载视频并写成 Nomi asset", async () => {
    const fetchImpl = vi.fn(async (url: string, _options?: RequestInit) => {
      if (url.endsWith("/api/tasks")) {
        return new Response(
          JSON.stringify({
            success: true,
            tasks: [{ taskCode: "SD-1", status: "completed" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/files?taskCode=SD-1")) {
        return new Response(
          JSON.stringify({
            success: true,
            files: [
              {
                fileId: "F0001",
                taskCode: "SD-1",
                quality: "hd",
                filename: "out.mp4",
                mimeType: "video/mp4",
                uploadedAt: "2026-07-04T00:00:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/files/F0001")) {
        return new Response(Buffer.from("mp4"), { status: 200, headers: { "content-type": "video/mp4" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;
    const writeAsset = vi.fn(() => ({ id: "asset-1", name: "out.mp4", data: { url: "nomi-local://asset/p/out.mp4" } }));

    const result = await queryJimengWebTask({
      taskCode: "SD-1",
      request: { kind: "text_to_video", prompt: "x", extras: {} },
      projectId: "p",
      nodeId: "n",
      serverUrl: "http://127.0.0.1:3456",
      writeAsset,
      fetchImpl,
    });

    expect(result.status).toBe("succeeded");
    expect(result.assets[0]).toMatchObject({ type: "video", url: "nomi-local://asset/p/out.mp4", assetId: "asset-1" });
    expect(writeAsset).toHaveBeenCalledWith(
      "p",
      Buffer.from("mp4"),
      "out.mp4",
      "video/mp4",
      expect.objectContaining({
        generator: "jimeng-web",
        ownerNodeId: "n",
        jimengTaskCode: "SD-1",
        sourceFileId: "F0001",
      }),
    );
    for (const [, options] of fetchImpl.mock.calls) {
      expect(new Headers((options as RequestInit | undefined)?.headers).get("X-Nomi-Token")).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("completed 后文件列表短暂为空时会重试同步", async () => {
    let fileListCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tasks")) {
        return new Response(
          JSON.stringify({
            success: true,
            tasks: [{ taskCode: "SD-2", status: "completed" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/files?taskCode=SD-2")) {
        fileListCalls += 1;
        return new Response(
          JSON.stringify({
            success: true,
            files:
              fileListCalls === 1
                ? []
                : [
                    {
                      fileId: "F0002",
                      taskCode: "SD-2",
                      quality: "standard",
                      filename: "late.mp4",
                      mimeType: "video/mp4",
                      uploadedAt: "2026-07-04T00:00:01.000Z",
                    },
                  ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/files/F0002")) {
        return new Response(Buffer.from("late-mp4"), { status: 200, headers: { "content-type": "video/mp4" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;
    const writeAsset = vi.fn(() => ({
      id: "asset-2",
      name: "late.mp4",
      data: { url: "nomi-local://asset/p/late.mp4" },
    }));

    const result = await queryJimengWebTask({
      taskCode: "SD-2",
      request: { kind: "text_to_video", prompt: "x", extras: {} },
      projectId: "p",
      nodeId: "n",
      serverUrl: "http://127.0.0.1:3456",
      writeAsset,
      fetchImpl,
      fileReadyRetryAttempts: 2,
      fileReadyRetryDelayMs: 0,
    });

    expect(fileListCalls).toBe(2);
    expect(result.status).toBe("succeeded");
    expect(result.assets[0]).toMatchObject({ type: "video", url: "nomi-local://asset/p/late.mp4", assetId: "asset-2" });
  });

  it("只允许本机扩展桥地址", () => {
    expect(resolveJimengWebBaseUrl()).toBe("http://127.0.0.1:3457");
    expect(resolveJimengWebBaseUrl("http://localhost:3456/")).toBe("http://localhost:3456");
    expect(() => resolveJimengWebBaseUrl("https://example.com")).toThrow(/只允许连接本机/);
  });

  it("只把带 Nomi 实例标识的 Seedance 服务判定为可用", async () => {
    const compatibleFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            name: "Seedance 任务 Mock API",
            version: "3.3.0",
            instanceId: JIMENG_WEB_BRIDGE_INSTANCE_ID,
            sseClients: 1,
            taskStore: { total: 2 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;
    const foreignFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            name: "Seedance 任务 Mock API",
            version: "3.3.0",
            instanceId: "fimer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    await expect(probeJimengWebServer(undefined, compatibleFetch)).resolves.toMatchObject({
      ok: true,
      reachable: true,
      instanceId: JIMENG_WEB_BRIDGE_INSTANCE_ID,
      taskTotal: 2,
    });
    await expect(probeJimengWebServer(undefined, foreignFetch)).resolves.toMatchObject({
      ok: false,
      reachable: true,
      instanceId: "fimer",
    });
  });
});
