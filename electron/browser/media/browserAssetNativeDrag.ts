import { app, nativeImage } from "electron";
import type { NativeImage, WebContents } from "electron";
import path from "node:path";
import { absolutePathFromLocalAssetUrlAnyProject } from "../../assets/localAssetFile";

export type BrowserAssetNativeDragPayload = {
  url?: unknown;
};

function fallbackDragIcon(): NativeImage {
  const candidates = [
    path.join(app.getAppPath(), "build", "icon.png"),
    path.join(process.resourcesPath, "build", "icon.png"),
  ];
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) return image.resize({ width: 64, height: 64, quality: "good" });
  }
  return nativeImage.createEmpty();
}

export function startBrowserAssetNativeDrag(
  contents: WebContents,
  payload: BrowserAssetNativeDragPayload,
): { ok: true; filePath: string } | { ok: false; error: string } {
  const filePath = absolutePathFromLocalAssetUrlAnyProject(payload?.url);
  if (!filePath) {
    return { ok: false, error: "该素材还不是本地文件，先等待生成结果保存完成后再拖入网页。" };
  }

  let icon = nativeImage.createFromPath(filePath);
  if (icon.isEmpty()) icon = fallbackDragIcon();
  else icon = icon.resize({ width: 64, height: 64, quality: "good" });
  if (icon.isEmpty()) {
    return { ok: false, error: "无法创建文件拖拽预览。" };
  }

  contents.startDrag({ file: filePath, icon });
  return { ok: true, filePath };
}
