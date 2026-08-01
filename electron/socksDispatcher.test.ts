import { describe, expect, it } from "vitest";
import { parseSocksProxyUrl } from "./socksDispatcher";

describe("parseSocksProxyUrl — SOCKS 地址解析", () => {
  it("socks5:// → type 5", () => {
    expect(parseSocksProxyUrl("socks5://127.0.0.1:7897")).toEqual({ host: "127.0.0.1", port: 7897, type: 5 });
  });

  // Chromium/PAC 的裸 `SOCKS` 是 SOCKS4，握手与 5 不同；当成 5 发会连不上。
  it("socks4:// / socks4a:// → type 4", () => {
    expect(parseSocksProxyUrl("socks4://10.0.0.1:1080")).toMatchObject({ type: 4 });
    expect(parseSocksProxyUrl("socks4a://10.0.0.1:1080")).toMatchObject({ type: 4 });
  });

  it("裸 socks:// 与 socks5h:// 按 5 走", () => {
    expect(parseSocksProxyUrl("socks://127.0.0.1:1080")).toMatchObject({ type: 5 });
    expect(parseSocksProxyUrl("socks5h://127.0.0.1:1080")).toMatchObject({ type: 5 });
  });

  it("带账号密码（URL 里 percent-encoded 的要解回来）", () => {
    expect(parseSocksProxyUrl("socks5://me:p%40ss@10.0.0.1:1080")).toEqual({
      host: "10.0.0.1",
      port: 1080,
      type: 5,
      userId: "me",
      password: "p@ss",
    });
  });

  it("主机名（非 IP）也认", () => {
    expect(parseSocksProxyUrl("socks5://proxy.corp.local:1080")).toMatchObject({ host: "proxy.corp.local" });
  });

  /**
   * 认不出必须返回 null → 调用方判 unsupported 并如实告知。
   * 绝不能"解析失败就当直连"——那会让用户以为代理生效了，是最坏的一种谎。
   */
  it("非 socks / 缺端口 / 端口非法 → null", () => {
    expect(parseSocksProxyUrl("http://127.0.0.1:7897")).toBeNull();
    expect(parseSocksProxyUrl("socks5://127.0.0.1")).toBeNull(); // 没端口
    expect(parseSocksProxyUrl("socks5://:::")).toBeNull();
    expect(parseSocksProxyUrl("socks5://")).toBeNull();
    expect(parseSocksProxyUrl("")).toBeNull();
    expect(parseSocksProxyUrl("   ")).toBeNull();
  });

  it("两端空白无所谓（用户从剪贴板粘的常带空格）", () => {
    expect(parseSocksProxyUrl("  socks5://127.0.0.1:7897  ")).toMatchObject({ port: 7897 });
  });
});
