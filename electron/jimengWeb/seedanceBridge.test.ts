import { describe, expect, it, vi } from "vitest";
import {
  buildJimengWebTaskPayload,
  probeJimengWebServer,
  queryJimengWebTask,
  resolveJimengWebBaseUrl,
  submitJimengWebTask,
} from "./seedanceBridge";
import { JIMENG_WEB_BRIDGE_INSTANCE_ID } from "../catalog/jimengWeb";
import type { TaskRequest } from "../runtime";

const pngDataUrl = "data:image/png;base64,iVBORw0KGgo=";
const mp4DataUrl = "data:video/mp4;base64,AAAAHGZ0eXBpc29t";
const mp3DataUrl = "data:audio/mpeg;base64,SUQzBAAAAAA=";

describe("jimengWeb seedance bridge", () => {
  it("把 Nomi 档案输入转换成扩展服务器任务 payload", async () => {
    const request: TaskRequest = {
      kind: "image_to_video",
      prompt: "咖啡杯旋转展示",
      extras: {
        idempotencyKey: "run-video-1",
        archetypeInput: {
          dreamina_cmd: "frames2video",
          frames_first: pngDataUrl,
          frames_last: pngDataUrl,
          ratio: "9:16",
          duration: 4,
          model: "jimeng-seedance-2.0-vip",
          video_resolution: "4K",
          generation_count: 3,
        },
      },
    };

    const payload = await buildJimengWebTaskPayload(request);

    expect(payload).toMatchObject({
      idempotencyKey: "run-video-1",
      mediaType: "video",
      expectedResultCount: 1,
      prompt: "咖啡杯旋转展示",
      realSubmit: true,
      modelConfig: {
        model: "即梦 Seedance 2.0 VIP",
        referenceMode: "首尾帧",
        aspectRatio: "9:16",
        resolution: "4K",
        count: 1,
        duration: "4s",
      },
    });
    expect(payload.referenceFiles).toHaveLength(1);
    expect(payload.referenceFiles[0]).toMatchObject({ fileType: "image/png", base64: pngDataUrl });
  });

  it("把文生图请求转换成图片页任务，不携带视频时长或参考模式", async () => {
    const payload = await buildJimengWebTaskPayload({
      kind: "text_to_image",
      prompt: "夏日咖啡馆海报",
      extras: {
        archetypeInput: {
          model: "jimeng-image-5.0-pro",
          ratio: "9:16",
          resolution_type: "4K",
          generation_count: 4,
        },
      },
    });

    expect(payload).toMatchObject({
      mediaType: "image",
      expectedResultCount: 4,
      prompt: "夏日咖啡馆海报",
      modelConfig: {
        model: "图片 5.0 Pro",
        aspectRatio: "9:16",
        resolution: "4K",
        count: 4,
      },
      referenceFiles: [],
    });
    expect(payload.modelConfig).not.toHaveProperty("duration");
    expect(payload.modelConfig).not.toHaveProperty("referenceMode");
  });

  it("把改图输入保留为图片参考文件", async () => {
    const payload = await buildJimengWebTaskPayload({
      kind: "image_edit",
      prompt: "保持主体，改成黄昏光线",
      extras: {
        archetypeInput: {
          input_images: [pngDataUrl],
          ratio: "3:4",
        },
      },
    });

    expect(payload.mediaType).toBe("image");
    expect(payload.expectedResultCount).toBe(1);
    expect(payload.modelConfig.count).toBe(1);
    expect(payload.referenceFiles).toEqual([
      expect.objectContaining({
        fileName: "图片1.png",
        fileType: "image/png",
        base64: pngDataUrl,
      }),
    ]);
  });

  it("兼容单张 image 字段作为改图参考", async () => {
    const payload = await buildJimengWebTaskPayload({
      kind: "image_edit",
      prompt: "保留构图，替换背景",
      extras: {
        archetypeInput: {
          image: pngDataUrl,
        },
      },
    });

    expect(payload.mediaType).toBe("image");
    expect(payload.referenceFiles).toEqual([
      expect.objectContaining({
        fileName: "图片1.png",
        fileType: "image/png",
        base64: pngDataUrl,
      }),
    ]);
  });

  it("全能参考同时保留图片和视频素材类型", async () => {
    const request: TaskRequest = {
      kind: "image_to_video",
      prompt: "参考视频运镜，保持图片中的人物身份",
      extras: {
        archetypeInput: {
          dreamina_cmd: "multimodal2video",
          mm_images: [pngDataUrl],
          mm_videos: [mp4DataUrl],
          ratio: "9:16",
          duration: 5,
          model: "seedance2.0fast",
        },
      },
    };

    const payload = await buildJimengWebTaskPayload(request);

    expect(payload.referenceFiles).toEqual([
      expect.objectContaining({
        fileName: "图片1.png",
        fileType: "image/png",
        base64: pngDataUrl,
      }),
      expect.objectContaining({
        fileName: "视频1.mp4",
        fileType: "video/mp4",
        base64: mp4DataUrl,
      }),
    ]);
  });

  it("全能参考把图片用途转换成即梦可识别的 @mention", async () => {
    const payload = await buildJimengWebTaskPayload({
      kind: "image_to_video",
      prompt: "character1 把道具递给 character2，镜头横向跟随",
      extras: {
        modelKey: "jimeng-web-seedance-2.0",
        referenceImageRoles: [
          "角色老板的身份和服装参考",
          "分镜图，只参考机位与动作意图，不作为首帧",
        ],
        archetypeInput: {
          dreamina_cmd: "multimodal2video",
          mm_images: [
            "data:image/png;base64,iVBORw0KGgo=",
            "data:image/png;base64,iVBORw0KGgp=",
          ],
          ratio: "9:16",
          duration: 5,
        },
      },
    });

    expect(payload.modelConfig.referenceMode).toBe("全能参考");
    expect(payload.prompt).toContain("(@图片1) 把道具递给 (@图片2)");
    expect(payload.prompt).toContain("(@图片1)：角色老板的身份和服装参考");
    expect(payload.prompt).toContain("(@图片2)：分镜图，只参考机位与动作意图，不作为首帧");
    expect(payload.prompt).toContain("不得把分镜图默认锁成首帧");
  });

  it("Web 扩展收到音频参考时明确提示改用即梦 CLI", async () => {
    const request: TaskRequest = {
      kind: "image_to_video",
      prompt: "参考音乐节奏生成视频",
      extras: {
        archetypeInput: {
          dreamina_cmd: "multimodal2video",
          mm_images: [pngDataUrl],
          mm_audios: [mp3DataUrl],
        },
      },
    };

    await expect(buildJimengWebTaskPayload(request)).rejects.toThrow(
      /即梦 Web 扩展暂不支持音频参考.*即梦 CLI/,
    );
  });

  it("查询到 completed + 文件后下载视频并写成 Nomi asset", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
      const url = String(input);
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
    });
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
      'video',
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

  it("查询到图片文件后写成 Nomi image asset", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tasks")) {
        return new Response(
          JSON.stringify({ success: true, tasks: [{ taskCode: "IMG-1", status: "completed" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/files?taskCode=IMG-1")) {
        return new Response(
          JSON.stringify({
            success: true,
            files: [
              {
                fileId: "FIMG1",
                taskCode: "IMG-1",
                quality: "standard-1",
                filename: "result-1.png",
                mimeType: "image/png",
                uploadedAt: "2026-07-17T00:00:00.000Z",
              },
              {
                fileId: "FIMG2",
                taskCode: "IMG-1",
                quality: "standard-2",
                filename: "result-2.png",
                mimeType: "image/png",
                uploadedAt: "2026-07-17T00:00:01.000Z",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/files/FIMG1")) {
        return new Response(Buffer.from("png-1"), { status: 200, headers: { "content-type": "image/png" } });
      }
      if (url.endsWith("/api/files/FIMG2")) {
        return new Response(Buffer.from("png-2"), { status: 200, headers: { "content-type": "image/png" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;
    const writeAsset = vi.fn((_projectId: string, _bytes: Buffer, fileName: string) => ({
      id: `asset-${fileName}`,
      name: fileName,
      data: { url: `nomi-local://asset/p/${fileName}` },
    }));

    const result = await queryJimengWebTask({
      taskCode: "IMG-1",
      request: { kind: "text_to_image", prompt: "x", extras: {} },
      projectId: "p",
      nodeId: "n",
      serverUrl: "http://127.0.0.1:3456",
      writeAsset,
      fetchImpl,
    });

    expect(result.status).toBe("succeeded");
    expect(result.assets[0]).toMatchObject({
      type: "image",
      url: "nomi-local://asset/p/result-1.png",
      assetId: "asset-result-1.png",
    });
    expect(result.assets).toHaveLength(2);
    expect(result.assets[1]).toMatchObject({
      type: "image",
      url: "nomi-local://asset/p/result-2.png",
      assetId: "asset-result-2.png",
    });
    expect(writeAsset).toHaveBeenCalledWith(
      "p",
      Buffer.from("png-1"),
      "result-1.png",
      "image/png",
      expect.objectContaining({ generator: "jimeng-web", jimengTaskCode: "IMG-1" }),
      'image',
    );
  });

  it("失败任务把扩展桥真实错误提到 raw 顶层，避免 UI 误报额度", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tasks")) {
        return new Response(
          JSON.stringify({
            success: true,
            tasks: [{
              taskCode: "IMG-FAILED",
              status: "failed",
              error: "图片结果同步失败：Failed to fetch",
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/files?taskCode=IMG-FAILED")) {
        return new Response(
          JSON.stringify({ success: true, files: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    const result = await queryJimengWebTask({
      taskCode: "IMG-FAILED",
      request: { kind: "image_edit", prompt: "x", extras: {} },
      projectId: "p",
      nodeId: "n",
      serverUrl: "http://127.0.0.1:3456",
      writeAsset: vi.fn(),
      fetchImpl,
    });

    expect(result.status).toBe("failed");
    expect(result.raw).toMatchObject({
      error: "即梦 Web 网页桥任务失败：图片结果同步失败：Failed to fetch",
      errorStage: "web-bridge",
      jimengWeb: {
        error: "图片结果同步失败：Failed to fetch",
      },
    });
  });

  it("官网已提交但仍在等待回收时保持 running，不会被上层当失败后重新生成", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tasks")) {
        return new Response(
          JSON.stringify({
            success: true,
            tasks: [{
              taskCode: "VIDEO-WAITING",
              status: "awaiting_result",
              error: "已超常规时长，继续等待",
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/files?taskCode=VIDEO-WAITING")) {
        return new Response(
          JSON.stringify({ success: true, files: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    const result = await queryJimengWebTask({
      taskCode: "VIDEO-WAITING",
      request: { kind: "image_to_video", prompt: "x", extras: {} },
      projectId: "p",
      nodeId: "n",
      serverUrl: "http://127.0.0.1:3456",
      writeAsset: vi.fn(),
      fetchImpl,
    });

    expect(result.status).toBe("running");
    expect(result.assets).toEqual([]);
  });

  it("只允许本机扩展桥地址", () => {
    expect(resolveJimengWebBaseUrl()).toBe("http://127.0.0.1:3457");
    expect(resolveJimengWebBaseUrl("http://localhost:3456/")).toBe("http://localhost:3456");
    expect(() => resolveJimengWebBaseUrl("https://example.com")).toThrow(/只允许连接本机/);
  });

  it("提交前要求扩展运行器已连接，避免任务进入无人消费的队列", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({
        name: "Seedance 任务 Mock API",
        version: "3.3.0",
        instanceId: JIMENG_WEB_BRIDGE_INSTANCE_ID,
        sseClients: 0,
        taskStore: { total: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

    await expect(submitJimengWebTask({
      request: { kind: "text_to_image", prompt: "x", extras: {} },
      fetchImpl,
    })).rejects.toThrow(/扩展运行器未连接/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
