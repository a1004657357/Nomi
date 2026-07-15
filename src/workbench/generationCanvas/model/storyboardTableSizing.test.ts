import { describe, expect, it } from 'vitest'
import {
  STORYBOARD_TABLE_BOUNDS,
  STORYBOARD_TABLE_DEFAULT_SIZE,
  storyboardTableFitSize,
  storyboardTableSizePatch,
} from './storyboardTableSizing'

describe('storyboardTableFitSize', () => {
  it('keeps small tables at the compact default size', () => {
    expect(storyboardTableFitSize(1)).toEqual(STORYBOARD_TABLE_DEFAULT_SIZE)
  })

  it('budgets compact rows and at most one expanded editor', () => {
    expect(storyboardTableFitSize(22)).toEqual({ width: 1320, height: 2106 })
    expect(storyboardTableFitSize(22, true)).toEqual({ width: 1320, height: 2226 })
  })

  it('caps very long scripts at the resize bound', () => {
    expect(storyboardTableFitSize(100).height).toBe(STORYBOARD_TABLE_BOUNDS.maxHeight)
  })

  it('keeps legacy previewHeight synchronized with size commands', () => {
    expect(storyboardTableSizePatch({ previewHeight: 1675, keep: true }, STORYBOARD_TABLE_DEFAULT_SIZE)).toEqual({
      size: STORYBOARD_TABLE_DEFAULT_SIZE,
      meta: { previewHeight: 780, keep: true },
    })
  })
})
