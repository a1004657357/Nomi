import { describe, expect, it } from 'vitest'
import {
  isStoryboardContainedNode,
  isStoryboardContainedNodeExpanded,
  isStoryboardContainedNodeHidden,
  storyboardContainedMeta,
  storyboardContainedRole,
  storyboardContainedRowIndex,
  storyboardContainerNodeId,
  shouldRenderEdgeInStoryboardContainment,
  withStoryboardContainedMeta,
} from './storyboardContainedNodes'
import type { GenerationCanvasNode } from './generationCanvasTypes'

function node(meta?: Record<string, unknown>): Pick<GenerationCanvasNode, 'meta'> {
  return { meta }
}

describe('storyboardContainedNodes', () => {
  it('builds stable contained-node metadata', () => {
    expect(storyboardContainedMeta({ tableNodeId: 'table-1', rowIndex: 3, role: 'image' })).toEqual({
      storyboardContainedByNodeId: 'table-1',
      storyboardContainedRowIndex: 3,
      storyboardContainedRole: 'image',
      storyboardContainedExpanded: false,
    })
  })

  it('preserves existing meta while marking a node as contained', () => {
    const meta = withStoryboardContainedMeta({ modelKey: 'seedream' }, {
      tableNodeId: 'table-1',
      rowIndex: 2,
      role: 'video',
      expanded: true,
    })

    expect(meta.modelKey).toBe('seedream')
    expect(storyboardContainerNodeId(node(meta))).toBe('table-1')
    expect(storyboardContainedRowIndex(node(meta))).toBe(2)
    expect(storyboardContainedRole(node(meta))).toBe('video')
    expect(isStoryboardContainedNode(node(meta))).toBe(true)
    expect(isStoryboardContainedNodeExpanded(node(meta))).toBe(true)
    expect(isStoryboardContainedNodeHidden(node(meta))).toBe(false)
  })

  it('treats contained nodes as hidden until expanded', () => {
    const meta = storyboardContainedMeta({ tableNodeId: 'table-1', rowIndex: 1, role: 'image' })
    expect(isStoryboardContainedNodeHidden(node(meta))).toBe(true)
    expect(isStoryboardContainedNodeHidden(node({ ...meta, storyboardContainedExpanded: true }))).toBe(false)
    expect(isStoryboardContainedNodeHidden(node())).toBe(false)
  })

  it('hides edges touching collapsed contained nodes', () => {
    const visible = node()
    const collapsed = node(storyboardContainedMeta({ tableNodeId: 'table-1', rowIndex: 1, role: 'image' }))
    const expanded = node(storyboardContainedMeta({
      tableNodeId: 'table-1',
      rowIndex: 1,
      role: 'image',
      expanded: true,
    }))

    expect(shouldRenderEdgeInStoryboardContainment(
      { source: 'asset', target: 'shot' },
      new Map([['asset', visible], ['shot', collapsed]]),
    )).toBe(false)
    expect(shouldRenderEdgeInStoryboardContainment(
      { source: 'shot', target: 'next' },
      new Map([['shot', collapsed], ['next', visible]]),
    )).toBe(false)
    expect(shouldRenderEdgeInStoryboardContainment(
      { source: 'asset', target: 'shot' },
      new Map([['asset', visible], ['shot', expanded]]),
    )).toBe(true)
    expect(shouldRenderEdgeInStoryboardContainment(
      { source: 'asset', target: 'missing' },
      new Map([['asset', visible]]),
    )).toBe(false)
  })
})
