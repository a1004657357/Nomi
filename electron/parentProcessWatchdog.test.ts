import { describe, expect, it, vi } from "vitest";
import { installParentProcessWatchdog } from "./parentProcessWatchdog";

function createHarness(overrides: Partial<Parameters<typeof installParentProcessWatchdog>[0]> = {}) {
  let check: (() => void) | undefined;
  const timer = { unref: vi.fn() };
  const clear = vi.fn();
  const exit = vi.fn();
  const options: Parameters<typeof installParentProcessWatchdog>[0] = {
    enabled: true,
    parentPid: 42,
    getCurrentParentPid: () => 42,
    isProcessAlive: () => true,
    exit,
    schedule: (callback) => {
      check = callback;
      return timer;
    },
    clear,
    ...overrides,
  };

  const stop = installParentProcessWatchdog(options);
  return { check: () => check?.(), clear, exit, stop, timer };
}

describe("installParentProcessWatchdog", () => {
  it("父进程仍是启动父进程且存活时不退出", () => {
    const harness = createHarness();

    harness.check();

    expect(harness.exit).not.toHaveBeenCalled();
    expect(harness.timer.unref).toHaveBeenCalledOnce();
  });

  it("进程被重新托管后立即退出且只退出一次", () => {
    const harness = createHarness({ getCurrentParentPid: () => 1 });

    harness.check();
    harness.check();

    expect(harness.exit).toHaveBeenCalledOnce();
    expect(harness.exit).toHaveBeenCalledWith(0);
  });

  it("启动父进程已不存在时立即退出", () => {
    const harness = createHarness({ isProcessAlive: () => false });

    harness.check();

    expect(harness.exit).toHaveBeenCalledOnce();
  });

  it("停止后清掉探测器且不再退出", () => {
    const harness = createHarness({ getCurrentParentPid: () => 1 });

    harness.stop();
    harness.check();

    expect(harness.clear).toHaveBeenCalledOnce();
    expect(harness.exit).not.toHaveBeenCalled();
  });
});
