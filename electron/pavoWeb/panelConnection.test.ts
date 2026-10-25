import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "integrations/pavo-web-adapter/panel.js"), "utf8");
const mediaSource = fs.readFileSync(path.join(process.cwd(), "integrations/pavo-web-adapter/pavo-media.js"), "utf8");
const identity = { name: "Pavo Web Task Bridge", instanceId: "nomi-pavo-web-v1", safetyContractVersion: 1 };

async function settle() { for (let i = 0; i < 100; i++) await Promise.resolve(); }

function panel(options: { root?: object; status?: number; pageHangs?: boolean; stored?: object } = {}) {
  vi.useFakeTimers();
  const elements = new Map<string, any>();
  const intervals: Array<{ callback: () => unknown; ms: number }> = [];
  const streams: Array<{ url: string; closed: boolean; onerror?: () => void; onopen?: () => void }> = [];
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fileReads: Array<() => void> = [];
  const changes: Array<(changes: Record<string, unknown>, area: string) => unknown> = [];
  const stored: Record<string, any> = { apiBaseUrl: "http://127.0.0.1:3458", apiToken: "fixture-old", ...options.stored };
  let root = options.root || identity;
  let status = options.status || 200;
  let intercept: ((url: string, init: RequestInit) => Promise<Response> | undefined) | undefined;
  let readStorage: (() => Promise<object>) | undefined;
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value: "", textContent: "", className: "", files: [],
      appendChild() {}, addEventListener: vi.fn(), innerHTML: "" });
    return elements.get(id);
  };
  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    requests.push({ url, init });
    const handled = intercept?.(url, init);
    if (handled) return handled;
    if (new URL(url).pathname === "/") return Response.json(root, { status });
    if (new URL(url).pathname === "/api/tasks") return Response.json({ tasks: [] });
    if (new URL(url).pathname === "/api/tasks/pending") return Response.json({ tasks: [] });
    throw new Error(`Unexpected request: ${new URL(url).pathname}`);
  });
  class FakeEventSource {
    closed = false;
    onopen?: () => void;
    onerror?: () => void;
    listeners = new Map<string, () => void>();
    constructor(public url: string) { streams.push(this); }
    addEventListener(event: string, callback: () => void) { this.listeners.set(event, callback); }
    close() { this.closed = true; }
  }
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => ({ textContent: "" }) },
    chrome: { runtime: { id: "a".repeat(32) }, storage: {
      onChanged: { addListener: (cb: typeof changes[number]) => changes.push(cb) },
      local: { get: async () => readStorage ? readStorage() : ({ ...stored }), set: async (values: object) => Object.assign(stored, values) },
    }, tabs: { query: async () => [{ id: 1, active: true }], sendMessage: vi.fn(async (_id, message) => {
      if (message.action === "getPageInfo" && options.pageHangs) return new Promise(() => {});
      return { success: true, info: { hostname: "app.pavo-ai.cn", hasSubmitButton: true, hasPromptEditor: true, mediaType: "video" } };
    }) } },
    navigator: { locks: { request: (_key: string, _options: object, callback: () => Promise<void>) => callback() } },
    window: { addEventListener() {}, parent: { postMessage() {} } },
    crypto: { randomUUID: () => "fixture-client" }, URL, URLSearchParams, AbortSignal, fetch,
    EventSource: FakeEventSource, setTimeout, clearTimeout, Date,
    FileReader: class {
      result = "data:image/png;base64,Zml4dHVyZQ==";
      onload?: () => void;
      readAsDataURL() { fileReads.push(() => this.onload?.()); }
    },
    setInterval: (callback: () => unknown, ms: number) => intervals.push({ callback, ms }),
  });
  vm.runInContext(mediaSource, context);
  vm.runInContext(source, context);
  return { elements, streams, requests, intervals, fetch, fileReads, stored, element,
    interceptRequests(callback: typeof intercept) { intercept = callback; },
    interceptStorage(callback: typeof readStorage) { readStorage = callback; },
    setResponse(value: object, code = 200) { root = value; status = code; },
    async configure(values: Record<string, unknown>) {
      const delta = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: stored[key], newValue }]));
      Object.assign(stored, values);
      for (const callback of changes) await callback(delta, "local");
      await settle();
    },
  };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("Pavo panel connection lifecycle (no generation)", () => {
  it("reconnects using updated host credentials instead of keeping a stale SSE", async () => {
    const app = panel();
    await settle();
    const old = app.streams[0];
    expect(old).toBeDefined();
    await app.configure({ apiToken: "fixture-new" });
    expect(old.closed).toBe(true);
    expect(app.streams.at(-1)?.url).toContain("token=fixture-new");
    expect(app.requests.filter(r => new URL(r.url).pathname === "/").at(-1)?.init.headers)
      .toMatchObject({ "X-Nomi-Token": "fixture-new" });
  });

  it.each([
    { root: { ...identity, instanceId: "pavo-agent-gateway-v1" }, hint: "实例" },
    { root: { ...identity, safetyContractVersion: 0 }, hint: "协议" },
  ])("rejects an incompatible bridge before reading tasks ($hint)", async ({ root, hint }) => {
    const app = panel({ root });
    await settle();
    expect(app.streams).toHaveLength(0);
    expect(app.requests.every(r => new URL(r.url).pathname === "/")).toBe(true);
    expect(app.elements.get("bridgeStatus").textContent).toContain(hint);
  });

  it("closes the old SSE on 401 and recovers only after host configuration changes", async () => {
    const app = panel();
    await settle();
    const old = app.streams[0];
    app.setResponse({ error: "Unauthorized" }, 401);
    await app.intervals.find(i => i.ms === 20_000)!.callback();
    await settle();
    expect(old.closed).toBe(true);
    expect(app.elements.get("bridgeStatus").textContent).toContain("鉴权");
    expect(app.requests.some(r => r.url.includes("/api/bootstrap"))).toBe(false);
    app.setResponse(identity);
    await app.configure({ apiToken: "fixture-new" });
    expect(app.streams.at(-1)?.url).toContain("token=fixture-new");
  });

  it("does not send credentials to a non-loopback host", async () => {
    const app = panel({ stored: { apiBaseUrl: "https://example.test" } });
    await settle();
    expect(app.requests).toHaveLength(0);
    expect(app.elements.get("bridgeStatus").textContent).toContain("本机");
  });

  it("does not discover a different gateway when the configured one has no token", async () => {
    const app = panel({ stored: { apiToken: "" } });
    await settle();
    expect(app.requests.every(r => new URL(r.url).port === "3458")).toBe(true);
    expect(app.streams).toHaveLength(0);
  });

  it("polls the gateway even when the website readiness request is stuck", async () => {
    const app = panel({ pageHangs: true });
    await settle();
    const before = app.requests.filter(r => r.url.includes("/api/tasks/pending")).length;
    app.intervals.find(i => i.ms === 8_000)!.callback();
    await settle();
    expect(app.requests.filter(r => r.url.includes("/api/tasks/pending")).length).toBeGreaterThan(before);
  });

  it("cancels reconnect timers belonging to the previous configuration", async () => {
    const app = panel();
    await settle();
    app.streams[0].onerror!();
    await app.configure({ apiToken: "fixture-new" });
    const current = app.streams.at(-1)!;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(app.streams.at(-1)).toBe(current);
    expect(app.streams.filter(stream => !stream.closed)).toHaveLength(1);
  });

  it("does not move task history or result collection to another gateway", async () => {
    const app = panel({ stored: { pavoTaskQueue: [{ taskCode: "PAVO-OLD", status: "awaiting_result", submitClaimedAt: "2026-10-21" }] } });
    await settle();
    await app.configure({ apiBaseUrl: "http://127.0.0.1:45678" });
    expect(app.requests.some(r => new URL(r.url).port === "45678")).toBe(false);
    expect(app.elements.get("bridgeStatus").textContent).toContain("任务");
  });

  it("discards a late task recovery response after credentials change", async () => {
    const app = panel();
    let finishOld: (response: Response) => void = () => {};
    let delayed = false;
    app.interceptRequests(url => {
      if (new URL(url).pathname !== "/api/tasks" || delayed) return;
      delayed = true;
      return new Promise(resolve => { finishOld = resolve; });
    });
    await settle();
    await app.configure({ apiToken: "fixture-new" });
    finishOld(Response.json({ tasks: [{ taskCode: "LATE-OLD", submitClaimedAt: "2026-10-21", status: "awaiting_result" }] }));
    await settle();
    expect(app.stored.pavoTaskQueue || []).toEqual([]);
    expect(app.streams.at(-1)?.url).toContain("token=fixture-new");
  });

  it("cancels a manual submit when configuration changes during reference file reads", async () => {
    const app = panel();
    await settle();
    app.elements.get("prompt").value = "Local fixture only";
    app.element("references").files = [{ name: "fixture.png", type: "image/png" }];
    const click = app.elements.get("submit").addEventListener.mock.calls.find(([event]: string[]) => event === "click")[1];
    const pending = click({ currentTarget: { disabled: false } });
    await settle();
    expect(app.fileReads).toHaveLength(1);
    await app.configure({ apiToken: "fixture-new" });
    app.fileReads[0]();
    await pending;
    await settle();
    expect(app.requests.some(r => r.init.method === "POST")).toBe(false);
    expect(app.elements.get("manualStatus").textContent).toContain("取消");
  });

  it("serializes configuration reads and discards a superseded storage snapshot", async () => {
    const app = panel();
    await settle();
    const reads: Array<(value: object) => void> = [];
    app.interceptStorage(() => new Promise(resolve => reads.push(resolve)));
    await app.configure({ apiToken: "fixture-middle" });
    await app.configure({ apiToken: "fixture-new" });
    expect(reads).toHaveLength(1);
    reads.shift()!({ apiBaseUrl: "http://127.0.0.1:3458", apiToken: "fixture-middle" });
    await settle();
    expect(app.streams.some(s => s.url.includes("token=fixture-middle"))).toBe(false);
    expect(reads).toHaveLength(1);
    reads.shift()!({ apiBaseUrl: "http://127.0.0.1:3458", apiToken: "fixture-new" });
    await settle();
    expect(app.streams.at(-1)?.url).toContain("token=fixture-new");
  });

  it("ignores events delivered by a closed SSE after credential rotation", async () => {
    const app = panel();
    await settle();
    const old = app.streams[0] as unknown as { listeners: Map<string, () => void> };
    await app.configure({ apiToken: "fixture-new" });
    const before = app.requests.length;
    old.listeners.get("task-created")!();
    await settle();
    expect(app.requests).toHaveLength(before);
  });
});
