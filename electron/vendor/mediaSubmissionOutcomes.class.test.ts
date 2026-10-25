import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { Vendor } from "../catalog/types";
import { encodeVendorErrorMessage, requestBinary, requestJson, requestMultipart, vendorHttpTimeoutMs, vendorRequestRole, vendorResponseDispatcher, VendorRequestError } from "./vendorHttp";
import { Dispatcher } from "undici";
import { setSubmitOutboundDepsForTests } from "./vendorOutboundGuard";
import { classifyGenerationError } from "../../src/workbench/observability/classifyError";
import { isRetryableGenerationError } from "../../src/workbench/generationCanvas/runner/generationRetryPolicy";
import { isTransportLevelFailure, outboundRequestWasNeverWritten } from "../outboundDispatchEvidence";
import i18n from "../../src/i18n";

const vendor = { key: "fixture", authType: "none" } as Vendor;
const url = "https://fixture.invalid/media";
const submit = () => requestJson(vendor, "", "POST", url, {}, {}, {});

beforeEach(() => {
  setSubmitOutboundDepsForTests({
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
    isApplicationProxyActive: () => false,
  });
});
afterEach(() => {
  setSubmitOutboundDepsForTests(null);
  vi.unstubAllGlobals(); vi.useRealTimers();
  delete process.env.NOMI_VENDOR_HTTP_TIMEOUT_MS;
});

describe("media submission outcome safety across transports and consumers", () => {
  it("uses operation roles, not vendor names, for bounded response budgets", () => {
    expect(vendorHttpTimeoutMs("media-submit")).toBe(600_000);
    expect(vendorHttpTimeoutMs("query")).toBe(120_000);
    expect(vendorHttpTimeoutMs("configuration")).toBe(120_000);
    for (const kind of ["image", "video", "audio", "model3d"]) {
      expect(vendorRequestRole(kind, "create")).toBe("media-submit");
      expect(vendorRequestRole(kind, "query")).toBe("query");
      expect(vendorRequestRole(kind, "result")).toBe("query");
    }
    expect(vendorRequestRole("text")).toBe("submit");
    process.env.NOMI_VENDOR_HTTP_TIMEOUT_MS = "250";
    expect(vendorHttpTimeoutMs("media-submit")).toBe(250);
  });

  it("passes the same bounded budget through the actual undici compose boundary", () => {
    class Sink extends Dispatcher { dispatch = vi.fn(() => true); }
    const sink = new Sink();
    vendorResponseDispatcher(sink, 600_000).dispatch({ origin: "https://fixture.invalid", path: "/", method: "POST" }, {});
    expect(sink.dispatch).toHaveBeenCalledWith(expect.objectContaining({ headersTimeout: 600_000, bodyTimeout: 600_000 }), expect.anything());
  });

  it.each(["json", "multipart", "binary"])("%s media wait outlives 120s but stops at 600s exactly once", async (wire) => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));
    const options = { role: "media-submit" as const };
    let finished = false;
    const pending = (wire === "json" ? requestJson(vendor, "", "POST", url, {}, {}, {}, undefined, options)
      : wire === "multipart" ? requestMultipart(vendor, "", url, {}, {}, new FormData(), undefined, options)
      : requestBinary(vendor, "", "POST", url, {}, {}, {}, undefined, options)).catch((e) => { finished = true; return e; });
    await vi.advanceTimersByTimeAsync(120_001);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(480_000);
    const error = await pending;
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ category: "submission-unknown", retryable: false });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("caller cancellation during media wait remains immediate and is never a retry", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => { started = resolve; });
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      started();
    })));
    const pending = requestJson(vendor, "", "POST", url, {}, {}, {}, controller.signal, { role: "media-submit" }).catch((e) => e);
    await dispatched;
    const cancellation = new DOMException("cancelled", "AbortError");
    controller.abort(cancellation);
    expect(await pending).toBe(cancellation);
    expect(isRetryableGenerationError(cancellation)).toBe(false);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it.each(["json", "multipart", "binary"])("%s never suggests resubmission after pre-response timeout", async (wire) => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    const error = await (wire === "json" ? submit() : wire === "multipart"
      ? requestMultipart(vendor, "", url, {}, {}, new FormData())
      : requestBinary(vendor, "", "POST", url, {}, {}, {})).catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ category: "submission-unknown", retryable: false });
    expect(isRetryableGenerationError(new Error(encodeVendorErrorMessage(error)))).toBe(false);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it.each(["headers", "body"])("%s transport failure is unknown unless no-write evidence exists", async (phase) => {
    const cause = new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (phase === "headers") throw cause;
      return new Response(new ReadableStream({ start(c) { c.error(cause); } }));
    }));
    const error = await submit().catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ category: "submission-unknown", retryable: false });
    expect(isTransportLevelFailure(error)).toBe(false);
  });

  it("preserves proven no-connection evidence through the structured boundary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect failed"), { code: "ECONNREFUSED", syscall: "connect" }) }); }));
    const error = await submit().catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ category: "network", retryable: true });
    expect(outboundRequestWasNeverWritten(error)).toBe(true);
  });

  it.each(["code", "type"])("recognizes proxy %s generation_outcome_unknown and retains HTTP rejection categories", async (field) => {
    for (const status of [502, 401, 400]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { [field]: "generation_outcome_unknown", message: "unexpected EOF", retryable: false } }), { status })));
      const error = await submit().catch((e) => e);
      assert(error instanceof VendorRequestError);
      expect(error.structured).toMatchObject({ category: status === 502 ? "submission-unknown" : status === 401 ? "auth" : "input", retryable: false });
      if (status !== 502) continue;
      for (const language of ["zh-CN", "en"]) {
        await i18n.changeLanguage(language);
        const report = classifyGenerationError(encodeVendorErrorMessage(error));
        expect(report.kind).toBe("submission-unknown");
        expect(report.primary).toBe("reconcile");
        expect(report.secondary).toBe("release-regenerate");
        expect(report.hint).not.toMatch(/请求没发到|never reached|额度问题/);
        expect(isRetryableGenerationError(new Error(encodeVendorErrorMessage(error)))).toBe(false);
      }
      await i18n.changeLanguage("zh-CN");
    }
  });

  it("legacy unqualified timeout and fetch errors cannot authorize paid automatic retry", () => {
    for (const error of [new TypeError("Failed to fetch"), new Error("socket hang up"), new Error("request timeout")]) {
      expect(isRetryableGenerationError(error)).toBe(false);
    }
    const report = classifyGenerationError("request timeout");
    expect(report.hint).not.toMatch(/请求没发到|never reached|额度问题/);
  });

  it.each(["query", "configuration"] as const)("%s timeout keeps its non-submission role across IPC", async (role) => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    const error = await requestJson(vendor, "", "POST", url, {}, {}, {}, undefined, { role }).catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ category: "timeout", operationRole: role });
    const report = classifyGenerationError(encodeVendorErrorMessage(error));
    expect(report.kind).toBe(role === "query" ? "poll-timeout" : "network");
    if (role === "query") {
      expect(report.primary).toBe("reconcile");
      expect(report.secondary).toBeNull();
      expect(report.hint).toMatch(/原任务|original/);
    } else {
      expect(report.reason).toMatch(/验证回复|verification/);
      expect(report.hint).toMatch(/重新验证|verify again/);
      expect(report.hint).not.toContain("请求没发到服务商");
    }
  });
});
