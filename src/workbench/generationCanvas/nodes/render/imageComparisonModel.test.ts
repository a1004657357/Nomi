import { describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { resolveImageComparisonInputs } from './imageComparisonModel'

function node(id: string, type: 'image' | 'video' = 'image'): GenerationCanvasNode {
  return {
    id,
    kind: type,
    title: id.toUpperCase(),
    position: { x: 0, y: 0 },
    result: { id: `result-${id}`, type, url: `nomi-local://${id}`, createdAt: 1 },
  }
}

describe('resolveImageComparisonInputs', () => {
  it('returns two ordered image inputs and ignores video or empty sources', () => {
    const nodes = [node('a'), node('b'), node('video', 'video'), {
      id: 'compare',
      kind: 'compare',
      title: 'compare',
      position: { x: 0, y: 0 },
    }] satisfies GenerationCanvasNode[]
    const edges = [
      { id: 'b-edge', source: 'b', target: 'compare', order: 2 },
      { id: 'video-edge', source: 'video', target: 'compare', order: 0 },
      { id: 'a-edge', source: 'a', target: 'compare', order: 1 },
    ] satisfies GenerationCanvasEdge[]
    expect(resolveImageComparisonInputs('compare', nodes, edges)).toEqual([
      { nodeId: 'a', title: 'A', url: 'nomi-local://a' },
      { nodeId: 'b', title: 'B', url: 'nomi-local://b' },
    ])
  })
})
