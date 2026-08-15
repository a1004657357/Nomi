/**
 * 联系表（宫格）排版的纯几何。
 *
 * 用户 2026-08-02 从两种「宫格」里拍板的是这一种：**把选中的成图按格子排成一张，导出给客户/团队看整场戏**
 * （另一种「多图输入容器」明确不做——那是参考槽语义，和「组端口」是同一件事的两种外形，做了就是并行版）。
 *
 * 刻意**不新增节点 kind**：产物就是一张普通图片，落成普通 image 节点。
 * 画法沿用仓里已有的 canvas 2D（切图九宫格同一套 drawImage + toDataURL），不引第三方。
 *
 * 每格用 **contain**（整张放进去、留边）而不是 cover：联系表是拿来「看清每一镜」的，
 * 裁掉画面边缘就失去意义了——宁可留白，不许裁。
 */

export type ContactSheetCell = {
  /** 第几张（0-based），用来取图和标号。 */
  index: number
  /** 格子在成品图里的位置与大小（含内边距后的可绘制区）。 */
  x: number
  y: number
  width: number
  height: number
  /** 标号条（格子底部）的位置；captionHeight 为 0 时与格子等高、不占位。 */
  captionY: number
}

export type ContactSheetLayout = {
  width: number
  height: number
  columns: number
  rows: number
  cells: ContactSheetCell[]
}

export const CONTACT_SHEET_DEFAULTS = {
  /** 单格可绘制区宽度（px）。整张成品宽 = columns × 这个 + 间距。 */
  cellWidth: 480,
  cellHeight: 270,
  gap: 16,
  padding: 24,
  captionHeight: 30,
} as const

/** 张数 → 列数：尽量接近正方形，但每行不超过 4（再宽就看不清了）。 */
export function contactSheetColumns(count: number, max = 4): number {
  if (count <= 1) return 1
  return Math.min(max, Math.ceil(Math.sqrt(count)))
}

export function computeContactSheetLayout(params: {
  count: number
  columns?: number
  cellWidth?: number
  cellHeight?: number
  gap?: number
  padding?: number
  captionHeight?: number
}): ContactSheetLayout {
  const count = Math.max(0, Math.floor(params.count))
  const cellWidth = params.cellWidth ?? CONTACT_SHEET_DEFAULTS.cellWidth
  const cellHeight = params.cellHeight ?? CONTACT_SHEET_DEFAULTS.cellHeight
  const gap = params.gap ?? CONTACT_SHEET_DEFAULTS.gap
  const padding = params.padding ?? CONTACT_SHEET_DEFAULTS.padding
  const captionHeight = params.captionHeight ?? CONTACT_SHEET_DEFAULTS.captionHeight
  const columns = Math.max(1, params.columns ?? contactSheetColumns(count))
  const rows = Math.max(1, Math.ceil(count / columns))
  const slotHeight = cellHeight + captionHeight

  const cells: ContactSheetCell[] = Array.from({ length: count }, (_, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const x = padding + col * (cellWidth + gap)
    const y = padding + row * (slotHeight + gap)
    return { index, x, y, width: cellWidth, height: cellHeight, captionY: y + cellHeight }
  })

  return {
    width: padding * 2 + columns * cellWidth + Math.max(0, columns - 1) * gap,
    height: padding * 2 + rows * slotHeight + Math.max(0, rows - 1) * gap,
    columns,
    rows,
    cells,
  }
}

/**
 * 把一张 sw×sh 的图 **contain** 进 cw×ch 的格子：返回居中的绘制矩形。
 * 源尺寸不合法（0 / NaN）时退化成铺满格子，绝不返回 NaN 让 drawImage 画出空白。
 */
export function containRect(
  sw: number,
  sh: number,
  cw: number,
  ch: number,
): { x: number; y: number; width: number; height: number } {
  if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw <= 0 || sh <= 0) {
    return { x: 0, y: 0, width: cw, height: ch }
  }
  const scale = Math.min(cw / sw, ch / sh)
  const width = Math.round(sw * scale)
  const height = Math.round(sh * scale)
  return { x: Math.round((cw - width) / 2), y: Math.round((ch - height) / 2), width, height }
}
