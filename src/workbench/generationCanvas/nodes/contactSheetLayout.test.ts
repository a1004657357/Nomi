import { describe, expect, it } from 'vitest'
import { computeContactSheetLayout, contactSheetColumns, containRect } from './contactSheetLayout'

describe('contactSheetColumns — 尽量方，但每行不超过 4', () => {
  it.each([[1, 1], [2, 2], [4, 2], [5, 3], [9, 3], [10, 4], [16, 4], [30, 4]])(
    '%i 张 → %i 列',
    (count, expected) => {
      expect(contactSheetColumns(count)).toBe(expected)
    },
  )

  it('0 张也给 1 列（不产生 0 除）', () => {
    expect(contactSheetColumns(0)).toBe(1)
  })
})

describe('computeContactSheetLayout', () => {
  const opts = { cellWidth: 100, cellHeight: 60, gap: 10, padding: 20, captionHeight: 20 }

  it('单张：成品尺寸 = 内边距 + 一格（含标号条）', () => {
    const layout = computeContactSheetLayout({ count: 1, ...opts })
    expect(layout).toMatchObject({ width: 140, height: 120, columns: 1, rows: 1 })
    expect(layout.cells[0]).toEqual({ index: 0, x: 20, y: 20, width: 100, height: 60, captionY: 80 })
  })

  it('同一行往右推进一个「格宽 + 间距」', () => {
    const layout = computeContactSheetLayout({ count: 2, columns: 2, ...opts })
    expect(layout.cells[1]?.x).toBe(130)
    expect(layout.cells[1]?.y).toBe(20)
  })

  it('换行往下推进一个「格高 + 标号条 + 间距」', () => {
    const layout = computeContactSheetLayout({ count: 3, columns: 2, ...opts })
    expect(layout.cells[2]).toMatchObject({ x: 20, y: 110 })
    expect(layout.rows).toBe(2)
  })

  it('最后一行不满也不塌高度（留空位，成品仍是整齐矩形）', () => {
    const layout = computeContactSheetLayout({ count: 3, columns: 2, ...opts })
    expect(layout.height).toBe(20 * 2 + 2 * 80 + 10)
  })

  it('captionHeight=0 时标号条不占位', () => {
    const layout = computeContactSheetLayout({ count: 2, columns: 1, ...opts, captionHeight: 0 })
    expect(layout.cells[1]?.y).toBe(20 + 60 + 10)
    expect(layout.cells[0]?.captionY).toBe(80)
  })

  it('0 张 → 空 cells，尺寸仍合法（不产生 NaN / 负数）', () => {
    const layout = computeContactSheetLayout({ count: 0, ...opts })
    expect(layout.cells).toEqual([])
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })
})

describe('containRect — 整张放进去，绝不裁', () => {
  it('宽图：左右撑满、上下留白', () => {
    expect(containRect(200, 100, 100, 100)).toEqual({ x: 0, y: 25, width: 100, height: 50 })
  })

  it('高图：上下撑满、左右留白', () => {
    expect(containRect(100, 200, 100, 100)).toEqual({ x: 25, y: 0, width: 50, height: 100 })
  })

  it('同比例：正好铺满', () => {
    expect(containRect(200, 100, 400, 200)).toEqual({ x: 0, y: 0, width: 400, height: 200 })
  })

  it('绘制矩形永不超出格子（这就是「不裁」的量化保证）', () => {
    for (const [sw, sh] of [[3000, 17], [17, 3000], [1, 1], [1920, 1080]]) {
      const r = containRect(sw as number, sh as number, 480, 270)
      expect(r.width).toBeLessThanOrEqual(480)
      expect(r.height).toBeLessThanOrEqual(270)
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
    }
  })

  it('源尺寸非法 → 退化成铺满，不返回 NaN（NaN 喂 drawImage 会画出空白）', () => {
    expect(containRect(0, 0, 100, 50)).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(containRect(Number.NaN, 10, 100, 50)).toEqual({ x: 0, y: 0, width: 100, height: 50 })
  })
})
