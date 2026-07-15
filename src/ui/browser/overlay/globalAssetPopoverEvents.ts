// 素材盒事件（方案一 2026-07-12 收敛后）：素材盒只作浏览器伴生弹层，
// 全局浮窗/contextual 路由已删——这里只剩浏览器弹层开合 + 拖上画布两组事件。
const BROWSER_ASSET_POPOVER_EVENT = 'nomi-browser-asset-popover-open'
const BROWSER_ASSET_IMPORT_TO_CANVAS_EVENT = 'nomi-browser-asset-import-to-canvas'

export type BrowserAssetPopoverEventDetail = {
  opened: boolean
}

export type BrowserAssetCanvasImportItem = {
  id: string
  type: 'image' | 'video' | 'prompt'
  title: string
  subtitle?: string
  previewUrl?: string
  prompt?: string
}

export type BrowserAssetCanvasImportEventDetail = {
  assets: BrowserAssetCanvasImportItem[]
}

export function dispatchBrowserAssetPopoverOpen(opened: boolean): void {
  window.dispatchEvent(
    new CustomEvent<BrowserAssetPopoverEventDetail>(BROWSER_ASSET_POPOVER_EVENT, { detail: { opened } }),
  )
}

export function dispatchBrowserAssetsImportToCanvas(assets: readonly BrowserAssetCanvasImportItem[]): void {
  window.dispatchEvent(
    new CustomEvent<BrowserAssetCanvasImportEventDetail>(BROWSER_ASSET_IMPORT_TO_CANVAS_EVENT, {
      detail: { assets: [...assets] },
    }),
  )
}

export function subscribeBrowserAssetPopoverOpen(
  callback: (opened: boolean, detail: BrowserAssetPopoverEventDetail) => void,
): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<BrowserAssetPopoverEventDetail>).detail
    callback(Boolean(detail?.opened), { opened: Boolean(detail?.opened) })
  }
  window.addEventListener(BROWSER_ASSET_POPOVER_EVENT, listener)
  return () => window.removeEventListener(BROWSER_ASSET_POPOVER_EVENT, listener)
}

export function subscribeBrowserAssetsImportToCanvas(
  callback: (assets: BrowserAssetCanvasImportItem[], detail: BrowserAssetCanvasImportEventDetail) => void,
): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<BrowserAssetCanvasImportEventDetail>).detail
    const assets = Array.isArray(detail?.assets) ? detail.assets : []
    callback(assets, { assets })
  }
  window.addEventListener(BROWSER_ASSET_IMPORT_TO_CANVAS_EVENT, listener)
  return () => window.removeEventListener(BROWSER_ASSET_IMPORT_TO_CANVAS_EVENT, listener)
}
