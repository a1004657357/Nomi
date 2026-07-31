import { describe, expect, it } from 'vitest'
import { getGenerationNodeExecutionKind } from './generationNodeKinds'

describe('generation node execution kinds', () => {
  it('runs panorama recipes through the image executor', () => {
    expect(getGenerationNodeExecutionKind('panorama')).toBe('image')
  })
})
