import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalTaskJobs, withTaskOwner } from "./localTaskJobs";

type Sender = EventEmitter & { id: number };
type Handler = (event: { sender: Sender }, payload?: unknown) => unknown;
type QuitEvent = { preventDefault: () => void };
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(), quitHandler: undefined as undefined | ((event: QuitEvent) => void),
  guard: vi.fn(), quit: vi.fn(), cancel: vi.fn(), cancelOwner: vi.fn(), cancelAll: vi.fn(), grant: vi.fn(),
  cancelProvider: vi.fn(), recordResult: vi.fn(), recordCancellation: vi.fn(),
  runCandidate: vi.fn(), cancelCandidate: vi.fn(), failCandidateEnvelope: vi.fn(),
  prepareQuote: vi.fn(), takeQuote: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, fn: Handler) => mocks.handlers.set(name, fn) },
  app: { on: (name: string, fn: (event: QuitEvent) => void) => { if (name === "will-quit") mocks.quitHandler = fn; }, quit: mocks.quit },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: mocks.guard }));
vi.mock("../spendGrant", () => ({ mintSpendGrant: mocks.grant }));
vi.mock("../spendQuote", () => ({ prepareSpendQuote: mocks.prepareQuote, takeSpendQuote: mocks.takeQuote }));
vi.mock("../submissionLedger", () => ({
  runTaskWithIdempotency: (_payload: unknown, run: () => unknown) => run(),
  recordPersistedTaskResult: mocks.recordResult,
  recordPersistedTaskCancellation: mocks.recordCancellation,
}));
vi.mock("./taskCancellationRuntime", () => ({ taskCancellationRuntime: mocks.cancelProvider }));
vi.mock("./taskIpcGuard", () => ({ runTaskIpcGuard: (_payload: unknown, run: () => unknown) => run() }));
vi.mock("../catalog/antigravityImageOperation", () => ({ antigravityImageJobs: {
  cancel: mocks.cancel, cancelOwner: mocks.cancelOwner, cancelAll: mocks.cancelAll,
} }));
vi.mock("./comfyCandidateTest", () => ({
  runComfyCandidateTest: mocks.runCandidate,
  cancelComfyCandidateTest: mocks.cancelCandidate,
  failComfyCandidateEnvelope: mocks.failCandidateEnvelope,
}));

import { registerTaskIpcHandlers } from "./taskIpcHandlers";
type Runtime = Awaited<ReturnType<Parameters<typeof registerTaskIpcHandlers>[0]>>;
const sender = (id: number): Sender => Object.assign(new EventEmitter(), { id });
const call = (action: string, owner: Sender, payload?: unknown) => mocks.handlers.get(`nomi:tasks:${action}`)!({ sender: owner }, payload);

describe("task IPC local operation lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.handlers.clear();
    mocks.cancelAll.mockResolvedValue(undefined); mocks.cancel.mockResolvedValue({ ok: true });
  });
  it("binds submissions and result queries to the actual sender, not a payload owner", async () => {
    const jobs = new LocalTaskJobs<string>();
    const runtime = {
      runTask: () => jobs.start("project", async () => "pixels"),
      fetchTaskResult: (id: string) => ({ vendor: "antigravity", result: jobs.query(id, "project", () => ["nomi-local://result"]) }),
    };
    registerTaskIpcHandlers(async () => runtime as unknown as Runtime);
    const owner = sender(31);
    const id = await call("run", owner, { owner: 99 }) as string;
    await jobs.settled(id);
    expect(() => withTaskOwner(99, () => jobs.query(id, "project", vi.fn()))).toThrow("OWNER_MISMATCH");
    await expect(call("result", sender(32), id)).rejects.toThrow("OWNER_MISMATCH");
    await expect(call("result", owner, id)).resolves.toMatchObject({ result: { status: "succeeded" } });
    expect(mocks.recordResult).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
  });
  it("registers one window-destruction cleanup callback across repeated submissions", async () => {
    registerTaskIpcHandlers(async () => ({ runTask: vi.fn() }) as unknown as Runtime);
    const owner = sender(31);
    await call("run", owner); await call("run", owner);
    expect(owner.listenerCount("destroyed")).toBe(1);
    owner.emit("destroyed");
    expect(mocks.cancelOwner).toHaveBeenCalledExactlyOnceWith(31);
  });
  it("does not start late work if its window closes during runtime loading", async () => {
    const jobs = new LocalTaskJobs<string>(); const work = vi.fn(async () => "pixels");
    mocks.cancelOwner.mockImplementation((id: number) => jobs.cancelOwner(id));
    let loaded!: (runtime: Runtime) => void;
    registerTaskIpcHandlers(() => new Promise((resolve) => { loaded = resolve; }));
    const owner = sender(31);
    const pending = call("run", owner);
    owner.emit("destroyed");
    loaded({ runTask: () => jobs.start("project", work) } as unknown as Runtime);
    await expect(pending).rejects.toThrow("LOCAL_TASK_OWNER_CLOSED");
    expect(work).not.toHaveBeenCalled();
  });
  it("validates cancel IDs and passes only the actual sender identity", async () => {
    registerTaskIpcHandlers(async () => ({}) as Runtime);
    const owner = sender(31); const id = "local-11111111-1111-4111-8111-111111111111";
    expect(() => call("cancel", owner, `local-${"-".repeat(36)}`)).toThrow("LOCAL_TASK_INVALID_ID");
    expect(mocks.cancel).not.toHaveBeenCalled();
    await expect(call("cancel", owner, { taskId: id, owner: 99 })).resolves.toEqual({ cancelled: true, remoteCancelled: false });
    expect(mocks.cancel).toHaveBeenLastCalledWith(id, 31);
    expect(mocks.recordCancellation).toHaveBeenLastCalledWith({ providerTaskId: id });
    expect(mocks.cancelProvider).not.toHaveBeenCalled();
    await call("cancel", owner, id);
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.cancel).toHaveBeenLastCalledWith(id, 31);
    expect(mocks.recordCancellation).toHaveBeenCalledTimes(2);
    expect(mocks.guard).toHaveBeenCalledTimes(3);
  });
  it("does not persist cancellation when a local task was not cancelled", async () => {
    mocks.cancel.mockResolvedValue({ ok: false });
    registerTaskIpcHandlers(async () => ({}) as Runtime);
    const id = "local-11111111-1111-4111-8111-111111111111";
    await expect(call("cancel", sender(31), id)).resolves.toEqual({ ok: false });
    expect(mocks.recordCancellation).not.toHaveBeenCalled();
  });
  it("preserves custom provider cancellation and bounded batch grant TTL", async () => {
    registerTaskIpcHandlers(async () => ({}) as Runtime);
    const owner = sender(31);
    const payload = { vendor: "codex", runId: "img-run" };
    await call("cancel", owner, payload);
    expect(mocks.cancelProvider).toHaveBeenCalledExactlyOnceWith(payload);
    call("grant-spend", owner, { nodeIds: ["shot-1"], ttlMs: 24 * 60 * 60_000 });
    expect(mocks.grant).toHaveBeenCalledWith({ nodeIds: ["shot-1"], ttlMs: 4 * 60 * 60_000 });
  });
  it("routes exact Comfy candidate test and cancel through trusted dedicated IPC", async () => {
    const runtime = { runTask: vi.fn(), fetchTaskResult: vi.fn() };
    mocks.runCandidate.mockResolvedValue({ ok: true, revisionId: "revision-1", active: { vendorKey: "candidate", modelKey: "model" } });
    mocks.cancelCandidate.mockReturnValue({ ok: true });
    registerTaskIpcHandlers(async () => runtime as unknown as Runtime);
    const owner = sender(31); const payload = {
      candidate: { revisionId: "revision-1", modelKey: "model", taskKind: "text_to_video" },
      request: { extras: { comfyCertificationRevisionId: "revision-1" } },
    };
    await expect(call("comfy-candidate-test", owner, payload)).resolves.toMatchObject({ ok: true });
    expect(call("comfy-candidate-cancel", owner, payload.candidate)).toEqual({ ok: true });
    expect(mocks.runCandidate).toHaveBeenCalledWith(payload, expect.objectContaining(runtime));
    expect(mocks.cancelCandidate).toHaveBeenCalledWith(payload.candidate);
  });
  it("routes spend quotes and binds the consumed quote to the bounded custom grant", async () => {
    const inputs = [{ vendorKey: "fixture", modelKey: "image" }];
    const quote = { quoteId: "quote-1", lines: [{ ...inputs[0], amount: 2 }], amount: 2 };
    mocks.prepareQuote.mockReturnValue(quote);
    mocks.takeQuote.mockReturnValue(quote);
    mocks.grant.mockReturnValue("grant-1");
    registerTaskIpcHandlers(async () => ({}) as Runtime);
    const owner = sender(31);

    expect(call("quote-spend", owner, inputs)).toBe(quote);
    expect(mocks.prepareQuote).toHaveBeenCalledExactlyOnceWith(inputs);
    expect(call("grant-spend", owner, {
      nodeIds: ["shot-1"], quoteId: "quote-1", ttlMs: 24 * 60 * 60_000,
    })).toEqual({ grantId: "grant-1" });
    expect(mocks.takeQuote).toHaveBeenCalledExactlyOnceWith("quote-1");
    expect(mocks.grant).toHaveBeenCalledExactlyOnceWith({ nodeIds: ["shot-1"], quote, ttlMs: 4 * 60 * 60_000 });
    expect(() => call("quote-spend", owner, [])).toThrow("Invalid quote targets");
    expect(() => call("quote-spend", owner, Array(1001).fill(inputs[0]))).toThrow("Invalid quote targets");
    expect(mocks.prepareQuote).toHaveBeenCalledOnce();
    expect(mocks.guard).toHaveBeenCalledTimes(4);
  });
  it("returns structured failure and exact cleanup when runtime loading throws before the executor guard", async () => {
    const failure = { ok: false, revisionId: "revision-1", reasonCode: "provider_failed", params: {} };
    mocks.failCandidateEnvelope.mockReturnValue(failure);
    registerTaskIpcHandlers(async () => { throw new Error("runtime load failed"); });
    const owner = sender(31); const payload = {
      candidate: { revisionId: "revision-1", modelKey: "model", taskKind: "text_to_video" },
      request: {},
    };
    await expect(call("comfy-candidate-test", owner, payload)).resolves.toEqual(failure);
    // 真因必须随失败信封一起交出去。这里曾是一个空 catch（`} catch {`），把上游 4xx、余额不足、
    // 乃至我们自己的出站策略拒绝**全部**压成裸码 `provider_failed`，界面照着渲染那个未翻译的码，
    // 用户看不到任何可据以行动的事实。断言绑住第三个参数，空 catch 回来就翻红。
    expect(mocks.failCandidateEnvelope).toHaveBeenCalledWith(
      payload,
      "provider_failed",
      expect.objectContaining({ message: "runtime load failed" }),
    );
  });
  it("cancels and cleans the exact in-flight candidate when its renderer is destroyed", async () => {
    let loaded!: (runtime: Runtime) => void;
    const failure = { ok: false, revisionId: "revision-1", reasonCode: "candidate_cancelled", params: {} };
    mocks.failCandidateEnvelope.mockReturnValue(failure);
    registerTaskIpcHandlers(() => new Promise((resolve) => { loaded = resolve; }));
    const owner = sender(31); const payload = {
      candidate: { revisionId: "revision-1", modelKey: "model", taskKind: "text_to_video" },
      request: {},
    };
    const pending = call("comfy-candidate-test", owner, payload);
    owner.emit("destroyed");
    loaded({ runTask: vi.fn(), fetchTaskResult: vi.fn() } as unknown as Runtime);
    await expect(pending).resolves.toMatchObject({ ok: false, revisionId: "revision-1" });
    expect(mocks.cancelCandidate).toHaveBeenCalledWith(payload.candidate);
    expect(mocks.failCandidateEnvelope).toHaveBeenCalledWith(payload, "candidate_cancelled");
    expect(mocks.runCandidate).not.toHaveBeenCalled();
  });
  it("prevents repeated quit events from bypassing process cleanup", async () => {
    let finish!: () => void;
    const cleanup = new Promise<void>((resolve) => { finish = resolve; });
    mocks.cancelAll.mockReturnValue(cleanup);
    registerTaskIpcHandlers(async () => ({}) as Runtime);
    const first = { preventDefault: vi.fn() }; const second = { preventDefault: vi.fn() };
    mocks.quitHandler!(first); mocks.quitHandler!(second);
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(mocks.cancelAll).toHaveBeenCalledOnce();
    expect(mocks.quit).not.toHaveBeenCalled();
    finish(); await cleanup; await Promise.resolve();
    expect(mocks.quit).toHaveBeenCalledOnce();
    const completed = { preventDefault: vi.fn() }; mocks.quitHandler!(completed);
    expect(completed.preventDefault).not.toHaveBeenCalled();
  });
});

// S1-5 同类（2026-10-03）：画布单点生成途中切项目再切回来，节点一度显示空闲、「生成全部」把它算进去——
// 供应商收到第二笔，扣两次钱。花钱边界自己要兜底：同一节点有一笔还在主进程手里时，再来一笔直接拒，并说实话。
describe("one paid submit in flight per canvas node", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.handlers.clear(); mocks.cancelAll.mockResolvedValue(undefined); });
  const payload = (nodeId: string, projectId = "project-a") => ({ vendor: "fixture", request: { kind: "text_to_image", prompt: "p", extras: { projectId, nodeId } } });

  it("reported case: a second run on a node whose first run has not returned is refused without reaching the provider", async () => {
    let release!: () => void;
    const first = new Promise<string>((resolve) => { release = () => resolve("first-result"); });
    const runTask = vi.fn().mockReturnValueOnce(first).mockResolvedValue("second-result");
    registerTaskIpcHandlers(async () => ({ runTask }) as unknown as Runtime);
    const owner = sender(41);
    const inFlight = call("run", owner, payload("node-1"));
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(1));

    await expect(call("run", owner, payload("node-1"))).rejects.toMatchObject({ code: "node_generation_in_flight" });
    expect(runTask).toHaveBeenCalledTimes(1);

    release();
    await expect(inFlight).resolves.toBe("first-result");
    await expect(call("run", owner, payload("node-1"))).resolves.toBe("second-result");
  });

  it("class: other nodes, the same node id in another project, and requests without a node are not held back", async () => {
    const runTask = vi.fn(() => new Promise(() => undefined));
    registerTaskIpcHandlers(async () => ({ runTask }) as unknown as Runtime);
    const owner = sender(42);
    void call("run", owner, payload("node-1"));
    void call("run", owner, payload("node-2"));
    void call("run", owner, payload("node-1", "project-b"));
    void call("run", owner, { vendor: "fixture", request: { kind: "text_to_image", prompt: "p", extras: {} } });
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(4));
  });
});
