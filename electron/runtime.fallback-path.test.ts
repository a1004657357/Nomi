/**
 * runTask 的 image/video **fallback 路径**（无 curated mapping 时走的
 * `/v1/{images,videos}/generations` OpenAI 兼容形状）回归。覆盖两个机制审计 P1：
 *
 *  #1 结构化 vendor 错误只覆盖 profile 一条出口：fallback 路径此前用本地 postJson 抛
 *     **裸 Error**（无 httpStatus/category/retryable），下游人话错误卡只能正则反猜。
 *     → fallback 现在与 profile 路径同源走 requestJson，抛结构化 VendorRequestError。
 *
 *  #2 vendor.meta.extraHeaders 到不了 profile/fallback 路径：relay/代理网关自定义鉴权头
 *     此前只在文本/AI-SDK 路径注入。→ 现在也透传进 HTTP 请求头。
 *
 * 用临时 settings 目录 + 明文 safeStorage mock 起一份真实 catalog（vendor+model，
 * 故意不建 mapping 以走 fallback），stub 全局 fetch 抓请求头/构造错误响应。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const codexImagegenRunnerMock = vi.hoisted(() => ({
  runCodexImageGeneration: vi.fn(),
}));

const jimengWebRunnerMock = vi.hoisted(() => ({
  start: vi.fn(),
  submit: vi.fn(),
}));

const reviewTraceMock = vi.hoisted(() => ({
  scheduleTechnicalReview: vi.fn(),
}));

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

vi.mock("./ai/codexImagegenRunner", () => ({
  runCodexImageGeneration: codexImagegenRunnerMock.runCodexImageGeneration,
}));

vi.mock("./jimengWeb/runner", () => ({
  jimengWebStartRunner: jimengWebRunnerMock.start,
}));

vi.mock("./jimengWeb/seedanceBridge", () => ({
  submitJimengWebTask: jimengWebRunnerMock.submit,
}));

vi.mock("./review/reviewTrace", () => ({
  scheduleTechnicalReview: reviewTraceMock.scheduleTechnicalReview,
}));

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

const stubFetch = (impl: () => Promise<Response> | Response) => {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => impl());
  vi.stubGlobal("fetch", fn);
  return fn;
};

beforeEach(() => {
  mockedUserDataRoot = makeTempDir("nomi-runtime-fallback-");
  codexImagegenRunnerMock.runCodexImageGeneration.mockReset();
  jimengWebRunnerMock.start.mockReset();
  jimengWebRunnerMock.start.mockResolvedValue({ clientOnline: true });
  jimengWebRunnerMock.submit.mockReset();
  reviewTraceMock.scheduleTechnicalReview.mockReset();
  jimengWebRunnerMock.submit.mockResolvedValue({
    taskCode: "SD-TEST-1",
    serverUrl: "http://127.0.0.1:3457",
    payload: { mediaType: "image", expectedResultCount: 4 },
    raw: { taskCodes: ["SD-TEST-1"] },
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 建一个走 fallback 路径的 image 供应商：有 vendor + key + image model，但**没有 mapping**。
// extraHeaders 经 manual 表单存在 vendor.meta.extraHeaders（与生产同形）。
async function seedFallbackImageVendor(): Promise<void> {
  const store = await import("./catalog/catalogStore");
  store.upsertModelCatalogVendor({
    key: "relay",
    name: "中转站",
    enabled: true,
    authType: "bearer",
    baseUrlHint: "https://relay.example.com/v1",
    meta: { extraHeaders: { "HTTP-Referer": "https://nomi.app", "X-Title": "Nomi" } },
  });
  store.upsertModelCatalogVendorApiKey("relay", { apiKey: "sk-relay" });
  store.upsertModelCatalogModel({ vendorKey: "relay", modelKey: "some-image-model", kind: "image", enabled: true });
}

async function seedAgnesImageVendorWithMapping(): Promise<void> {
  const store = await import("./catalog/catalogStore");
  store.upsertModelCatalogVendor({
    key: "agnes",
    name: "Agnes AI",
    enabled: true,
    authType: "bearer",
    baseUrlHint: "https://apihub.agnes-ai.com",
  });
  store.upsertModelCatalogVendorApiKey("agnes", { apiKey: "sk-agnes" });
  store.upsertModelCatalogModel({
    vendorKey: "agnes",
    modelKey: "agnes-test-image",
    kind: "image",
    enabled: true,
  });
  store.upsertModelCatalogMapping({
    vendorKey: "agnes",
    modelKey: "agnes-test-image",
    taskKind: "text_to_image",
    name: "Agnes image test",
    create: {
      method: "POST",
      path: "/v1/images/generations",
      body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}" },
      response_mapping: { image_url: "data.0.url" },
    },
  });
}

async function seedCodexImg2Model(): Promise<void> {
  const store = await import("./catalog/catalogStore");
  store.upsertModelCatalogVendor({
    key: "codex",
    name: "Codex",
    enabled: true,
    authType: "none",
    baseUrlHint: null,
  });
  store.upsertModelCatalogModel({
    vendorKey: "codex",
    modelKey: "codex-img2",
    labelZh: "Codex Img2（GPT Image 2）",
    kind: "image",
    enabled: true,
    meta: { archetypeId: "gpt-image-2" },
  });
}

async function seedJimengWebModel(): Promise<void> {
  const store = await import("./catalog/catalogStore");
  store.upsertModelCatalogVendor({
    key: "jimeng-web",
    name: "即梦 Web",
    enabled: true,
    authType: "none",
    baseUrlHint: "http://127.0.0.1:3457",
  });
  store.upsertModelCatalogModel({
    vendorKey: "jimeng-web",
    modelKey: "jimeng-web-image",
    labelZh: "即梦 Web 图片",
    kind: "image",
    enabled: true,
    meta: { archetypeId: "jimeng-web-image" },
  });
}

describe("runTask fallback 路径 — 结构化错误 + extraHeaders", () => {
  it("#2 fallback 请求带上 vendor.meta.extraHeaders（网关头到达图片路径）", async () => {
    await seedFallbackImageVendor();
    const fetchFn = stubFetch(() =>
      new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/out.png" }] }), { status: 200 }),
    );
    const { runTask } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const result = await runTask({
      vendor: "relay",
      request: { kind: "text_to_image", prompt: "a cat", extras: { modelKey: "some-image-model", grantId: mintSpendGrant({ nodeIds: [] }) } },
    });
    expect(result.status).toBe("succeeded");

    // 抓 fetch 实际带的 headers。
    const headers = (fetchFn.mock.calls[0]?.[1] as { headers?: Record<string, string> })?.headers || {};
    expect(headers.Authorization).toBe("Bearer sk-relay");
    expect(headers["HTTP-Referer"]).toBe("https://nomi.app");
    expect(headers["X-Title"]).toBe("Nomi");
  }, 15_000);

  it("#1 fallback 路径 HTTP 401 → 抛结构化 VendorRequestError（auth/不可重试），不是裸 Error", async () => {
    await seedFallbackImageVendor();
    stubFetch(() => new Response(JSON.stringify({ message: "invalid api key" }), { status: 401 }));
    const { runTask } = await import("./runtime");
    const { VendorRequestError } = await import("./vendor/vendorHttp");
    const { mintSpendGrant } = await import("./spendGrant");

    const error = await runTask({
      vendor: "relay",
      request: { kind: "text_to_image", prompt: "a cat", extras: { modelKey: "some-image-model", grantId: mintSpendGrant({ nodeIds: [] }) } },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(VendorRequestError);
    expect(error.structured).toMatchObject({ httpStatus: 401, category: "auth", retryable: false });
  });

  it("#1 fallback 路径 HTTP 402 → balance 类别（查表，不是猜）", async () => {
    await seedFallbackImageVendor();
    stubFetch(() => new Response(JSON.stringify({ message: "insufficient balance" }), { status: 402 }));
    const { runTask } = await import("./runtime");
    const { VendorRequestError } = await import("./vendor/vendorHttp");
    const { mintSpendGrant } = await import("./spendGrant");

    const error = await runTask({
      vendor: "relay",
      request: { kind: "text_to_image", prompt: "a cat", extras: { modelKey: "some-image-model", grantId: mintSpendGrant({ nodeIds: [] }) } },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(VendorRequestError);
    expect(error.structured).toMatchObject({ httpStatus: 402, category: "balance", retryable: false });
  });

  it("真实 vendor 出口会写入主进程频率台账，MCP/CLI 不能绕过 Agnes 限制", async () => {
    await seedAgnesImageVendorWithMapping();
    stubFetch(() =>
      new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/agnes.png" }] }), { status: 200 }),
    );
    const { runTask } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const startedAt = Date.now();

    await runTask({
      vendor: "agnes",
      request: {
        kind: "text_to_image",
        prompt: "a cat",
        extras: { modelKey: "agnes-test-image", grantId: mintSpendGrant({ nodeIds: [] }) },
      },
    });

    const ledger = JSON.parse(
      fs.readFileSync(path.join(mockedUserDataRoot, "provider-submission-rate-limits.json"), "utf8"),
    ) as { nextStartByRateKey?: Record<string, number> };
    expect(ledger.nextStartByRateKey?.["agnes:image"]).toBeGreaterThanOrEqual(startedAt + 5_900);
  });
});

describe("runTask · Codex Img2 本地入口", () => {
  it("缺项目上下文时给出明确提示，不走 fallback HTTP 请求", async () => {
    await seedCodexImg2Model();
    const fetchFn = stubFetch(() =>
      new Response(JSON.stringify({ data: [{ url: "https://should-not-be-called.example/out.png" }] }), { status: 200 }),
    );
    const { runTask } = await import("./runtime");

    await expect(runTask({
      vendor: "codex",
      request: { kind: "text_to_image", prompt: "a cat", extras: { modelKey: "codex-img2" } },
    })).rejects.toThrow(/需要先打开并保存到本地项目/);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(codexImagegenRunnerMock.runCodexImageGeneration).not.toHaveBeenCalled();
  });

  it("调用本机 Codex runner 生成图片并落到项目 assets，不走 fallback HTTP", async () => {
    await seedCodexImg2Model();
    const fetchFn = stubFetch(() =>
      new Response(JSON.stringify({ data: [{ url: "https://should-not-be-called.example/out.png" }] }), { status: 200 }),
    );
    const outputTempDir = makeTempDir("nomi-codex-img2-output-");
    const outputPath = path.join(outputTempDir, "result.png");
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.writeFileSync(outputPath, pngBytes);
    codexImagegenRunnerMock.runCodexImageGeneration.mockResolvedValue({
      outputPath,
      tempDir: outputTempDir,
      lastMessage: '{"ok":true,"path":"result.png"}',
      timings: {
        referenceMs: 1,
        promptBuildMs: 2,
        codexExecMs: 3,
        outputVerifyMs: 4,
        totalMs: 10,
        referenceCount: 0,
        cwd: path.join(outputTempDir, "cwd"),
      },
      threadId: "codex-thread-1",
    });
    const { createProject, runTask } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const projectRoot = makeTempDir("nomi-codex-img2-project-");
    const project = createProject({ rootPath: projectRoot, name: "Codex Project", payload: {} });

    const result = await runTask({
      vendor: "codex",
      request: {
        kind: "text_to_image",
        prompt: "a cat",
        extras: { modelKey: "codex-img2", projectId: project.id, nodeId: "node-1", grantId: mintSpendGrant({ nodeIds: ["node-1"] }), aspect_ratio: "9:16" },
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.id).toBe("codex-thread-1");
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({ type: "image", thumbnailUrl: result.assets[0]?.url });
    expect(result.assets[0]?.url).toContain(`nomi-local://asset/${encodeURIComponent(project.id)}/assets/generated/`);
    const relativePath = String(result.assets[0]?.url || "").replace(`nomi-local://asset/${encodeURIComponent(project.id)}/`, "");
    const savedPath = path.join(projectRoot, relativePath);
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(fs.readFileSync(savedPath)).toEqual(pngBytes);
    expect(fs.existsSync(outputTempDir)).toBe(false);
    expect(result.raw).toMatchObject({
      codex: {
        threadId: "codex-thread-1",
        lastMessage: '{"ok":true,"path":"result.png"}',
        timings: { referenceMs: 1, promptBuildMs: 2, codexExecMs: 3, outputVerifyMs: 4, totalMs: 10, referenceCount: 0, assetWriteMs: expect.any(Number), runtimeTotalMs: expect.any(Number) },
      },
    });
    expect(result.provenance).toMatchObject({ provider: "codex", modelKey: "codex-img2", vendorRequestId: "codex-thread-1" });
    expect(codexImagegenRunnerMock.runCodexImageGeneration).toHaveBeenCalledWith({ request: expect.objectContaining({ prompt: "a cat" }) });
    expect(reviewTraceMock.scheduleTechnicalReview).toHaveBeenCalledWith(expect.objectContaining({
      projectId: project.id,
      nodeId: "node-1",
      type: "image",
      expectedAspectRatio: "9:16",
    }));
    expect(jimengWebRunnerMock.start).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("runTask · 即梦 Web 运行器入口", () => {
  it("提交任务前自动启动网页桥，并在客户端上线后只提交一次", async () => {
    await seedJimengWebModel();
    const { createProject, runTask } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const projectRoot = makeTempDir("nomi-jimeng-web-project-");
    const project = createProject({ rootPath: projectRoot, name: "JiMeng Web Project", payload: {} });

    const result = await runTask({
      vendor: "jimeng-web",
      request: {
        kind: "text_to_image",
        prompt: "cinematic coffee shop",
        extras: {
          modelKey: "jimeng-web-image",
          projectId: project.id,
          nodeId: "node-jimeng-1",
          grantId: mintSpendGrant({ nodeIds: ["node-jimeng-1"] }),
        },
      },
    });

    expect(jimengWebRunnerMock.start).toHaveBeenCalledOnce();
    expect(jimengWebRunnerMock.start).toHaveBeenCalledWith("http://127.0.0.1:3457");
    expect(jimengWebRunnerMock.submit).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ id: "SD-TEST-1", status: "queued", assets: [] });
  });
});

// 建一个**异步**供应商（有 create+query mapping），create 返回 taskId 但无 asset → 进 pending(queued)。
async function seedAsyncVideoVendorWithMapping(): Promise<void> {
  const store = await import("./catalog/catalogStore");
  store.upsertModelCatalogVendor({
    key: "asyncv",
    name: "异步视频",
    enabled: true,
    authType: "bearer",
    baseUrlHint: "https://asyncv.example.com",
  });
  store.upsertModelCatalogVendorApiKey("asyncv", { apiKey: "sk-async" });
  store.upsertModelCatalogModel({ vendorKey: "asyncv", modelKey: "vid-model", kind: "video", enabled: true });
  store.upsertModelCatalogMapping({
    vendorKey: "asyncv",
    taskKind: "text_to_video",
    name: "t2v",
    create: { method: "POST", path: "/create", body: { prompt: "{{request.prompt}}" }, response_mapping: { task_id: "data.taskId" } },
    query: { method: "GET", path: "/query", query: { video_id: "{{providerMeta.video_id}}" } },
  });
}

describe("fetchTaskResult — taskCache miss 区分（受理账本 → 集成验证 P1 修复）", () => {
  it("受理过的异步任务在缓存里时正常轮询；对 bogus id 报 task_unknown（两路不混）", async () => {
    await seedAsyncVideoVendorWithMapping();
    // create：返回 taskId，无 asset → queued → 进 pending cache + 受理账本。
    stubFetch(() => new Response(JSON.stringify({ code: 200, data: { taskId: "kie-xyz" } }), { status: 200 }));
    const { runTask, fetchTaskResult } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const created = await runTask({
      vendor: "asyncv",
      request: { kind: "text_to_video", prompt: "a dog", extras: { modelKey: "vid-model", grantId: mintSpendGrant({ nodeIds: [] }) } },
    });
    expect(created.status).toBe("queued");
    expect(created.id).toBe("kie-xyz");

    // 从未受理的 id → task_unknown（不是「追踪丢失」，更不是把它当受理过）。
    const unknown = await fetchTaskResult({ vendor: "asyncv", taskId: "never-existed", taskKind: "text_to_video" });
    expect(unknown.result.status).toBe("failed");
    expect((unknown.result.raw as { code?: string }).code).toBe("task_unknown");

    // 受理过且仍在缓存的 id → 走真实轮询分支（query GET），不是 miss（raw 是 vendor 原始响应，
    // 不带本地 miss code；id 仍是受理时的 taskId 而非合成失败）。
    const polled = await fetchTaskResult({ vendor: "asyncv", taskId: "kie-xyz", taskKind: "text_to_video" });
    const polledCode = (polled.result.raw as { code?: string | number }).code;
    expect(polledCode).not.toBe("task_unknown");
    expect(polledCode).not.toBe("task_tracking_lost");
    expect(polled.result.id).toBe("kie-xyz");
  });
});

describe("fetchTaskResult — 缓存 miss 无状态重建续查（重启/驱逐后仍能找回）", () => {
  it("缓存里没有该 taskId，但带 vendor+modelKey+taskKind → 重建 query 真去查上游，不报 task_unknown", async () => {
    await seedAsyncVideoVendorWithMapping();
    // **不跑 create**（模拟重启后内存 taskCache 全空）。直接对一个上游真实存在的 taskId 发查询。
    const fetchFn = stubFetch(() =>
      new Response(JSON.stringify({ video_url: "https://cdn.example.com/recovered.mp4" }), { status: 200 }),
    );
    const { fetchTaskResult } = await import("./runtime");
    const recovered = await fetchTaskResult({
      vendor: "asyncv",
      taskId: "upstream-live-123",
      taskKind: "text_to_video",
      modelKey: "vid-model",
    });
    // 真发了 query GET（无状态重建跑了上游查询），不是直接合成失败。
    expect(fetchFn).toHaveBeenCalled();
    expect(String(fetchFn.mock.calls[0]?.[0] || "")).toContain("video_id=upstream-live-123");
    expect(recovered.result.status).toBe("succeeded");
    expect(recovered.result.assets.length).toBeGreaterThan(0);
    expect((recovered.result.raw as { code?: string }).code).not.toBe("task_unknown");
  });

  it("重建不了（缺 modelKey 无法定位 mapping）→ 仍回落诚实诊断 task_unknown，不静默吞", async () => {
    await seedAsyncVideoVendorWithMapping();
    const { fetchTaskResult } = await import("./runtime");
    const miss = await fetchTaskResult({ vendor: "asyncv", taskId: "no-context-id", taskKind: "text_to_video" });
    expect(miss.result.status).toBe("failed");
    expect((miss.result.raw as { code?: string }).code).toBe("task_unknown");
  });
});
