import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  },
}));

import { registerAutomationPolicyIpc } from "./automationPolicyIpc";

describe("automation policy IPC", () => {
  beforeEach(() => handlers.clear());

  it("registers read and write handlers", () => {
    const store = { read: vi.fn(() => ({ mode: "balanced" })), write: vi.fn((value) => value) };
    registerAutomationPolicyIpc(store as never);
    expect([...handlers.keys()]).toEqual([
      "nomi:settings:automation-policy-get",
      "nomi:settings:automation-policy-set",
    ]);
  });

  it("returns the durable value produced by the settings store", async () => {
    const stored = { mode: "balanced", trustedHosts: ["nomi", "codex"] };
    const store = { read: vi.fn(() => stored), write: vi.fn(() => stored) };
    registerAutomationPolicyIpc(store as never);

    expect(await handlers.get("nomi:settings:automation-policy-get")?.({})).toEqual(stored);
    expect(await handlers.get("nomi:settings:automation-policy-set")?.({}, { mode: "policy-auto" })).toEqual(stored);
    expect(store.write).toHaveBeenCalledWith({ mode: "policy-auto" });
  });
});
