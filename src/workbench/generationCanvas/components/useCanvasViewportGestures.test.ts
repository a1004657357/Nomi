import { describe, expect, it } from 'vitest'
import { viewportOffsetNeedsCommit } from './useCanvasViewportGestures'

describe('viewportOffsetNeedsCommit', () => {
  it('does not route every short pointer move through React state', () => {
    expect(
      viewportOffsetNeedsCommit({
        committedOffset: { x: 0, y: 0 },
        nextOffset: { x: -120, y: -40 },
        zoom: 1,
        elapsedMs: 30,
      }),
    ).toBe(false)
  })

  it('commits before the viewport can outrun the virtualized render buffer', () => {
    expect(
      viewportOffsetNeedsCommit({
        committedOffset: { x: 0, y: 0 },
        nextOffset: { x: -70, y: 0 },
        zoom: 0.2,
        elapsedMs: 30,
      }),
    ).toBe(true)
  })

  it('periodically synchronizes navigation and global viewport consumers', () => {
    expect(
      viewportOffsetNeedsCommit({
        committedOffset: { x: 0, y: 0 },
        nextOffset: { x: -20, y: -10 },
        zoom: 1,
        elapsedMs: 180,
      }),
    ).toBe(true)
  })
})
