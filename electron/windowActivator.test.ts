import { describe, expect, it, vi } from "vitest";
import { createWindowActivator } from "./windowActivator";

type FakeWindow = ReturnType<typeof fakeWindow>;

function fakeWindow(minimized = false) {
  return {
    isMinimized: vi.fn(() => minimized),
    restore: vi.fn(),
    focus: vi.fn(),
  };
}

describe("createWindowActivator", () => {
  it("restores and focuses the existing window", async () => {
    const existing = fakeWindow(true);
    const createWindow = vi.fn();
    const activate = createWindowActivator({ getWindows: () => [existing], createWindow });

    await expect(activate()).resolves.toBe(existing);
    expect(existing.restore).toHaveBeenCalledOnce();
    expect(existing.focus).toHaveBeenCalledOnce();
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("creates and focuses a window when the app has no windows", async () => {
    const created = fakeWindow();
    const activate = createWindowActivator<FakeWindow>({ getWindows: () => [], createWindow: vi.fn(async () => created) });

    await expect(activate()).resolves.toBe(created);
    expect(created.focus).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent window recreation", async () => {
    const created = fakeWindow();
    let resolveCreate: ((window: FakeWindow) => void) | undefined;
    const createWindow = vi.fn(() => new Promise<FakeWindow>((resolve) => { resolveCreate = resolve; }));
    const activate = createWindowActivator<FakeWindow>({ getWindows: () => [], createWindow });

    const first = activate();
    const second = activate();
    expect(createWindow).toHaveBeenCalledOnce();
    resolveCreate?.(created);

    await expect(Promise.all([first, second])).resolves.toEqual([created, created]);
  });
});
