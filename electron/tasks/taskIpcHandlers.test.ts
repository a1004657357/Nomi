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
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, fn: Handler) => mocks.handlers.set(name, fn) },
  app: { on: (_name: string, fn: (event: QuitEvent) => void) => { mocks.quitHandler = fn; }, quit: mocks.quit },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: mocks.guard }));
vi.mock("../spendGrant", () => ({ mintSpendGrant: mocks.grant }));
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
