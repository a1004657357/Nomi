import { describe, expect, it } from 'vitest'
import {
  GENERATION_VARIANT_COUNTS,
  parseGenerationVariantCount,
} from './generationVariantCount'

describe('generation variant count choices', () => {
  it('exposes every explicit choice from one through four', () => {
    expect(GENERATION_VARIANT_COUNTS).toEqual([1, 2, 3, 4])
  })

  it.each([
    ['1', 1],
    ['2', 2],
    ['3', 3],
    ['4', 4],
  ] as const)('parses %s as %s', (raw, expected) => {
    expect(parseGenerationVariantCount(raw)).toBe(expected)
  })

  it('falls back to one for unsupported values', () => {
    expect(parseGenerationVariantCount('5')).toBe(1)
    expect(parseGenerationVariantCount('')).toBe(1)
  })
})
