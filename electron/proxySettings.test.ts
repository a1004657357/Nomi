import { describe, expect, it } from "vitest";
import { DEFAULT_PROXY_PREFS, normalizeProxyPrefs } from "./proxySettings";

describe("normalizeProxyPrefs — 代理偏好归一（读坏了也不能拖垮启动）", () => {
  it("空/非对象 → 默认跟随系统", () => {
    expect(normalizeProxyPrefs(undefined)).toEqual(DEFAULT_PROXY_PREFS);
    expect(normalizeProxyPrefs(null)).toEqual(DEFAULT_PROXY_PREFS);
    expect(normalizeProxyPrefs("garbage")).toEqual(DEFAULT_PROXY_PREFS);
    expect(normalizeProxyPrefs(42)).toEqual(DEFAULT_PROXY_PREFS);
  });

  it("非法 mode → 退回跟随系统（手改坏 json 不该把用户扔进意外的直连）", () => {
    expect(normalizeProxyPrefs({ mode: "socks" }).mode).toBe("system");
    expect(normalizeProxyPrefs({ mode: 123 }).mode).toBe("system");
  });

  it("三个合法 mode 原样保留", () => {
    expect(normalizeProxyPrefs({ mode: "system" }).mode).toBe("system");
    expect(normalizeProxyPrefs({ mode: "off" }).mode).toBe("off");
    expect(normalizeProxyPrefs({ mode: "custom", customUrl: "http://127.0.0.1:7897" })).toEqual({
      mode: "custom",
      customUrl: "http://127.0.0.1:7897",
    });
  });

  it("custom 但没填地址 → 按跟随系统跑，不静默扔进直连", () => {
    expect(normalizeProxyPrefs({ mode: "custom" })).toEqual({ mode: "system", customUrl: "" });
    expect(normalizeProxyPrefs({ mode: "custom", customUrl: "   " })).toEqual({ mode: "system", customUrl: "" });
  });

  it("地址两端空白去掉（用户从剪贴板粘进来常带空格）", () => {
    expect(normalizeProxyPrefs({ mode: "custom", customUrl: "  http://127.0.0.1:7897  " }).customUrl).toBe(
      "http://127.0.0.1:7897",
    );
  });

  it("非 custom 模式也保留已填地址：切回来不用重打", () => {
    expect(normalizeProxyPrefs({ mode: "off", customUrl: "http://127.0.0.1:7897" })).toEqual({
      mode: "off",
      customUrl: "http://127.0.0.1:7897",
    });
  });
});
