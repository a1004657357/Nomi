import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { availableEdgeModes } from './edgeModeMenu'

function node(id: string, kind: GenerationCanvasNode['kind'], archetypeId?: string): GenerationCanvasNode {
  return {
    id,
    kind,
    title: id,
    position: { x: 0, y: 0 },
    ...(archetypeId ? { meta: { archetype: { id: archetypeId, modeId: '' } } } : {}),
  }
}

describe('availableEdgeModes', () => {
  it('keeps only the semantic modes the target model can actually consume', () => {
    expect(availableEdgeModes(node('character', 'character'), node('target', 'image', 'imagen-4'))).toEqual([])
    expect(availableEdgeModes(node('character', 'character'), node('target', 'image', 'seedream'))).toEqual([
      'reference',
      'first_frame',
      'style_ref',
      'character_ref',
      'composition_ref',
    ])
  })

  it('exposes only the generic prompt relation for a text source', () => {
    expect(availableEdgeModes(node('text', 'text'), node('target', 'video', 'seedance-2'))).toEqual(['reference'])
  })
})
