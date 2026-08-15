import { describe, expect, it } from 'vitest'
import {
  filterShotCuts,
  formatShotTimestamp,
  shotCutNodePositions,
  shotSheetRows,
  shotSheetTileStyle,
} from './shotCutSelection'

const cuts = [
  { seconds: 2, score: 0.67 },
  { seconds: 4, score: 0.22 },
  { seconds: 6, score: 0.51 },
  { seconds: 9, score: 0.13 },
]

describe('filterShotCuts — 灵敏度过滤保住原始下标', () => {
  it('低阈值全留', () => {
    expect(filterShotCuts(cuts, 0.1).map((c) => c.index)).toEqual([0, 1, 2, 3])
  })

  it('调高阈值只留强切点，**下标不重编**（联系表切格靠它）', () => {
    const kept = filterShotCuts(cuts, 0.5)
    expect(kept.map((c) => c.seconds)).toEqual([2, 6])
    expect(kept.map((c) => c.index)).toEqual([0, 2])
  })

  it('阈值高过所有分数 → 空', () => {
    expect(filterShotCuts(cuts, 0.9)).toEqual([])
  })

  it('等于阈值算留下（>=，不是 >）', () => {
    expect(filterShotCuts([{ seconds: 1, score: 0.3 }], 0.3)).toHaveLength(1)
  })
})

describe('shotSheetTileStyle — 联系表切格', () => {
  it('第 0 格在左上', () => {
    expect(shotSheetTileStyle(0, 8, 2)).toEqual({ backgroundSize: '800% 200%', backgroundPosition: '0% 0%' })
  })

  it('同一行往右推进', () => {
    expect(shotSheetTileStyle(7, 8, 2).backgroundPosition).toBe('100% 0%')
  })

  it('换行后落到第二行', () => {
    expect(shotSheetTileStyle(8, 8, 2).backgroundPosition).toBe('0% 100%')
  })

  it('单列/单行不除以 0', () => {
    expect(shotSheetTileStyle(0, 1, 1)).toEqual({ backgroundSize: '100% 100%', backgroundPosition: '0% 0%' })
  })
})

describe('shotSheetRows — 必须与主进程同一算式', () => {
  it.each([[1, 8, 1], [8, 8, 1], [9, 8, 2], [16, 8, 2], [17, 8, 3]])(
    '%i 个切点 / %i 列 → %i 行',
    (total, cols, expected) => {
      expect(shotSheetRows(total, cols)).toBe(expected)
    },
  )

  it('0 个切点也至少 1 行（不产生 tile=Nx0）', () => {
    expect(shotSheetRows(0, 8)).toBe(1)
  })
})

describe('formatShotTimestamp', () => {
  it.each([[0, '0:00'], [7, '0:07'], [65, '1:05'], [600, '10:00'], [3671, '1:01:11']])(
    '%i 秒 → %s',
    (seconds, expected) => {
      expect(formatShotTimestamp(seconds)).toBe(expected)
    },
  )

  it('小数秒向下取整', () => {
    expect(formatShotTimestamp(9.87)).toBe('0:09')
  })
})

describe('shotCutNodePositions — 成组紧凑网格', () => {
  const origin = { x: 100, y: 200 }
  const sourceSize = { width: 320, height: 180 }

  it('从源视频右侧开始，逐列铺开', () => {
    const positions = shotCutNodePositions({ origin, sourceSize, count: 2, columns: 4 })
    expect(positions[0]).toEqual({ x: 516, y: 200 })
    expect(positions[1]).toEqual({ x: 868, y: 200 })
  })

  it('满一行后换行', () => {
    const positions = shotCutNodePositions({ origin, sourceSize, count: 5, columns: 4 })
    expect(positions[4]).toEqual({ x: 516, y: 412 })
  })

  it('count 为 0 → 空数组', () => {
    expect(shotCutNodePositions({ origin, sourceSize, count: 0 })).toEqual([])
  })
})
