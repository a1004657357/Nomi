// 自动另存（集中设置页「自动另存」开关，2026-08-01）：生成完成时把生成物静默复制一份到用户设定目录，
// 省得每张手动下载（YAOYU168 多次提）。**只加副本，不动 Nomi 内部 nomi-local 存储**（零数据风险）。
//
// best-effort 铁律：关着 / 没设目录 / 取字节失败 / 写盘失败——一律返回 {ok:false} 不抛（绝不打断生成）。
// 同名不覆盖：自动另存多张同名镜头（都叫「镜头 1」）时加 -1/-2 后缀，不互相顶掉。
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fetchAssetBytes, sanitizeDownloadName } from "./downloadAsset";
import { getAutoSavePrefs } from "./downloadPrefs";
import { logCrash } from "../crashLog";

/** 目标已存在就加 -1/-2… 后缀，纯函数（存在性注入便于单测）。 */
export function uniqueSavePath(
  dir: string,
  name: string,
  exists: (p: string) => boolean = existsSync,
): string {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  let i = 1;
  while (exists(candidate)) {
    candidate = path.join(dir, `${base}-${i}${ext}`);
    i += 1;
  }
  return candidate;
}

/** 补扩展名：suggestedName 无扩展名时从 url 补（与 downloadAssetToDisk 同口径）。 */
export function autoSaveFileName(suggestedName: string, rawUrl: string): string {
  const ext = (() => {
    try {
      const e = path.extname(new URL(rawUrl).pathname);
      return e && e.length <= 6 ? e : "";
    } catch {
      return "";
    }
  })();
  let name = sanitizeDownloadName(String(suggestedName || ""));
  if (!name) name = `nomi-asset${ext || ".bin"}`;
  else if (!path.extname(name) && ext) name += ext;
  return name;
}

export async function autoSaveAssetToDisk(
  url: string,
  suggestedName: string,
): Promise<{ ok: boolean; path?: string }> {
  const { enabled, dir } = getAutoSavePrefs();
  if (!enabled || !dir) return { ok: false };
  const rawUrl = String(url || "").trim();
  if (!rawUrl) return { ok: false };
  try {
    const bytes = await fetchAssetBytes(rawUrl);
    await mkdir(dir, { recursive: true });
    const target = uniqueSavePath(dir, autoSaveFileName(suggestedName, rawUrl));
    await writeFile(target, bytes);
    return { ok: true, path: target };
  } catch (error) {
    logCrash("assets:auto-save", error);
    return { ok: false };
  }
}
