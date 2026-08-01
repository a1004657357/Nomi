// 把生成结果（本地 nomi-local 资源 或 远端 http(s) 链接）另存到用户选定位置，默认落「下载」目录。
// 统一一条下载路径：图片/视频/素材都走这里（按 url 协议取字节，不为不同类型分叉）。从 main.ts 抽出（规则 12 巨壳净减）。
import { app, dialog, net } from "electron";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolveProjectRelativePath } from "../projects/repository";
import { getMainWindow } from "../mainWindowRegistry";
import { logCrash } from "../crashLog";
import { getLastDownloadDir, pickDownloadDir, rememberDownloadDir } from "./downloadPrefs";

function isDirectory(dir: string): boolean {
  try {
    return existsSync(dir) && statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function sanitizeDownloadName(name: string): string {
  // 去控制字符（\p{Cc} 含 0x00-0x1F/0x7F-0x9F）+ 文件系统非法字符；折叠空白。保留中英文/数字/连字符。
  let s = name.replace(/\p{Cc}/gu, "").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  // Windows：文件名不能以「.」或空格结尾——否则原生保存对话框拿 defaultPath 时可能异常（闪退面之一）。
  s = s.replace(/[. ]+$/g, "").trim();
  // Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）整段占用即非法 → 加前缀避开。
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)) s = `_${s}`;
  return s.slice(0, 120);
}

/** 取资产字节（本地 nomi-local 读盘 / 远端 http(s) 下载）。下载与自动另存共用单一真相，不各抄一份。 */
export async function fetchAssetBytes(rawUrl: string): Promise<Buffer> {
  if (rawUrl.startsWith("nomi-local://")) {
    const url = new URL(rawUrl);
    const [projectId, ...relativeParts] = decodeURIComponent(url.pathname.replace(/^\/+/, "")).split("/");
    return readFile(resolveProjectRelativePath(projectId, relativeParts.join("/")));
  }
  if (/^https?:/i.test(rawUrl)) {
    const response = await net.fetch(rawUrl);
    if (!response.ok) throw new Error(`下载失败（${response.status}）`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("不支持的资源地址");
}

export async function downloadAssetToDisk(
  payload: { url?: unknown; suggestedName?: unknown } | null,
): Promise<{ ok: boolean; canceled?: boolean; path?: string }> {
  const rawUrl = String(payload?.url || "").trim();
  if (!rawUrl) throw new Error("url is required");
  const bytes = await fetchAssetBytes(rawUrl);
  const fallbackExt = (() => {
    try {
      const ext = path.extname(new URL(rawUrl).pathname);
      return ext && ext.length <= 6 ? ext : "";
    } catch {
      return "";
    }
  })();
  let suggested = sanitizeDownloadName(String(payload?.suggestedName || ""));
  if (!suggested) suggested = `nomi-asset${fallbackExt || ".bin"}`;
  else if (!path.extname(suggested) && fallbackExt) suggested += fallbackExt;
  // 默认目录：上次另存到的目录（仍存在）优先，否则系统下载夹——省得每次手动导航（fb-20260724）。
  const baseDir = pickDownloadDir(getLastDownloadDir(), app.getPath("downloads"), isDirectory);
  // 父窗口必须是可靠的主窗口：Nomi 有多个 BrowserWindow（浏览器菜单/叠加窗），把 modal 保存对话框
  // 附到辅助/短生命周期窗口，Windows 原生层会崩（用户报「下载改保存名闪退」根因）。主窗口拿不到就走
  // non-modal（不传父窗口，全平台稳，同 workspaceIpc 的 showOpenDialog 先例）。整段包 try/catch：
  // native/IO 异常落崩溃日志 + 返回失败，绝不冒泡成 unhandledRejection，并给下次留证据。
  const parent = getMainWindow();
  const dialogOptions = { defaultPath: path.join(baseDir, suggested) };
  try {
    const result = parent
      ? await dialog.showSaveDialog(parent, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await mkdir(path.dirname(result.filePath), { recursive: true }).catch(() => undefined); // 目标目录兜底
    await writeFile(result.filePath, bytes);
    rememberDownloadDir(path.dirname(result.filePath)); // 记住这次目录，下次默认弹到这里
    return { ok: true, path: result.filePath };
  } catch (error) {
    logCrash("assets:download", error);
    return { ok: false };
  }
}
