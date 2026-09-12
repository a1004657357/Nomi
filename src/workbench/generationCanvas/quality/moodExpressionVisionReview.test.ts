import { describe, expect, it, vi } from 'vitest'
import type {
  GenerationNodeResult,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import { evaluatePortraitIdentityQuality } from './portraitIdentityQuality'
import {
  createMoodExpressionVisionComparator,
  mergeMoodExpressionVisionReview,
} from './moodExpressionVisionReview'

function image(id: string): GenerationNodeResult {
  return {
    id,
    type: 'image',
    url: `nomi-local://asset/project/${id}.png`,
    createdAt: 100,
  }
}

const outputs = [
  { id: 'mood-e0-a0', label: '能量 0 · 亲和 0', energy: 0, affinity: 0 },
  { id: 'mood-e4-a4', label: '能量 4 · 亲和 4', energy: 4, affinity: 4 },
]

function collection(): GenerationResultCollection {
  return {
    id: 'mood-run',
    recipeId: 'portrait.mood',
    createdAt: 100,
    source: {
      nodeId: 'source-node',
      resultId: 'source',
      label: '来源人像',
      url: image('source').url,
    },
    items: outputs.map((output) => ({
      ...output,
      status: 'success',
      result: image(output.id),
    })),
    quality: {
      version: 1,
      kind: 'mood',
      evaluator: 'mood-identity-local-v2',
      status: 'unavailable',
      evaluatedAt: 101,
      checks: [{
        id: 'mood-expression-semantic',
        label: '目标表情语义',
        status: 'unavailable',
        summary: '没有比较器',
      }],
    },
  }
}

describe('createMoodExpressionVisionComparator', () => {
  it('sends source first and parses target expression plus muscle evidence', async () => {
    const judge = vi.fn<Parameters<typeof createMoodExpressionVisionComparator>[0]['judge']>(async () => JSON.stringify({
      items: [
        {
          itemId: 'mood-e0-a0',
          faceDetected: true,
          targetMatches: true,
          targetScore: 0.91,
          muscleRegions: ['eyelid', 'cheek', 'mouth'],
          detail: '克制微笑成立',
        },
        {
          itemId: 'mood-e4-a4',
          faceDetected: true,
          targetMatches: false,
          targetScore: 0.31,
          muscleRegions: ['eyelid', 'mouth'],
          detail: '只有视线变化',
        },
      ],
    }))
    const comparator = createMoodExpressionVisionComparator({
      evaluator: 'agent-vision-v1:test/vision',
      judge,
    })

    const compared = await comparator({
      source: image('source'),
      outputs: outputs.map((output) => ({
        itemId: output.id,
        label: output.label,
        energy: output.energy,
        affinity: output.affinity,
        result: image(output.id),
      })),
    })

    expect(judge).toHaveBeenCalledTimes(1)
    expect(judge.mock.calls[0]?.[0].images.map((entry) => entry.itemId)).toEqual([
      'source',
      'mood-e0-a0',
      'mood-e4-a4',
    ])
    expect(judge.mock.calls[0]?.[0].prompt).toContain('能量 4')
    expect(judge.mock.calls[0]?.[0].prompt).toContain('不能把视线偏移当作表情达标')
    expect(compared.items[1]).toMatchObject({
      itemId: 'mood-e4-a4',
      targetMatches: false,
      muscleRegions: ['eyelid', 'mouth'],
    })
  })

  it('rejects malformed output instead of guessing a pass', async () => {
    const comparator = createMoodExpressionVisionComparator({
      evaluator: 'test',
      judge: async () => '表情看起来差不多',
    })
    await expect(comparator({
      source: image('source'),
      outputs: [],
    })).rejects.toThrow('表情视觉复核没有返回有效 JSON')
  })
})

describe('mergeMoodExpressionVisionReview', () => {
  it('replaces only the semantic mood check and recomputes status', async () => {
    const base = collection()
    const plan = {
      id: 'mood-run',
      recipeId: 'portrait.mood',
      recipeVersion: 2,
      outputKind: 'image_collection' as const,
      sourceNodeIds: ['source-node'],
      resourceIds: [],
      model: {
        vendorKey: 'provider',
        modelKey: 'model',
        archetypeId: 'image-edit',
        modeId: 'edit',
        compatibilityTier: 'experimental' as const,
      },
      params: {},
      outputCount: 2,
      taskCount: 2,
      outputs,
      createdAt: 100,
    }
    const evaluated = await evaluatePortraitIdentityQuality({
      plan,
      collection: base,
      sourceResult: image('source'),
      compareMoodExpressions: async () => ({
        evaluator: 'agent-vision-v1:test/vision',
        items: [
          {
            itemId: 'mood-e0-a0',
            faceDetected: true,
            targetMatches: true,
            targetScore: 0.9,
            muscleRegions: ['eyelid', 'cheek', 'mouth'],
          },
          {
            itemId: 'mood-e4-a4',
            faceDetected: true,
            targetMatches: false,
            targetScore: 0.3,
            muscleRegions: ['eyelid', 'mouth'],
          },
        ],
      }),
      evaluatedAt: 200,
    })
    const semantic = evaluated.quality!.checks.find((check) => check.id === 'mood-expression-semantic')!
    const merged = mergeMoodExpressionVisionReview(base, semantic, {
      evaluatedAt: 200,
      evaluator: 'agent-vision-v1:test/vision',
      totalTokens: 240,
    })

    expect(merged.quality).toMatchObject({
      status: 'fail',
      evaluatedAt: 200,
      metrics: {
        moodExpressionComparatorAvailable: true,
        moodExpressionComparatorEvaluator: 'agent-vision-v1:test/vision',
        semanticReviewTotalTokens: 240,
      },
    })
    expect(merged.quality?.checks).toHaveLength(1)
    expect(merged.quality?.checks[0]).toMatchObject({
      id: 'mood-expression-semantic',
      status: 'fail',
      itemIds: ['mood-e4-a4'],
    })
  })
})
