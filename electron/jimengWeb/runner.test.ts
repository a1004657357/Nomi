import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  loadExtension: vi.fn(async () => {
    throw new Error("extension load failed");
  }),
  removeExtension: vi.fn(),
  probeServer: vi.fn(async () => ({ ok: true, serverUrl: "http://127.0.0.1:3456", sseClients: 0 })),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/nomi-test"),
    on: mocks.appOn,
  },
  BrowserWindow: vi.fn(),
  session: {
    fromPartition: vi.fn(() => ({
      getAllExtensions: () => [],
      getStoragePath: () => "/tmp/nomi-test/Partitions/nomi-jimeng-runner",
      loadExtension: mocks.loadExtension,
      removeExtension: mocks.removeExtension,
    })),
  },
}));

vi.mock("./seedanceBridge", async (importOriginal) => {
  const original = await importOriginal<typeof import("./seedanceBridge")>();
  return {
    ...original,
    probeJimengWebServer: mocks.probeServer,
  };
});

const tempDirs: string[] = [];

beforeEach(() => {
  mocks.appOn.mockClear();
  mocks.loadExtension.mockClear();
  mocks.removeExtension.mockClear();
  mocks.probeServer.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NOMI_SEEDANCE_EXTENSION_DIR;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("jimeng web runner lifecycle", () => {
  it("derives a dedicated port and instance identity for the managed server", async () => {
    vi.resetModules();
    const { jimengWebServerProcessEnv } = await import("./runner");

    expect(jimengWebServerProcessEnv("http://127.0.0.1:3457")).toMatchObject({
      NOMI_JIMENG_WEB_PORT: "3457",
      NOMI_JIMENG_WEB_INSTANCE_ID: "nomi-jimeng-runner-v1",
      NOMI_JIMENG_WEB_DATA_DIR: "/tmp/nomi-test/jimeng-web-bridge/data",
      NOMI_JIMENG_WEB_UPLOADS_DIR: "/tmp/nomi-test/jimeng-web-bridge/uploads",
    });
  });

  it("prefers the Nomi-owned extension fork over removable-volume and legacy copies", async () => {
    vi.resetModules();
    const { seedanceExtensionCandidates } = await import("./runner");

    expect(seedanceExtensionCandidates()[0]).toBe(
      path.join(os.homedir(), "Projects", "Nomi-jimeng-web-extension"),
    );
  });

  it("exposes stable task-specific Jimeng page URLs", async () => {
    vi.resetModules();
    const { jimengPageUrlForMediaType } = await import("./runner");

    expect(jimengPageUrlForMediaType("video")).toContain("ai_feature_name=video");
    expect(jimengPageUrlForMediaType("image")).toBe("https://jimeng.jianying.com/ai-tool/image/generate");
  });

  it("reuses every live runner window and opens the default entry only for a new window", async () => {
    vi.resetModules();
    const { jimengRunnerWindowAction } = await import("./runner");

    expect(jimengRunnerWindowAction(true)).toBe("reuse");
    expect(jimengRunnerWindowAction(false)).toBe("open-default");
  });

  it("registers a synchronous before-quit disposer when the runner module loads", async () => {
    vi.resetModules();
    await import("./runner");

    expect(mocks.appOn).toHaveBeenCalledWith("before-quit", expect.any(Function));
  });

  it("terminates a managed server gracefully before force killing a stuck process", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { terminateManagedJimengServerProcess } = await import("./runner");
    const process = {
      killed: false,
      exitCode: null as number | null,
      kill: vi.fn(() => true),
    };

    terminateManagedJimengServerProcess(process);
    expect(process.kill).toHaveBeenCalledTimes(1);
    expect(process.kill).toHaveBeenLastCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(process.kill).toHaveBeenCalledTimes(2);
    expect(process.kill).toHaveBeenLastCalledWith("SIGKILL");
  });

  it("does not force kill a managed server that exits during the grace period", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { terminateManagedJimengServerProcess } = await import("./runner");
    const process = {
      killed: false,
      exitCode: null as number | null,
      kill: vi.fn(() => true),
    };

    terminateManagedJimengServerProcess(process);
    process.exitCode = 0;
    await vi.advanceTimersByTimeAsync(2_000);

    expect(process.kill).toHaveBeenCalledTimes(1);
    expect(process.kill).toHaveBeenLastCalledWith("SIGTERM");
  });

  it("clears a previous startup error when the runner is stopped", async () => {
    const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-jimeng-runner-test-"));
    tempDirs.push(extensionDir);
    fs.writeFileSync(path.join(extensionDir, "manifest.json"), "{}", "utf8");
    fs.writeFileSync(path.join(extensionDir, "mock-server.js"), "", "utf8");
    process.env.NOMI_SEEDANCE_EXTENSION_DIR = extensionDir;

    vi.resetModules();
    const { jimengWebStartRunner, jimengWebStopRunner } = await import("./runner");
    const failed = await jimengWebStartRunner();
    expect(failed.error).toContain("extension load failed");

    const stopped = await jimengWebStopRunner();
    expect(stopped.error).toBeUndefined();
  });
});
