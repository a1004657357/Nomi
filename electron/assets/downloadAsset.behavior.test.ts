// downloadAssetToDisk 行为集成测（2026-07-30「下载改保存名闪退」根因修复的逻辑铁证）。
// 崩溃本身在 Windows 原生层、mac 复现不出；但根因修复的**逻辑分支**能在这里锁死：
//   ① 改名场景（对话框返回的 filePath ≠ 默认名）→ 写到用户改后的路径；
//   ② 父窗口：有主窗口 → modal（窗口作第一参数）；无 → non-modal（options 作第一参数，全平台稳）；
//   ③ native/IO 异常 → 落 crashLog + 返回失败，绝不冒泡成 unhandledRejection；④ 取消不写盘。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  netFetch: vi.fn(),
  getMainWindow: vi.fn(),
  logCrash: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/dl" },
  dialog: { showSaveDialog: mocks.showSaveDialog },
  net: { fetch: mocks.netFetch },
}));
vi.mock("../mainWindowRegistry", () => ({ getMainWindow: mocks.getMainWindow }));
vi.mock("../crashLog", () => ({ logCrash: mocks.logCrash }));
vi.mock("../projects/repository", () => ({ resolveProjectRelativePath: (p: string, r: string) => `/proj/${p}/${r}` }));
vi.mock("./downloadPrefs", () => ({
  getLastDownloadDir: () => "",
  pickDownloadDir: (_last: string, downloads: string) => downloads,
  rememberDownloadDir: () => undefined,
}));
vi.mock("node:fs/promises", () => ({
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
  readFile: () => Promise.resolve(Buffer.from("")),
}));

import { downloadAssetToDisk } from "./downloadAsset";

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.netFetch.mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
});

describe("downloadAssetToDisk — 下载改名闪退根因修复的逻辑分支", () => {
  it("改名场景：写到用户改后的路径（filePath ≠ 默认名），不崩", async () => {
    mocks.getMainWindow.mockReturnValue({ id: 1 });
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/dl/我改的名.png" });
    const r = await downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "默认名" });
    expect(mocks.writeFile).toHaveBeenCalledWith("/tmp/dl/我改的名.png", expect.anything());
    expect(r).toEqual({ ok: true, path: "/tmp/dl/我改的名.png" });
  });

  it("有主窗口 → modal：窗口作 showSaveDialog 第一参数（根因修复：不再用 getFocusedWindow/辅助窗）", async () => {
    const win = { id: 42 };
    mocks.getMainWindow.mockReturnValue(win);
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/dl/a.png" });
    await downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "a" });
    expect(mocks.showSaveDialog.mock.calls[0][0]).toBe(win);
  });

  it("无主窗口 → non-modal：options 作第一参数（全平台稳，不附任何窗口）", async () => {
    mocks.getMainWindow.mockReturnValue(null);
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/dl/a.png" });
    await downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "a" });
    const firstArg = mocks.showSaveDialog.mock.calls[0][0];
    expect(firstArg).toHaveProperty("defaultPath");
  });

  it("对话框 native 异常 → 落 crashLog + 返回失败，绝不冒泡", async () => {
    mocks.getMainWindow.mockReturnValue(null);
    mocks.showSaveDialog.mockRejectedValue(new Error("native crash"));
    const r = await downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "a" });
    expect(mocks.logCrash).toHaveBeenCalledWith("assets:download", expect.any(Error));
    expect(r).toEqual({ ok: false });
  });

  it("用户取消 → {ok:false,canceled:true}，不写盘", async () => {
    mocks.getMainWindow.mockReturnValue(null);
    mocks.showSaveDialog.mockResolvedValue({ canceled: true });
    const r = await downloadAssetToDisk({ url: "https://x.com/a.png", suggestedName: "a" });
    expect(r).toEqual({ ok: false, canceled: true });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
