import { describe, expect, it } from 'vitest'
import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type {
  GenerationNodeResult,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import type { CapabilityRecipeImageInspection } from '../runner/capabilityRecipePostprocess'
import { evaluatePortraitIdentityQuality } from './portraitIdentityQuality'

function hash(seed: number): string {
  let state = seed + 1
  return Array.from({ length: 256 }, () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state >>> 31 ? '1' : '0'
  }).join('')
}

function image(id: string): GenerationNodeResult {
  return { id, type: 'image', url: `nomi-local://${id}.png`, createdAt: 100 }
}

function inspection(seed: number, overrides: Partial<CapabilityRecipeImageInspection> = {}): CapabilityRecipeImageInspection {
  return {
    width: 1024,
    height: 1024,
    opaqueRatio: 1,
    meanLuma: 0.48,
    lumaStdDev: 0.18,
    edgeEnergy: 0.12,
    averageRgb: [0.46, 0.43, 0.41],
    perceptualHash: hash(seed),
    centerRegion: {
      lumaStdDev: 0.17,
      edgeEnergy: 0.11,
      averageRgb: [0.5, 0.43, 0.39],
      perceptualHash: hash(seed),
    },
    ...overrides,
  }
}

function plan(recipeId: 'portrait.refine' | 'portrait.mood', outputs = [{ id: 'portrait', label: '人像结果' }]): RecipeRunPlan {
  return {
    id: 'portrait-run',
    recipeId,
    recipeVersion: recipeId === 'portrait.mood' ? 2 : 1,
    outputKind: recipeId === 'portrait.mood' ? 'image_collection' : 'image',
    sourceNodeIds: ['source'],
    resourceIds: [],
    model: {
      vendorKey: 'provider',
      modelKey: 'model',
      archetypeId: 'image-edit',
      modeId: 'edit',
      compatibilityTier: 'compatible',
    },
    params: { identityLock: true, expressionStrength: 50 },
    outputCount: outputs.length,
    taskCount: outputs.length,
    outputs,
    createdAt: 100,
  }
}

function collection(
  recipeId: 'portrait.refine' | 'portrait.mood',
  outputs = [{ id: 'portrait', label: '人像结果' }],
): GenerationResultCollection {
  return {
    id: 'portrait-run',
    recipeId,
    createdAt: 100,
    items: outputs.map((output) => ({
      ...output,
      status: 'success',
      result: image(output.id),
    })),
  }
}

describe('evaluatePortraitIdentityQuality', () => {
  it('separates identity, skin texture, and artifact checks for a verified portrait result', async () => {
    const report = await evaluatePortraitIdentityQuality({
      plan: plan('portrait.refine'),
      collection: collection('portrait.refine'),
      sourceResult: image('source'),
      inspectImage: async (result) => inspection(result.id === 'source' ? 1 : 2),
      compareFaces: async () => ({
        sourceFaceDetected: true,
        outputFaceDetected: true,
        identitySimilarity: 0.93,
      }),
      evaluatedAt: 200,
    })

    expect(report.quality).toMatchObject({
      kind: 'portrait',
      evaluator: 'portrait-identity-local-v1',
      status: 'pass',
      evaluatedAt: 200,
    })
    expect(report.quality?.checks.map((check) => [check.id, check.status])).toEqual([
      ['portrait-source', 'pass'],
      ['portrait-output', 'pass'],
      ['portrait-identity', 'pass'],
      ['portrait-visual-proxy', 'pass'],
      ['portrait-skin-texture', 'pass'],
      ['portrait-artifacts', 'pass'],
    ])
  })

  it('keeps the result but marks identity verification unavailable when no face comparator exists', async () => {
    const report = await evaluatePortraitIdentityQuality({
      plan: plan('portrait.refine'),
      collection: collection('portrait.refine'),
      sourceResult: image('source'),
      inspectImage: async (result) => inspection(result.id === 'source' ? 1 : 2),
      evaluatedAt: 201,
    })

    expect(report.items[0]?.result?.id).toBe('portrait')
    expect(report.quality?.status).toBe('unavailable')
    expect(report.quality?.checks.find((check) => check.id === 'portrait-identity')).toMatchObject({
      status: 'unavailable',
      summary: expect.stringContaining('不能证明'),
    })
  })

  it('validates the 5x5 coordinate contract and expression distinction without deleting any mood result', async () => {
    const outputs = Array.from({ length: 25 }, (_, index) => {
      const energy = Math.floor(index / 5)
      const affinity = index % 5
      return {
        id: `mood-e${energy}-a${affinity}`,
        label: `能量 ${energy} · 亲和 ${affinity}`,
        energy,
        affinity,
      }
    })
    const report = await evaluatePortraitIdentityQuality({
      plan: plan('portrait.mood', outputs),
      collection: collection('portrait.mood', outputs),
      sourceResult: image('source'),
      inspectImage: async (result) => inspection(result.id === 'source' ? 1 : outputs.findIndex((item) => item.id === result.id) + 10),
      compareFaces: async () => ({
        sourceFaceDetected: true,
        outputFaceDetected: true,
        identitySimilarity: 0.91,
      }),
      compareMoodExpressions: async ({ outputs }) => ({
        evaluator: 'vision-test',
        items: outputs.map((output) => ({
          itemId: output.itemId,
          faceDetected: true,
          targetMatches: true,
          targetScore: 0.9,
          muscleRegions: ['brow', 'eyelid', 'mouth'],
        })),
      }),
      evaluatedAt: 202,
    })

    expect(report.items).toHaveLength(25)
    expect(report.quality).toMatchObject({
      kind: 'mood',
      evaluator: 'mood-identity-local-v1',
      status: 'pass',
    })
    expect(report.quality?.checks.find((check) => check.id === 'mood-coordinate-contract')?.status).toBe('pass')
    expect(report.quality?.checks.find((check) => check.id === 'mood-expression-semantic')?.status).toBe('pass')
    expect(report.quality?.checks.find((check) => check.id === 'mood-expression-distinction')?.status).toBe('pass')
  })

  it('does not treat different pixels as proof that the requested expression was achieved', async () => {
    const outputs = [
      { id: 'mood-e0-a0', label: '能量 0 · 亲和 0', energy: 0, affinity: 0 },
      { id: 'mood-e4-a4', label: '能量 4 · 亲和 4', energy: 4, affinity: 4 },
    ]
    const report = await evaluatePortraitIdentityQuality({
      plan: plan('portrait.mood', outputs),
      collection: collection('portrait.mood', outputs),
      sourceResult: image('source'),
      inspectImage: async (result) => inspection(result.id === 'source' ? 1 : result.id.endsWith('a0') ? 10 : 20),
      compareFaces: async () => ({
        sourceFaceDetected: true,
        outputFaceDetected: true,
        identitySimilarity: 0.9,
      }),
      evaluatedAt: 202,
    })

    expect(report.quality?.checks.find((check) => check.id === 'mood-expression-distinction')?.status).toBe('pass')
    expect(report.quality?.checks.find((check) => check.id === 'mood-expression-semantic')).toMatchObject({
      status: 'unavailable',
      summary: expect.stringContaining('不能证明'),
    })
    expect(report.quality?.status).toBe('unavailable')
  })

  it('flags identity drift and duplicate mood cells while preserving all generated outputs', async () => {
    const outputs = [
      { id: 'mood-e0-a0', label: '能量 0 · 亲和 0', energy: 0, affinity: 0 },
      { id: 'mood-e4-a4', label: '能量 4 · 亲和 4', energy: 4, affinity: 4 },
    ]
    const report = await evaluatePortraitIdentityQuality({
      plan: plan('portrait.mood', outputs),
      collection: collection('portrait.mood', outputs),
      sourceResult: image('source'),
      inspectImage: async (result) => inspection(result.id === 'source' ? 1 : 7),
      compareFaces: async (_source, output) => ({
        sourceFaceDetected: true,
        outputFaceDetected: true,
        identitySimilarity: output.id === 'mood-e4-a4' ? 0.48 : 0.9,
      }),
      compareMoodExpressions: async ({ outputs: requested }) => ({
        evaluator: 'vision-test',
        items: requested.map((output) => ({
          itemId: output.itemId,
          faceDetected: true,
          targetMatches: output.itemId !== 'mood-e4-a4',
          targetScore: output.itemId === 'mood-e4-a4' ? 0.3 : 0.9,
          muscleRegions: ['brow', 'eyelid', 'mouth'],
        })),
      }),
      evaluatedAt: 203,
    })

    expect(report.items.every((item) => item.result)).toBe(true)
    expect(report.quality?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'portrait-identity')).toMatchObject({
      status: 'fail',
      itemIds: ['mood-e4-a4'],
    })
    expect(report.quality?.checks.find((check) => check.id === 'mood-expression-distinction')).toMatchObject({
      status: 'fail',
      itemIds: ['mood-e0-a0', 'mood-e4-a4'],
    })
    expect(report.quality?.checks.find((check) => check.id === 'mood-expression-semantic')).toMatchObject({
      status: 'fail',
      itemIds: ['mood-e4-a4'],
    })
  })
})
