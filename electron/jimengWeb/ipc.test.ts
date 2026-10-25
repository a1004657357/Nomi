import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWindowRecordOf } from '../appWindowRegistry';

type WindowMock = {
  id: number; options: unknown; isDestroyed: () => boolean; show: () => void; focus: () => void;
  loadURL: (url: string) => Promise<void>; close: () => void;
  on: (event: string, listener: () => void) => unknown;
  once: (event: string, listener: () => void) => unknown;
};

const electronMocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  const runnerSession = {
    cookies: {
      get: vi.fn(async () => [
        { name: "sessionid", value: "present" },
      ]),
    },
  };
  const fromPartition = vi.fn(() => runnerSession);
  let nextId = 0;
  const browserWindow = vi.fn(function BrowserWindowMock(this: WindowMock, options: unknown) {
    const events = new EventEmitter();
    let destroyed = false;
    this.id = ++nextId;
    this.options = options;
    this.isDestroyed = () => destroyed;
    this.show = vi.fn();
    this.focus = vi.fn();
    this.loadURL = vi.fn(async () => undefined);
    this.on = vi.fn(events.on.bind(events));
    this.once = vi.fn(events.once.bind(events));
    this.close = () => { if (!destroyed) { destroyed = true; events.emit('closed'); } };
  });
  return { browserWindow, fromPartition, runnerSession,
    probe: vi.fn(async () => ({ ok: false, reachable: false, serverUrl: 'http://fixture.invalid' })),
    network: vi.fn(() => { throw new Error('IPC fixture must not contact a live runner'); }),
  };
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
vi.mock('./seedanceBridge', async load => ({
  ...await load<typeof import('./seedanceBridge')>(),
  probeJimengWebServer: electronMocks.probe,
}));

import { jimengWebOpenLogin, jimengWebStatus } from "./ipc";

describe("jimeng web IPC session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', electronMocks.network);
  });
  afterEach(() => {
    for (const win of electronMocks.browserWindow.mock.instances) (win as WindowMock).close();
    expect(electronMocks.network).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reads login status from the same persistent partition used by the extension runner", async () => {
    const status = await jimengWebStatus();

    expect(electronMocks.fromPartition).toHaveBeenCalledWith("persist:nomi-jimeng-runner");
    expect(status).toMatchObject({ cookieCount: 1, likelyLoggedIn: true });
    expect(electronMocks.probe).toHaveBeenCalledOnce();
  });

  it("opens the login window with the runner session instead of a separate cookie jar", async () => {
    await jimengWebOpenLogin();

    expect(electronMocks.browserWindow).toHaveBeenCalledTimes(1);
    const options = electronMocks.browserWindow.mock.calls[0]?.[0] as {
      webPreferences?: { session?: unknown; partition?: string };
    };
    expect(options.webPreferences?.session).toBe(electronMocks.runnerSession);
    expect(options.webPreferences?.partition).toBeUndefined();
    expect(options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true });
    const win = electronMocks.browserWindow.mock.instances[0] as WindowMock;
    expect(win.once).toHaveBeenCalledWith('closed', expect.any(Function));
    expect(appWindowRecordOf(win as unknown as Parameters<typeof appWindowRecordOf>[0])).toMatchObject({ role: 'untrusted', expectedOrigin: 'https://jimeng.jianying.com' });
    expect(win.loadURL).toHaveBeenCalledWith(expect.stringContaining('https://jimeng.jianying.com/'));
    await jimengWebOpenLogin();
    expect(electronMocks.browserWindow).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
    win.close();
    expect(appWindowRecordOf(win as unknown as Parameters<typeof appWindowRecordOf>[0])).toBeNull();
    await jimengWebOpenLogin();
    expect(electronMocks.browserWindow).toHaveBeenCalledTimes(2);
  });
});
