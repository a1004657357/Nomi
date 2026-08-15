import { describe, expect, it } from 'vitest'
import { normalizeSelectionRect, selectionToPixelRect } from './screenshotCropGeometry'

// 归一化坐标是浮点（0.6-0.2 = 0.39999999999999997），用 toBeCloseTo 而不是 toEqual：
// 这些值只拿去算 CSS 百分比和取整后的像素，1e-9 的误差没有意义，钉死反而是假红。
const expectRect = (
  got: { x: number; y: number; width: number; height: number },
  want: { x: number; y: number; width: number; height: number },
) => {
  expect(got.x).toBeCloseTo(want.x, 6)
  expect(got.y).toBeCloseTo(want.y, 6)
  expect(got.width).toBeCloseTo(want.width, 6)
  expect(got.height).toBeCloseTo(want.height, 6)
}

describe('normalizeSelectionRect', () => {
  it('正常从左上拖到右下', () => {
    expectRect(normalizeSelectionRect({ x: 0.2, y: 0.1 }, { x: 0.6, y: 0.5 }), { x: 0.2, y: 0.1, width: 0.4, height: 0.4 })
  })

  it('反向拖（右下 → 左上）照样出正矩形，不出负宽高', () => {
    expectRect(normalizeSelectionRect({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 }), { x: 0.2, y: 0.1, width: 0.4, height: 0.4 })
  })

  it('拖出画面外会被夹回 0-1（鼠标甩到窗口外很常见）', () => {
    const rect = normalizeSelectionRect({ x: -0.5, y: -2 }, { x: 3, y: 1.4 })
    expect(rect).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('原地点一下 → 零面积（调用方据此判定「没框」→ 要整屏）', () => {
    const rect = normalizeSelectionRect({ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 })
    expect(rect.width).toBe(0)
    expect(rect.height).toBe(0)
  })
})

describe('selectionToPixelRect — 归一化 → 源图像素', () => {
  it('半宽半高的选区落在正中', () => {
    expect(selectionToPixelRect({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 1000, 800))
      .toEqual({ sx: 250, sy: 200, sw: 500, sh: 400 })
  })

  it('整屏', () => {
    expect(selectionToPixelRect({ x: 0, y: 0, width: 1, height: 1 }, 640, 480))
      .toEqual({ sx: 0, sy: 0, sw: 640, sh: 480 })
  })

  it('永不越界（右下角贴边也不会 sx+sw > 宽）', () => {
    const r = selectionToPixelRect({ x: 0.99, y: 0.99, width: 0.5, height: 0.5 }, 1000, 800)
    expect(r.sx + r.sw).toBeLessThanOrEqual(1000)
    expect(r.sy + r.sh).toBeLessThanOrEqual(800)
  })

  it('极小选区至少给 1px（0 宽高喂 drawImage 会画出空白）', () => {
    const r = selectionToPixelRect({ x: 0.5, y: 0.5, width: 0, height: 0 }, 1000, 800)
    expect(r.sw).toBeGreaterThanOrEqual(1)
    expect(r.sh).toBeGreaterThanOrEqual(1)
  })

  it('Retina：同一归一化选区在 2 倍图上给出 2 倍像素矩形（这就是用归一化坐标的理由）', () => {
    const sel = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
    const at1x = selectionToPixelRect(sel, 1440, 900)
    const at2x = selectionToPixelRect(sel, 2880, 1800)
    expect(at2x.sw).toBe(at1x.sw * 2)
    expect(at2x.sh).toBe(at1x.sh * 2)
  })
})
