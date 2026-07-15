export const STORYBOARD_TABLE_MIN_CONTENT_WIDTH = 1320

export const STORYBOARD_TABLE_DEFAULT_SIZE = {
  width: 1320,
  height: 780,
} as const

export const STORYBOARD_TABLE_BOUNDS = {
  minWidth: 720,
  maxWidth: 3600,
  minHeight: 420,
  maxHeight: 2400,
} as const

type StoryboardTableSize = { width: number; height: number }

const TABLE_CHROME_HEIGHT = 82
const STORYBOARD_TABLE_COMPACT_ROW_HEIGHT = 92
const STORYBOARD_TABLE_EXPANDED_ROW_EXTRA = 120

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function storyboardTableFitSize(
  rowCount: number,
  hasExpandedRow = false,
): { width: number; height: number } {
  const rows = Math.max(1, Math.trunc(rowCount || 0))
  return {
    width: STORYBOARD_TABLE_MIN_CONTENT_WIDTH,
    height: clamp(
      TABLE_CHROME_HEIGHT
        + rows * STORYBOARD_TABLE_COMPACT_ROW_HEIGHT
        + (hasExpandedRow ? STORYBOARD_TABLE_EXPANDED_ROW_EXTRA : 0),
      STORYBOARD_TABLE_DEFAULT_SIZE.height,
      STORYBOARD_TABLE_BOUNDS.maxHeight,
    ),
  }
}

export function storyboardTableSizePatch(
  meta: Record<string, unknown> | undefined,
  size: StoryboardTableSize,
): { size: StoryboardTableSize; meta: Record<string, unknown> } {
  return {
    size,
    meta: { ...(meta || {}), previewHeight: size.height },
  }
}
