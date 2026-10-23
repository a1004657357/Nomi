import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ root: "", execute: vi.fn(), buildResult: vi.fn() }));
vi.mock("../projects/repository", async (original) => ({ ...await original<typeof import("../projects/repository")>(), projectDirById: () => mocks.root }));
vi.mock("../runtime", async (original) => ({
  ...await original<typeof import("../runtime")>(),
  findExecutableModel: () => ({ vendor: { key: "size-provider" }, model: { modelKey: "size-model", kind: "image" }, apiKey: "offline-fixture" }),
  findTaskMapping: () => ({ create: { method: "POST", path: "/create", body: { size: "2048x2048" } }, query: { method: "GET", path: "/task" } }),
  executeProfileOperation: mocks.execute,
  buildProfileTaskResult: mocks.buildResult,
}));

beforeEach(async () => {
  mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-size-cache-recovery-"));
  mocks.execute.mockReset().mockResolvedValue({ response: { status: "completed" }, request: {}, timings: {} });
  mocks.buildResult.mockReset().mockResolvedValue({ result: { id: "accepted-id", kind: "text_to_image", status: "succeeded", assets: [{ type: "image", url: "nomi-local://original" }], raw: {} }, providerMeta: {}, unrecognizedStatus: "" });
  vi.resetModules();
  await import("./taskResultQuery");
});
afterEach(() => { fs.rmSync(mocks.root, { recursive: true, force: true }); });

async function recover() {
  const { fetchTaskResult } = await import("./taskResultQuery");
  return fetchTaskResult({ taskId: "accepted-id", vendor: "size-provider", taskKind: "text_to_image", modelKey: "size-model", projectId: "project", expectedImageSize: "4096x4096", extras: { size: "4096x4096" } });
}

describe("actual canvas admission and cache-miss image-size recovery", () => {
  it.each(["eviction", "restart"])("restores original pixels after %s, ignoring changed catalog and supplied extras", async (loss) => {
    const { admitTask, taskCache } = await import("../runtime");
    admitTask("accepted-id", { vendor: "size-provider", request: { kind: "text_to_image", prompt: "a boat", extras: { modelKey: "size-model", size: "2048x2048" } }, raw: {}, projectId: "project", wantedKind: "image", expectedImageSize: "1024x1024" });
    if (loss === "restart") vi.resetModules();
    else taskCache.clear();
    await expect(recover()).resolves.toMatchObject({ result: { status: "succeeded" } });
    expect(mocks.buildResult).toHaveBeenCalledWith(expect.objectContaining({ expectedImageSize: "1024x1024" }));
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0].operation.method).toBe("GET");
  });

  it("marks old tasks without a durable snapshot unavailable, not inferred from current parameters", async () => {
    (await import("../runtime")).taskCache.clear();
    await recover();
    expect(mocks.buildResult).toHaveBeenCalledWith(expect.objectContaining({ expectedImageSize: null }));
  });

  it("retains explicitly unspecified pixels after cache loss instead of inventing exact intent", async () => {
    const { admitTask, taskCache } = await import("../runtime");
    admitTask("accepted-id", { vendor: "size-provider", request: { kind: "text_to_image", prompt: "a boat", extras: { modelKey: "size-model" } }, raw: {}, projectId: "project", wantedKind: "image" });
    taskCache.clear();
    await recover();
    expect(mocks.buildResult).toHaveBeenCalledWith(expect.objectContaining({ expectedImageSize: undefined }));
  });

  it("does not manufacture a new snapshot when an unavailable legacy task keeps polling", async () => {
    mocks.buildResult.mockResolvedValueOnce({ result: { id: "accepted-id", kind: "text_to_image", status: "running", assets: [], raw: {} }, providerMeta: {}, unrecognizedStatus: "" });
    await recover();
    expect(fs.existsSync(path.join(mocks.root, ".nomi", "tasks", "image-size"))).toBe(false);
    expect((await import("../runtime")).taskCache.get("accepted-id")?.expectedImageSize).toBeNull();
  });

  it("does not add HTTP pixel receipts to web-bridge tasks", async () => {
    const { admitTask } = await import("../runtime");
    admitTask("web-id", { vendor: "pavo-web", request: { kind: "text_to_image", prompt: "a boat", extras: { modelKey: "pavo" } }, raw: {}, projectId: "project", wantedKind: "image" });
    expect(fs.existsSync(path.join(mocks.root, ".nomi", "tasks", "image-size"))).toBe(false);
  });
});
