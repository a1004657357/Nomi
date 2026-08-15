import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installChildProcessLifecycle } from "./child-process-lifecycle.mjs";

function createHost() {
  const host = new EventEmitter();
  host.exit = vi.fn();
  return host;
}

function createChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.kill = vi.fn((signal) => {
    child.killed = true;
    return true;
  });
  return child;
}

describe("installChildProcessLifecycle", () => {
  it("父启动器收到 SIGTERM 时收掉所有子进程再退出", () => {
    const host = createHost();
    const first = createChild();
    const second = createChild();
    const lifecycle = installChildProcessLifecycle(host);
    lifecycle.track(first);
    lifecycle.track(second);

    host.emit("SIGTERM");

    expect(first.kill).toHaveBeenCalledOnce();
    expect(first.kill).toHaveBeenCalledWith("SIGTERM");
    expect(second.kill).toHaveBeenCalledOnce();
    expect(host.exit).not.toHaveBeenCalled();

    first.signalCode = "SIGTERM";
    first.emit("exit", null, "SIGTERM");
    second.signalCode = "SIGTERM";
    second.emit("exit", null, "SIGTERM");

    expect(host.exit).toHaveBeenCalledWith(143);
  });

  it("已经退出并从登记表移除的子进程不会再被误杀", () => {
    const host = createHost();
    const child = createChild();
    const lifecycle = installChildProcessLifecycle(host);
    lifecycle.track(child);
    child.exitCode = 0;
    child.emit("exit", 0, null);

    host.emit("exit");

    expect(child.kill).not.toHaveBeenCalled();
  });

  it("重复退出事件不会向同一个子进程重复发信号", () => {
    const host = createHost();
    const child = createChild();
    const lifecycle = installChildProcessLifecycle(host);
    lifecycle.track(child);

    host.emit("SIGINT");
    host.emit("exit");

    expect(child.kill).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    expect(host.exit).not.toHaveBeenCalled();

    child.signalCode = "SIGINT";
    child.emit("exit", null, "SIGINT");

    expect(host.exit).toHaveBeenCalledWith(130);
  });

  it("子进程不响应正常信号时升级为 SIGKILL 后退出", () => {
    vi.useFakeTimers();
    const host = createHost();
    const child = createChild();
    const lifecycle = installChildProcessLifecycle(host, { forceAfterMs: 2_000 });
    lifecycle.track(child);

    host.emit("SIGTERM");
    vi.advanceTimersByTime(2_000);

    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(host.exit).toHaveBeenCalledWith(143);
    vi.useRealTimers();
  });

  it("启动器内部结束时也走同一条可等待的清理路径", () => {
    const host = createHost();
    const child = createChild();
    const lifecycle = installChildProcessLifecycle(host);
    lifecycle.track(child);

    lifecycle.shutdown("SIGTERM", 7);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(host.exit).not.toHaveBeenCalled();

    child.signalCode = "SIGTERM";
    child.emit("exit", null, "SIGTERM");

    expect(host.exit).toHaveBeenCalledWith(7);
  });
});
