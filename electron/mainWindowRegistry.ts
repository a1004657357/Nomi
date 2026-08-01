// 主窗口注册表：给需要「可靠父窗口」的原生调用（保存/打开对话框等）一个确定的主窗口引用。
//
// 为什么必要（2026-07-30 群反馈「下载文件改保存名会闪退」根因）：Nomi 同时开多个 BrowserWindow
// （主窗 + 浏览器视图菜单窗 browserViewChromeMenu + 叠加窗 browserViewOverlay）。原来 downloadAsset
// 用 `BrowserWindow.getFocusedWindow() || getAllWindows()[0]` 取父窗口——这两者都可能拿到辅助/
// 短生命周期窗口；把 modal 保存对话框附到这种父窗口，Windows 原生层会崩（整个 app 闪退）。
// main.ts 在建/销毁主窗口时登记这里，消费方取「仍存活的主窗口」；拿不到则由调用方走 non-modal
// （不附父窗口的对话框在所有平台都稳，见 workspaceIpc 的 showOpenDialog 先例）。
import type { BrowserWindow } from "electron";

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win && !win.isDestroyed() ? win : null;
}

/** 仍存活的主窗口；已销毁/未登记 → null（调用方据此回退 non-modal）。 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}
