import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => {
  const runnerSession = {
    cookies: {
      get: vi.fn(async () => [
        { name: "sessionid", value: "present" },
      ]),
    },
  };
  const fromPartition = vi.fn(() => runnerSession);
  const browserWindow = vi.fn(function BrowserWindowMock(this: Record<string, unknown>, options: unknown) {
    this.options = options;
    this.isDestroyed = () => false;
    this.show = vi.fn();
    this.focus = vi.fn();
    this.loadURL = vi.fn(async () => undefined);
    this.on = vi.fn();
  });
  return { browserWindow, fromPartition, runnerSession };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMocks.browserWindow,
  session: { fromPartition: electronMocks.fromPartition },
  shell: { openExternal: vi.fn(async () => undefined) },
}));

vi.mock("./runner", () => ({
  JIMENG_WEB_RUNNER_PARTITION: "persist:nomi-jimeng-runner",
  jimengWebRunnerStatus: vi.fn(async () => ({
    available: true,
    running: false,
    browserOpen: false,
    serverManaged: false,
    clientOnline: false,
    engine: "electron",
    drawerReady: false,
    fallbackPanelOpen: false,
    jimengUrl: "https://jimeng.jianying.com/",
  })),
  jimengWebStartRunner: vi.fn(),
  jimengWebStopRunner: vi.fn(),
}));

import { jimengWebOpenLogin, jimengWebStatus } from "./ipc";

describe("jimeng web IPC session", () => {
  beforeEach(() => {
    electronMocks.browserWindow.mockClear();
    electronMocks.fromPartition.mockClear();
  });

  it("reads login status from the same persistent partition used by the extension runner", async () => {
    const status = await jimengWebStatus();

    expect(electronMocks.fromPartition).toHaveBeenCalledWith("persist:nomi-jimeng-runner");
    expect(status).toMatchObject({ cookieCount: 1, likelyLoggedIn: true });
  });

  it("opens the login window with the runner session instead of a separate cookie jar", async () => {
    await jimengWebOpenLogin();

    expect(electronMocks.browserWindow).toHaveBeenCalledTimes(1);
    const options = electronMocks.browserWindow.mock.calls[0]?.[0] as {
      webPreferences?: { session?: unknown; partition?: string };
    };
    expect(options.webPreferences?.session).toBe(electronMocks.runnerSession);
    expect(options.webPreferences?.partition).toBeUndefined();
  });
});
