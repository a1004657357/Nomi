import { desktopT } from "../../desktopStrings";
import { BrowserWindow } from "electron";
import type { Rectangle, WebContents } from "electron";
import { browserViews, browserViewsByWindow } from "./browserViewState";
import type { BrowserViewIdPayload, BrowserViewRecord } from "./browserViewTypes";
import { isAllowedBrowserTarget } from "./browserAllowlist";
import { logWarn } from '../../logging/logger';

export function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function getSenderWindow(sender: WebContents): BrowserWindow {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || win.isDestroyed()) throw new Error("Browser window is unavailable");
  return win;
}

export function readViewId(payload: BrowserViewIdPayload): number {
  const value = Number(payload?.viewId);
  if (!Number.isFinite(value) || value <= 0) throw new Error("viewId is required");
  return value;
}

export function getBrowserViewForSender(sender: WebContents, payload: BrowserViewIdPayload): BrowserViewRecord {
  const record = browserViews.get(readViewId(payload));
  if (!record) throw new Error("Browser view not found");
  const win = getSenderWindow(sender);
  const parent = win.getParentWindow();
  if (record.ownerWindowId !== win.id && record.ownerWindowId !== parent?.id) {
    throw new Error("Browser view belongs to another window");
  }
  return record;
}

export function bringBrowserViewToFront(record: BrowserViewRecord): void {
  const win = BrowserWindow.fromId(record.ownerWindowId);
  if (!win || win.isDestroyed()) return;
  win.contentView.addChildView(record.view);
}

export function normalizeBounds(bounds: Partial<Rectangle> | undefined): Rectangle {
  const x = Math.max(0, Math.round(Number(bounds?.x ?? 0)));
  const y = Math.max(0, Math.round(Number(bounds?.y ?? 0)));
  const width = Math.max(0, Math.round(Number(bounds?.width ?? 0)));
  const height = Math.max(0, Math.round(Number(bounds?.height ?? 0)));
  return { x, y, width, height };
}

export function sameRectangle(left: Rectangle | null | undefined, right: Rectangle | null | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

export function normalizeBrowserUrl(url: unknown): string {
  const value = String(url || "").trim();
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) browser URLs are supported");
  }
  // Gate 7 P1（§22.3 browser bridge allowlist）：检查目标站点是否在 allowlist。
  // 渐进落地：默认只**记录**违规（enforce 仅在 NOMI_BROWSER_ALLOWLIST_ENFORCE=1 时拒），
  // 避免破坏既有合法导航（用户可能打开新 Provider 站点）。记录的违规供安全审计追踪；
  // 稳定后可翻转默认为 enforce。allowlist 内容见 browserAllowlist.ts，可经
  // addBrowserAllowlistEntry 扩展（加新 Provider web 桥时）。
  const allowlistResult = isAllowedBrowserTarget(parsed.toString());
  if (!allowlistResult.allowed) {
    const enforce = process.env.NOMI_BROWSER_ALLOWLIST_ENFORCE === "1";
    // 记录违规（不论是否 enforce，供审计）；enforce 时抛错
    logWarn('browser', 'allowlist-target-unlisted', { enforced: enforce, reason: allowlistResult.reason });
    if (enforce) {
      throw new Error(desktopT("custom.browser.core.browserViewUtils.text1", { value0: `${allowlistResult.reason}` }));
    }
  }
  return parsed.toString();
}

export function normalizePromptExtractionMode(value: unknown): "replicate" | "style" {
  return value === "style" ? "style" : "replicate";
}

export function sendBrowserViewState(record: BrowserViewRecord): void {
  const win = BrowserWindow.fromId(record.ownerWindowId);
  if (!win || win.isDestroyed()) return;
  const contents = record.view.webContents;
  win.webContents.send("browser:view:state", {
    viewId: record.viewId,
    tabId: record.tabId,
    url: contents.getURL(),
    title: contents.getTitle(),
    canGoBack: contents.canGoBack(),
    canGoForward: contents.canGoForward(),
    loading: contents.isLoading(),
  });
}

export function destroyBrowserView(record: BrowserViewRecord): void {
  browserViews.delete(record.viewId);
  browserViewsByWindow.get(record.ownerWindowId)?.delete(record.viewId);
  const win = BrowserWindow.fromId(record.ownerWindowId);
  void record.view.webContents.session.cookies.flushStore().catch(() => undefined);
  try {
    record.view.setVisible(false);
    win?.contentView.removeChildView(record.view);
  } catch {
    // The owner window may already be closing.
  }
  if (!record.view.webContents.isDestroyed()) {
    record.view.webContents.close({ waitForBeforeUnload: false });
  }
}
