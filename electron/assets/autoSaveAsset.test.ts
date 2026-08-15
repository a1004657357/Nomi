// 自动另存 runtime（集中设置页首批项）。核心：best-effort（关/失败绝不打断生成）+ 同名不覆盖。
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAutoSavePrefs: vi.fn(),
  fetchAssetBytes: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  logCrash: vi.fn(),
}));
vi.mock("./downloadPrefs", () => ({ getAutoSavePrefs: mocks.getAutoSavePrefs }));
vi.mock("./downloadAsset", () => ({
  fetchAssetBytes: mocks.fetchAssetBytes,
  sanitizeDownloadName: (n: string) => n.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 120),
}));
vi.mock("node:fs/promises", () => ({ writeFile: mocks.writeFile, mkdir: mocks.mkdir }));
vi.mock("node:fs", () => ({ existsSync: () => false }));
vi.mock("../crashLog", () => ({ logCrash: mocks.logCrash }));

import { autoSaveAssetToDisk, autoSaveFileName, uniqueSavePath } from "./autoSaveAsset";

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
});

describe("uniqueSavePath — 同名不覆盖", () => {
  // 实现走 path.join → 期望值按宿主分隔符算，Windows 上才不恒红（同 e3f45787 先例）
  it("不存在 → 原名", () => {
    expect(uniqueSavePath("/d", "a.png", () => false)).toBe(path.join("/d", "a.png"));
  });
  it("已存在 → 加 -1；连续存在 → -2", () => {
    const taken = new Set([path.join("/d", "a.png"), path.join("/d", "a-1.png")]);
    expect(uniqueSavePath("/d", "a.png", (p) => taken.has(p))).toBe(path.join("/d", "a-2.png"));
  });
});

describe("autoSaveFileName — 扩展名补齐", () => {
  it("无扩展名 → 从 url 补", () => {
    expect(autoSaveFileName("镜头 1", "https://x.com/a.png")).toBe("镜头 1.png");
  });
  it("已有扩展名 → 保留", () => {
    expect(autoSaveFileName("a.jpg", "https://x.com/a.png")).toBe("a.jpg");
  });
  it("空名 → 兜底 nomi-asset", () => {
    expect(autoSaveFileName("", "https://x.com/a.png")).toBe("nomi-asset.png");
  });
});

describe("autoSaveAssetToDisk — best-effort", () => {
  it("关闭 → no-op，不取字节、不写盘", async () => {
    mocks.getAutoSavePrefs.mockReturnValue({ enabled: false, dir: "" });
    const r = await autoSaveAssetToDisk("https://x.com/a.png", "a");
    expect(r).toEqual({ ok: false });
    expect(mocks.fetchAssetBytes).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("开启但没设目录 → no-op", async () => {
    mocks.getAutoSavePrefs.mockReturnValue({ enabled: true, dir: "" });
    expect(await autoSaveAssetToDisk("https://x.com/a.png", "a")).toEqual({ ok: false });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("开启+目录 → 取字节 + 写盘，返回落盘路径", async () => {
    mocks.getAutoSavePrefs.mockReturnValue({ enabled: true, dir: "/save" });
    mocks.fetchAssetBytes.mockResolvedValue(Buffer.from("x"));
    const r = await autoSaveAssetToDisk("https://x.com/a.png", "镜头");
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    expect(r.path).toContain("镜头.png");
  });

  it("取字节失败 → {ok:false} 不抛 + 落 crashLog（绝不打断生成）", async () => {
    mocks.getAutoSavePrefs.mockReturnValue({ enabled: true, dir: "/save" });
    mocks.fetchAssetBytes.mockRejectedValue(new Error("network"));
    const r = await autoSaveAssetToDisk("https://x.com/a.png", "a");
    expect(r).toEqual({ ok: false });
    expect(mocks.logCrash).toHaveBeenCalledWith("assets:auto-save", expect.any(Error));
  });
});
