import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { resolveOutputCollectorItems, resolveOutputCollectorSelection } from './outputCollectorModel'

const resultNode = (id: string, type: 'image' | 'video', url?: string): GenerationCanvasNode => ({
  id,
  kind: type,
  title: id,
  position: { x: 0, y: 0 },
  result: { id: `${id}-result`, type, url, createdAt: 1 },
})

describe('outputCollectorModel', () => {
  it('按入边顺序收集有真实媒体结果的节点', () => {
    const nodes = [
      resultNode('image-1', 'image', 'nomi-local://image'),
      resultNode('video-1', 'video', 'nomi-local://video'),
      resultNode('empty', 'image'),
    ]
    const items = resolveOutputCollectorItems('output-1', nodes, [
      { id: 'e2', source: 'video-1', target: 'output-1', order: 2 },
      { id: 'e1', source: 'image-1', target: 'output-1', order: 1 },
      { id: 'e3', source: 'empty', target: 'output-1', order: 3 },
    ])
    expect(items.map((item) => item.sourceNodeId)).toEqual(['image-1', 'video-1'])
  })

  it('首次默认全选，用户保存选择后尊重空选和子集', () => {
    const items = resolveOutputCollectorItems('output-1', [
      resultNode('image-1', 'image', 'nomi-local://image'),
      resultNode('video-1', 'video', 'nomi-local://video'),
    ], [
      { id: 'e1', source: 'image-1', target: 'output-1' },
      { id: 'e2', source: 'video-1', target: 'output-1' },
    ])
    expect(resolveOutputCollectorSelection({ meta: {} }, items).size).toBe(2)
    expect(resolveOutputCollectorSelection({
      meta: { outputCollectorSelectionInitialized: true, outputCollectorSelectedIds: [] },
    }, items).size).toBe(0)
    expect([...resolveOutputCollectorSelection({
      meta: { outputCollectorSelectionInitialized: true, outputCollectorSelectedIds: [items[1].id] },
    }, items)]).toEqual([items[1].id])
  })
})
