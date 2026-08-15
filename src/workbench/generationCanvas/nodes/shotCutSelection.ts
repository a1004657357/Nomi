/**
 * 「按镜头拆」的纯计算：灵敏度过滤 / 联系表切格 / 时间戳显示 / 落画布的网格坐标。
 *
 * 灵敏度滑杆为什么能瞬时响应：主进程**固定用低阈值跑一次**，返回带 `score` 的切点全集 + 一张同阈值的
 * 联系表（第 i 格恒是第 i 个切点）。滑杆只是在前端按 score 过滤这个数组，不重跑 ffmpeg。
 * 所以过滤后必须**保住原始下标**（`index`）——切格要靠它，用错就会张冠李戴。
 */

export type ShotCut = { seconds: number; score: number }

export type ShotCutCandidate = ShotCut & {
  /** 在**未过滤**全集里的下标 = 它在联系表里的格子号。过滤后千万别重新编号。 */
  index: number
}

/** 灵敏度滑杆的取值范围（对应 scene_score 的 0.10–0.70，再高基本什么都筛没了）。 */
export const SHOT_SENSITIVITY_MIN = 0.1
export const SHOT_SENSITIVITY_MAX = 0.7
export const SHOT_SENSITIVITY_DEFAULT = 0.3
export const SHOT_SENSITIVITY_STEP = 0.05

/** 按灵敏度过滤，保住原始下标。 */
export function filterShotCuts(cuts: readonly ShotCut[], threshold: number): ShotCutCandidate[] {
  return cuts
    .map((cut, index) => ({ ...cut, index }))
    .filter((cut) => cut.score >= threshold)
}

/**
 * 第 index 格在联系表里的 CSS 背景定位。
 * 联系表是 cols×rows 的等分网格；用 background-size 放大到 (cols×100%, rows×100%)，
 * 再按格子位置平移。百分比定位在网格里是「可用余量的百分比」，故除数是 (cols-1)/(rows-1)。
 */
export function shotSheetTileStyle(
  index: number,
  cols: number,
  rows: number,
): { backgroundSize: string; backgroundPosition: string } {
  const safeCols = Math.max(1, cols)
  const safeRows = Math.max(1, rows)
  const col = index % safeCols
  const row = Math.floor(index / safeCols)
  const x = safeCols > 1 ? (col / (safeCols - 1)) * 100 : 0
  const y = safeRows > 1 ? (row / (safeRows - 1)) * 100 : 0
  return {
    backgroundSize: `${safeCols * 100}% ${safeRows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
  }
}

/** 联系表行数——必须和主进程 `Math.ceil(cuts.length / cols)` 用同一个算式，否则切格全错位。 */
export function shotSheetRows(totalCuts: number, cols: number): number {
  return Math.max(1, Math.ceil(totalCuts / Math.max(1, cols)))
}

/** 秒 → `m:ss` / 超过一小时 `h:mm:ss`。 */
export function formatShotTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (value: number) => String(value).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * 拆出来的帧落画布时的坐标：源视频右侧起，按格子铺开（成组紧凑布局，配 `exactPosition` 跳过逐卡避让，
 * 否则会被推散成一片——切图九宫格栽过同样的坑）。
 */
export function shotCutNodePositions(params: {
  origin: { x: number; y: number }
  sourceSize: { width: number; height: number }
  count: number
  columns?: number
}): { x: number; y: number }[] {
  const { origin, sourceSize, count } = params
  const columns = Math.max(1, params.columns ?? 4)
  const gapX = 32
  const gapY = 32
  const cellW = sourceSize.width + gapX
  const cellH = sourceSize.height + gapY
  const startX = origin.x + sourceSize.width + 96
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    x: Math.round(startX + (index % columns) * cellW),
    y: Math.round(origin.y + Math.floor(index / columns) * cellH),
  }))
}
