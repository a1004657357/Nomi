import { describe, expect, it } from 'vitest'
import type { CapabilityRecipeImageInspection } from '../runner/capabilityRecipePostprocess'
import { evaluateMultiviewBackgroundQuality } from './multiviewBackgroundQuality'

function inspection(overrides: Partial<CapabilityRecipeImageInspection> = {}): CapabilityRecipeImageInspection {
  return {
    width: 512,
    height: 512,
    opaqueRatio: 1,
    meanLuma: 0.32,
    lumaStdDev: 0.2,
    edgeEnergy: 0.12,
    averageRgb: [0.2, 0.24, 0.18],
    perceptualHash: '0101',
    borderAverageRgb: [0.16, 0.2, 0.14],
    borderNearWhiteRatio: 0.03,
    ...overrides,
  }
}

describe('evaluateMultiviewBackgroundQuality', () => {
  it('fails an obvious white studio replacement when the source scene must be preserved', () => {
    const check = evaluateMultiviewBackgroundQuality({
      backgroundPolicy: 'preserve_scene',
      sourceInspection: inspection(),
      inspected: [{
        item: { id: 'rear', label: '背面', status: 'success' },
        inspection: inspection({
          meanLuma: 0.88,
          borderAverageRgb: [0.96, 0.96, 0.96],
          borderNearWhiteRatio: 0.84,
        }),
      }],
    })

    expect(check).toMatchObject({
      id: 'background-preservation-proxy',
      status: 'fail',
      itemIds: ['rear'],
    })
    expect(check.summary).toContain('白色或中性影棚背景')
  })

  it('does not claim scene preservation when border evidence is missing', () => {
    const check = evaluateMultiviewBackgroundQuality({
      backgroundPolicy: 'preserve_scene',
      sourceInspection: inspection({
        borderAverageRgb: undefined,
        borderNearWhiteRatio: undefined,
      }),
      inspected: [],
    })

    expect(check.status).toBe('unavailable')
  })

  it('leaves neutral-turntable policy to semantic review', () => {
    const check = evaluateMultiviewBackgroundQuality({
      backgroundPolicy: 'neutral_turntable',
      sourceInspection: inspection(),
      inspected: [],
    })

    expect(check).toMatchObject({
      id: 'background-preservation-proxy',
      status: 'unavailable',
    })
    expect(check.summary).toContain('中性转台')
  })
})
