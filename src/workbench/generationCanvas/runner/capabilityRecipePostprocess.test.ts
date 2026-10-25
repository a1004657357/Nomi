import { describe, expect, it, vi } from 'vitest'
import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type { GenerationNodeResult } from '../model/generationCanvasTypes'
import type { CapabilityRecipeTask } from './capabilityRecipeRunner'
import {
  analyzeCapabilityImagePixels,
  centeredCropForAspectRatio,
  normalizeMultiviewCollectionDimensions,
  postprocessCapabilityRecipeResults,
  type CapabilityRecipeMediaProcessor,
} from './capabilityRecipePostprocess'

function imageResult(id: string): GenerationNodeResult {
  return { id, type: 'image', url: `nomi-local://${id}.png`, createdAt: 100 }
}

function gridPlan(): RecipeRunPlan {
  const outputs = Array.from({ length: 9 }, (_, index) => ({
    id: `view-${index + 1}`,
    label: `机位 ${index + 1}`,
    azimuth: index * 45,
    elevation: 0,
  }))
  return {
    id: 'grid-run', recipeId: 'image.multiview.grid9', recipeVersion: 1, outputKind: 'image_collection',
    sourceNodeIds: ['source'], resourceIds: [],
    model: {
      vendorKey: 'provider', modelKey: 'model', archetypeId: 'image-edit', modeId: 'edit',
      compatibilityTier: 'compatible',
    },
    params: {}, outputCount: 9, taskCount: 1, outputs, createdAt: 100,
  }
}

function task(plan: RecipeRunPlan): CapabilityRecipeTask {
  return { id: `${plan.id}:task-1`, itemIds: plan.outputs.map((output) => output.id), outputs: plan.outputs, plan }
}

function processor(overrides: Partial<CapabilityRecipeMediaProcessor> = {}): CapabilityRecipeMediaProcessor {
  return {
    splitGrid3x3: async (_result, outputs) => outputs.map((output) => imageResult(output.id)),
    normalizePanorama2to1: async (result) => ({ ...result, id: `${result.id}:2to1` }),
    ...overrides,
  }
}

describe('postprocessCapabilityRecipeResults', () => {
  it('splits one composite grid result into all nine ordered outputs', async () => {
    const plan = gridPlan()
    const splitGrid3x3 = vi.fn(async (_result: GenerationNodeResult, outputs: typeof plan.outputs) => (
      outputs.map((output) => imageResult(output.id))
    ))

    const results = await postprocessCapabilityRecipeResults(
      plan,
      task(plan),
      [imageResult('composite')],
      'target-1',
      processor({ splitGrid3x3 }),
    )

    expect(splitGrid3x3).toHaveBeenCalledOnce()
    expect(results.map((result) => result.id)).toEqual(plan.outputs.map((output) => output.id))
  })

  it('does not split when the provider already returns nine images', async () => {
    const plan = gridPlan()
    const providerResults = plan.outputs.map((output) => imageResult(output.id))
    const splitGrid3x3 = vi.fn()

    const results = await postprocessCapabilityRecipeResults(
      plan,
      task(plan),
      providerResults,
      'target-1',
      processor({ splitGrid3x3 }),
    )

    expect(splitGrid3x3).not.toHaveBeenCalled()
    expect(results).toEqual(providerResults)
  })

  it('fails clearly when a grid cannot be split into nine complete tiles', async () => {
    const plan = gridPlan()

    await expect(postprocessCapabilityRecipeResults(
      plan,
      task(plan),
      [imageResult('composite')],
      'target-1',
      processor({ splitGrid3x3: async () => [imageResult('only-one')] }),
    )).rejects.toThrow('九宫格拆分失败：预期 9 张，实际得到 1 张')
  })

  it('normalizes a panorama result before it enters the collection', async () => {
    const plan: RecipeRunPlan = {
      ...gridPlan(),
      id: 'panorama-run',
      recipeId: 'scene.panorama.2to1',
      outputKind: 'panorama',
      outputCount: 1,
      outputs: [{ id: 'panorama', label: '360° 全景' }],
    }
    const normalizePanorama2to1 = vi.fn(async (result: GenerationNodeResult) => ({ ...result, id: 'normalized' }))

    const results = await postprocessCapabilityRecipeResults(
      plan,
      task(plan),
      [imageResult('raw-panorama')],
      'target-1',
      processor({ normalizePanorama2to1 }),
    )

    expect(normalizePanorama2to1).toHaveBeenCalledOnce()
    expect(results[0]?.id).toBe('normalized')
  })

  it('normalizes style output to the source aspect and retains the raw provider result', async () => {
    const plan: RecipeRunPlan = {
      ...gridPlan(),
      id: 'style-run',
      recipeId: 'image.style.transfer',
      outputKind: 'image',
      params: { sourceAspectRatio: 0.5625, aspectRatio: '9:16' },
      outputCount: 1,
      taskCount: 1,
      outputs: [{ id: 'styled', label: '风格化图片' }],
    }
    const raw = imageResult('provider-raw')
    const normalized = {
      ...imageResult('provider-raw:source-aspect'),
      alternatives: [raw],
    }
    const normalizeStyleAspect = vi.fn(async () => normalized)

    const results = await postprocessCapabilityRecipeResults(
      plan,
      task(plan),
      [raw],
      'target-1',
      processor({ normalizeStyleAspect }),
    )

    expect(normalizeStyleAspect).toHaveBeenCalledWith(raw, 'target-1', 0.5625)
    expect(results).toEqual([normalized])
    expect(results[0]?.alternatives?.[0]?.id).toBe('provider-raw')
  })
})

describe('centeredCropForAspectRatio', () => {
  it.each([
    [1600, 1000, { x: 0, y: 100, width: 1600, height: 800 }],
    [2400, 1000, { x: 200, y: 0, width: 2000, height: 1000 }],
    [1024, 512, { x: 0, y: 0, width: 1024, height: 512 }],
  ])('computes an exact centered 2:1 crop for %sx%s', (width, height, expected) => {
    expect(centeredCropForAspectRatio(width, height, 2)).toEqual(expected)
  })
})

describe('normalizeMultiviewCollectionDimensions', () => {
  it('crops only tiny provider pixel jitter to one common batch size', async () => {
    const recipePlan = { ...gridPlan(), recipeId: 'image.multiview.custom', outputCount: 2, taskCount: 2 }
    recipePlan.outputs = recipePlan.outputs.slice(0, 2)
    const first = imageResult('first')
    const second = imageResult('second')
    const normalizeImageDimensions = vi.fn(async (result: GenerationNodeResult, _owner: string, width: number, height: number) => ({
      ...result,
      id: `${result.id}:${width}x${height}`,
    }))
    const collection = {
      id: 'collection', recipeId: recipePlan.recipeId, createdAt: 100,
      items: [
        { id: recipePlan.outputs[0]!.id, label: '右侧', status: 'success' as const, result: first, candidates: [first], selectedResultId: first.id },
        { id: recipePlan.outputs[1]!.id, label: '左侧', status: 'success' as const, result: second, candidates: [second], selectedResultId: second.id },
      ],
    }
    const mediaProcessor = processor({
      normalizeImageDimensions,
      inspectImage: async (result) => ({
        width: result.id === 'first' ? 1535 : 1537,
        height: result.id === 'first' ? 1024 : 1023,
        opaqueRatio: 1,
        meanLuma: 0.5,
        lumaStdDev: 0.2,
        edgeEnergy: 0.1,
        averageRgb: [0.5, 0.5, 0.5],
        perceptualHash: result.id,
      }),
    })

    const normalized = await normalizeMultiviewCollectionDimensions(
      recipePlan,
      collection,
      'target-1',
      mediaProcessor,
    )

    expect(normalizeImageDimensions).toHaveBeenCalledTimes(2)
    expect(normalizeImageDimensions).toHaveBeenNthCalledWith(1, first, 'target-1', 1535, 1023)
    expect(normalizeImageDimensions).toHaveBeenNthCalledWith(2, second, 'target-1', 1535, 1023)
    expect(normalized.items.map((item) => item.selectedResultId)).toEqual([
      'first:1535x1023',
      'second:1535x1023',
    ])
  })

  it('does not hide materially different provider aspect ratios', async () => {
    const recipePlan = { ...gridPlan(), recipeId: 'image.multiview.custom', outputCount: 2, taskCount: 2 }
    recipePlan.outputs = recipePlan.outputs.slice(0, 2)
    const normalizeImageDimensions = vi.fn()
    const collection = {
      id: 'collection', recipeId: recipePlan.recipeId, createdAt: 100,
      items: recipePlan.outputs.map((output, index) => ({
        id: output.id,
        label: output.label,
        status: 'success' as const,
        result: imageResult(`result-${index}`),
      })),
    }

    const normalized = await normalizeMultiviewCollectionDimensions(
      recipePlan,
      collection,
      'target-1',
      processor({
        normalizeImageDimensions,
        inspectImage: async (result) => ({
          width: result.id === 'result-0' ? 1536 : 1024,
          height: result.id === 'result-0' ? 1024 : 1536,
          opaqueRatio: 1,
          meanLuma: 0.5,
          lumaStdDev: 0.2,
          edgeEnergy: 0.1,
          averageRgb: [0.5, 0.5, 0.5],
          perceptualHash: result.id,
        }),
      }),
    )

    expect(normalizeImageDimensions).not.toHaveBeenCalled()
    expect(normalized).toBe(collection)
  })
})

describe('analyzeCapabilityImagePixels', () => {
  it('identifies a fully opaque flat image as low-detail content', () => {
    const pixels = new Uint8ClampedArray(17 * 16 * 4)
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 255
      pixels[index + 1] = 255
      pixels[index + 2] = 255
      pixels[index + 3] = 255
    }

    const inspection = analyzeCapabilityImagePixels(pixels, 17, 16, 1700, 1600)

    expect(inspection.width).toBe(1700)
    expect(inspection.height).toBe(1600)
    expect(inspection.opaqueRatio).toBe(1)
    expect(inspection.meanLuma).toBeCloseTo(1)
    expect(inspection.lumaStdDev).toBe(0)
    expect(inspection.edgeEnergy).toBe(0)
  })

  it('produces detail and perceptual-difference signals for a checkerboard sample', () => {
    const pixels = new Uint8ClampedArray(17 * 16 * 4)
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 17; x += 1) {
        const offset = (y * 17 + x) * 4
        const value = (x + y) % 2 === 0 ? 255 : 0
        pixels[offset] = value
        pixels[offset + 1] = value
        pixels[offset + 2] = value
        pixels[offset + 3] = 255
      }
    }

    const inspection = analyzeCapabilityImagePixels(pixels, 17, 16)

    expect(inspection.lumaStdDev).toBeGreaterThan(0.45)
    expect(inspection.edgeEnergy).toBeGreaterThan(0.9)
    expect(inspection.perceptualHash).toHaveLength(256)
    expect(new Set(inspection.perceptualHash).size).toBe(2)
    expect(inspection.centerRegion).toMatchObject({
      lumaStdDev: expect.any(Number),
      edgeEnergy: expect.any(Number),
      averageRgb: [expect.any(Number), expect.any(Number), expect.any(Number)],
      perceptualHash: expect.any(String),
    })
  })
})
