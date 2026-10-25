import { describe, expect, it, vi } from 'vitest'
import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { appendRecipeCollection, retryFailedRecipeItems, runCapabilityRecipePlan } from './capabilityRecipeRunner'

function imageResult(id: string): GenerationNodeResult {
  return { id, type: 'image', url: `nomi-local://${id}.png`, createdAt: 100 }
}

function plan(): RecipeRunPlan {
  return {
    id: 'run-1',
    recipeId: 'image.multiview.custom',
    recipeVersion: 1,
    outputKind: 'image_collection',
    sourceNodeIds: ['source-1'],
    resourceIds: [],
    model: {
      vendorKey: 'provider-a',
      modelKey: 'model-a',
      archetypeId: 'image-a',
      modeId: 'edit',
      compatibilityTier: 'native',
    },
    params: {},
    outputCount: 3,
    taskCount: 3,
    outputs: [
      { id: 'front', label: '正面', azimuth: 0, elevation: 0 },
      { id: 'right', label: '右侧', azimuth: 90, elevation: 0 },
      { id: 'back', label: '背面', azimuth: 180, elevation: 0 },
    ],
    createdAt: 100,
  }
}

describe('runCapabilityRecipePlan', () => {
  it('keeps successful outputs when one view fails', async () => {
    const executeTask = vi.fn(async (task: { itemIds: string[] }) => {
      const id = task.itemIds[0]!
      if (id === 'right') throw new Error('provider timeout')
      return [imageResult(id)]
    })

    const collection = await runCapabilityRecipePlan(plan(), { executeTask, concurrency: 2 })

    expect(collection.items.map((item) => [item.id, item.status])).toEqual([
      ['front', 'success'],
      ['right', 'error'],
      ['back', 'success'],
    ])
    expect(collection.items[1]?.error).toBe('provider timeout')
    expect(executeTask).toHaveBeenCalledTimes(3)
  })

  it('retries only failed items and preserves prior successes', async () => {
    const initial = await runCapabilityRecipePlan(plan(), {
      executeTask: async (task) => {
        const id = task.itemIds[0]!
        if (id === 'right') throw new Error('temporary')
        return [imageResult(id)]
      },
    })
    const executeTask = vi.fn(async (task: { itemIds: string[] }) => [imageResult(task.itemIds[0]!)])

    const retried = await retryFailedRecipeItems(plan(), initial, { executeTask })

    expect(executeTask).toHaveBeenCalledTimes(1)
    expect(executeTask.mock.calls[0]?.[0].itemIds).toEqual(['right'])
    expect(retried.items.every((item) => item.status === 'success')).toBe(true)
    expect(retried.items.find((item) => item.id === 'front')?.result?.id).toBe('front')
  })

  it('caps explicitly requested task concurrency at four', async () => {
    const recipePlan = plan()
    recipePlan.outputCount = 6
    recipePlan.taskCount = 6
    recipePlan.outputs = Array.from({ length: 6 }, (_, index) => ({
      id: `view-${index + 1}`,
      label: `机位 ${index + 1}`,
    }))
    let active = 0
    let peak = 0

    await runCapabilityRecipePlan(recipePlan, {
      concurrency: 99,
      executeTask: async (task) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return [imageResult(task.itemIds[0]!)]
      },
    })

    expect(peak).toBe(4)
  })

  it('keeps all four provider candidates for one logical output', async () => {
    const recipePlan = plan()
    recipePlan.outputCount = 1
    recipePlan.taskCount = 1
    recipePlan.outputs = [{ id: 'front', label: '正面', azimuth: 0, elevation: 0 }]

    const collection = await runCapabilityRecipePlan(recipePlan, {
      executeTask: async () => [
        imageResult('front-candidate-1'),
        imageResult('front-candidate-2'),
        imageResult('front-candidate-3'),
        imageResult('front-candidate-4'),
      ],
    })

    expect(collection.items[0]).toMatchObject({
      status: 'success',
      selectedResultId: 'front-candidate-1',
      result: { id: 'front-candidate-1' },
    })
    expect(collection.items[0]?.candidates?.map((result) => result.id)).toEqual([
      'front-candidate-1',
      'front-candidate-2',
      'front-candidate-3',
      'front-candidate-4',
    ])
  })

  it('maps an output-major candidate matrix back to each logical output', async () => {
    const recipePlan = plan()
    recipePlan.outputCount = 2
    recipePlan.taskCount = 1
    recipePlan.outputs = [
      { id: 'front', label: '正面' },
      { id: 'back', label: '背面' },
    ]

    const collection = await runCapabilityRecipePlan(recipePlan, {
      executeTask: async () => [
        imageResult('front-candidate-1'),
        imageResult('front-candidate-2'),
        imageResult('back-candidate-1'),
        imageResult('back-candidate-2'),
      ],
    })

    expect(collection.items.map((item) => item.candidates?.map((result) => result.id))).toEqual([
      ['front-candidate-1', 'front-candidate-2'],
      ['back-candidate-1', 'back-candidate-2'],
    ])
  })
})

describe('appendRecipeCollection', () => {
  it('returns a new node without overwriting the existing result or collection', () => {
    const originalResult = imageResult('original')
    const node: GenerationCanvasNode = {
      id: 'image-1',
      kind: 'image',
      title: 'Image',
      position: { x: 0, y: 0 },
      result: originalResult,
      resultCollections: [{ id: 'old', recipeId: 'old.recipe', createdAt: 1, items: [] }],
    }
    const collection = {
      id: 'new',
      recipeId: 'image.multiview.custom',
      createdAt: 100,
      items: [{ id: 'front', label: '正面', status: 'success' as const, result: imageResult('front') }],
    }

    const next = appendRecipeCollection(node, collection)

    expect(next).not.toBe(node)
    expect(node.resultCollections).toHaveLength(1)
    expect(next.result).toBe(originalResult)
    expect(next.resultCollections?.map((entry) => entry.id)).toEqual(['old', 'new'])
  })
})
