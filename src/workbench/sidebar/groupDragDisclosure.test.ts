import { describe, expect, it } from 'vitest'
import { GROUP_DRAG_MIME, NODE_DRAG_EXPAND_DELAY_MS, NODE_DRAG_MIME, classifySidebarDrag } from './groupDragDisclosure'

describe('classifySidebarDrag', () => {
  it('distinguishes node moves from group reordering', () => {
    expect(classifySidebarDrag([NODE_DRAG_MIME])).toBe('node')
    expect(classifySidebarDrag([GROUP_DRAG_MIME])).toBe('group')
  })

  it('ignores unrelated browser drags', () => {
    expect(classifySidebarDrag(['Files', 'text/plain'])).toBeNull()
  })

  it('keeps the approved hover-to-expand timing contract', () => {
    expect(NODE_DRAG_EXPAND_DELAY_MS).toBe(450)
  })
})
