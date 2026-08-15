import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from './generationCanvasTypes'
import { listNodeMediaResults, promoteNodeResult, removeNodeResult, resultIdentity } from './nodeResultLifecycle'

const image = (id: string, url: string): GenerationNodeResult => ({
  id,
  type: 'image',
  url,
  createdAt: 1,
})

const node = (result: GenerationNodeResult, history: GenerationNodeResult[]): GenerationCanvasNode => ({
  id: 'node-1',
  kind: 'image',
  title: '结果',
  position: { x: 0, y: 0 },
  status: 'success',
  result,
  history,
})

describe('node result lifecycle', () => {
  it('deduplicates primary and history while preserving their display order', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    expect(listNodeMediaResults(node(a, [a, b])).map(resultIdentity)).toEqual(['a', 'b'])
  })

  it('promotes one result without losing the former primary', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    const patch = promoteNodeResult(node(a, [a, b]), 'b')
    expect(patch?.result?.id).toBe('b')
    expect(patch?.history?.map(resultIdentity)).toEqual(['b', 'a'])
  })

  it('preserves non-media history while promoting an image', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    const text = { id: 'text-1', type: 'text', text: '保留这段历史' } as GenerationNodeResult
    const patch = promoteNodeResult(node(a, [a, text, b]), 'b')

    expect(patch?.result).toBe(b)
    expect(patch?.history).toEqual([b, a, text])
  })

  it('removes only the requested result and promotes the next result when needed', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    const patch = removeNodeResult(node(a, [a, b]), 'a')
    expect(patch?.result?.id).toBe('b')
    expect(patch?.history?.map(resultIdentity)).toEqual(['b'])
    expect(patch?.status).toBe('success')
  })

  it('preserves non-media history when removing one image', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    const text = { id: 'text-1', type: 'text', text: '保留这段历史' } as GenerationNodeResult
    const patch = removeNodeResult(node(a, [a, text, b]), 'a')

    expect(patch?.result).toBe(b)
    expect(patch?.history).toEqual([b, text])
    expect(patch?.status).toBe('success')
  })

  it('keeps non-media history instead of resetting the node when deleting its last image', () => {
    const a = image('a', 'a.png')
    const text = { id: 'text-1', type: 'text', text: '保留这段历史' } as GenerationNodeResult
    const patch = removeNodeResult(node(a, [a, text]), 'a')

    expect(patch).toMatchObject({ result: undefined, history: [text], status: 'idle', error: undefined })
  })

  it('returns the node to idle after its last result is removed', () => {
    const a = image('a', 'a.png')
    const patch = removeNodeResult(node(a, [a]), 'a')
    expect(patch).toMatchObject({ result: undefined, history: [], status: 'idle', error: undefined })
  })
})
