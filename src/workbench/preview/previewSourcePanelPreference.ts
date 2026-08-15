const PREVIEW_SOURCE_COLLAPSED_KEY = 'nomi.previewSourcePanel.collapsed'

/**
 * 剪辑页左栏折叠态的落盘读写（从 workbenchStore 外移，守 R9 800 行上限）。
 * 默认展开——剪辑软件通行布局是左侧素材区；用户主动收起过才记住。
 */
export function readPreviewSourceCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(PREVIEW_SOURCE_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function writePreviewSourceCollapsed(collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(PREVIEW_SOURCE_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* 私有模式等存不了 → 只作用本次会话 */
  }
}
