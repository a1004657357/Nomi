import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { generationBatchConcurrency, isCodexImg2Node } from './generationConcurrency'

function node(id: string, meta: Record<string, unknown>): GenerationCanvasNode {
  return { id, kind: 'image', title: id, position: { x: 0, y: 0 }, prompt: 'p', meta }
}

describe('generationConcurrency', () => {
  it('detects Codex Img2 by vendor or model key', () => {
    expect(isCodexImg2Node(node('a', { modelVendor: 'codex', modelKey: 'anything' }))).toBe(true)
    expect(isCodexImg2Node(node('b', { modelKey: 'codex-img2' }))).toBe(true)
    expect(isCodexImg2Node(node('c', { modelKey: 'gpt-image-2' }))).toBe(false)
  })

  it('does not make Codex lower the worker count for unrelated providers in a mixed batch', () => {
    const nodes = [
      node('a', { modelVendor: 'codex', modelKey: 'codex-img2' }),
      node('b', { modelVendor: 'codex', modelKey: 'codex-img2' }),
      node('c', { modelVendor: 'codex', modelKey: 'codex-img2' }),
    ]

    expect(generationBatchConcurrency(['a', 'b', 'c'], nodes, undefined)).toBe(6)
    expect(generationBatchConcurrency(['a', 'b', 'c'], nodes, 8)).toBe(8)
    expect(generationBatchConcurrency(['a', 'b', 'c'], nodes, 1)).toBe(1)
  })

  it('keeps the normal batch concurrency for non-Codex models', () => {
    const nodes = [node('a', { modelVendor: 'kie', modelKey: 'gpt-image-2' })]

    expect(generationBatchConcurrency(['a'], nodes, undefined)).toBe(6)
    expect(generationBatchConcurrency(['a'], nodes, 8)).toBe(8)
  })
})
