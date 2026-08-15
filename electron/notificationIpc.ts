// 系统通知 IPC（从 main.ts 拆出，那边 775/800 行只剩余量给两行注册；后续通知通道加这里，别回填 main.ts）。
// 用途：批量生成跑完时，若 Nomi 窗口不在前台 → 发一条原生通知，点它回到 Nomi。
// 方案：docs/plan/2026-08-02-task-center-queue.md
//
// 为什么走主进程而不是渲染层的 HTML5 Notification：只有主进程这边点击回调能真正把窗口
// show()+focus() 拉回前台（渲染层的 window.focus() 在 macOS 上不可靠）。
import { BrowserWindow, Notification, ipcMain } from "electron";

type NotifyPayload = {
  title?: unknown;
  body?: unknown;
  /** true = 不要 OS 提示音（用户在应用内关了「声音」时传 true）。 */
  silent?: unknown;
};

function focusMainWindow(): void {
  // 通知可能在窗口最小化时被点：先 restore 再 show+focus，否则 macOS 上只是抢焦点、窗口仍收着。
  const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// 异步通道（ipcMain.handle）而非 registerSyncIpc：发通知没必要阻塞渲染层。
export function registerNotificationIpc(): void {
  ipcMain.handle("nomi:notifications:show", (_event, payload: unknown) => {
    const input = (payload || {}) as NotifyPayload;
    const title = String(input.title || "").trim();
    if (!title) return { ok: false, reason: "empty-title" };
    // Linux 部分环境 / 未授权时不支持：老实回 false，调用端据此降级到自制提示音，别假装发了。
    if (!Notification.isSupported()) return { ok: false, reason: "unsupported" };
    const notification = new Notification({
      title,
      body: String(input.body || ""),
      silent: input.silent === true,
    });
    notification.on("click", focusMainWindow);
    notification.show();
    return { ok: true };
  });
}
