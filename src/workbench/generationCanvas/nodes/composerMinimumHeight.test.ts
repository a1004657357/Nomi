import { describe, expect, it } from 'vitest'
import { resolveComposerMinimumHeight, resolveComposerViewportGeometry } from './useComposerViewportPlacement'

describe('composer prompt viewport minimum', () => {
  it('reserves prompt space even when the old card minimum collapsed the editor', () => {
    const minimum = resolveComposerMinimumHeight({ fallback: 150, cardHeight: 156, promptViewportHeight: 1, promptMinimumHeight: 72 })
    expect(minimum).toBe(227)
    const geometry = resolveComposerViewportGeometry({ previousFlipUp: true, spaceAbove: 180,
      spaceBelow: 170, toolbarScreenHeight: 0, canvasZoom: 1, gap: 14,
      contentHeight: 156, preferredMaxHeight: 400, minUsableHeight: minimum })
    expect(geometry.maxHeight).toBeGreaterThanOrEqual(minimum)
  })

  it('does not turn long scrolling content into a larger minimum', () => {
    expect(resolveComposerMinimumHeight({ fallback: 150, cardHeight: 400,
      promptViewportHeight: 245, promptMinimumHeight: 72 })).toBe(227)
  })
})
