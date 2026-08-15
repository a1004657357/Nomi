import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  app: { on: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  },
}));

import { registerProviderAdapterIpc } from "./ipc";

describe("registerProviderAdapterIpc", () => {
  beforeEach(() => handlers.clear());

  it("exposes start/get/latest without returning credentials", async () => {
    const run = { id: "run-1", vendorKey: "example-com", stage: "queued" };
    const service = {
      start: vi.fn(() => run),
      getRun: vi.fn(() => run),
      latestRun: vi.fn(() => run),
      resumeInterrupted: vi.fn(),
    };
    registerProviderAdapterIpc(service as never);

    const started = await handlers.get("nomi:provider-adapter:start")?.({}, {
      vendorName: "Example",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-secret",
      models: [{ modelKey: "paint-v2", kind: "image" }],
    });
    const fetched = await handlers.get("nomi:provider-adapter:get")?.({}, { runId: "run-1" });

    expect(started).toEqual({ ok: true, run });
    expect(JSON.stringify(started)).not.toContain("sk-secret");
    expect(fetched).toEqual({ ok: true, run });
    expect(service.resumeInterrupted).toHaveBeenCalledTimes(1);
  });
});
