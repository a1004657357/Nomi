import { describe, expect, it, vi } from 'vitest'
import type {
  GenerationNodeResult,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import {
  createMultiviewSubjectVisionComparator,
  mergeMultiviewSubjectVisionReview,
} from './multiviewSubjectVisionReview'
import { evaluateMultiviewSubjectQuality } from './multiviewSubjectQuality'

function image(id: string): GenerationNodeResult {
  return {
    id,
    type: 'image',
    url: `nomi-local://asset/project/${id}.png`,
    createdAt: 100,
  }
}

function collection(): GenerationResultCollection {
  return {
    id: 'collection-1',
    recipeId: 'image.multiview.custom',
    createdAt: 100,
    source: {
      nodeId: 'source-node',
      resultId: 'source',
      label: '来源主体',
      url: image('source').url,
    },
    items: [
      {
        id: 'front',
        label: '正面',
        azimuth: 0,
        elevation: 0,
        status: 'success',
        result: image('front'),
      },
      {
        id: 'rear',
        label: '背面',
        azimuth: 180,
        elevation: 10,
        status: 'success',
        result: image('rear'),
      },
    ],
    quality: {
      version: 1,
      kind: 'multiview',
      evaluator: 'custom-view-local-v2',
      status: 'unavailable',
      evaluatedAt: 101,
      checks: [
        {
          id: 'image-availability',
          label: '图片完整性',
          status: 'pass',
          summary: '2 张结果可读取',
        },
        {
          id: 'subject-semantic-identity',
          label: '语义身份一致性',
          status: 'unavailable',
          summary: '没有比较器',
        },
        {
          id: 'subject-geometry-consistency',
          label: '主体几何一致性',
          status: 'unavailable',
          summary: '没有比较器',
        },
      ],
      metrics: { semanticComparatorAvailable: false },
    },
  }
}

describe('createMultiviewSubjectVisionComparator', () => {
  it('sends the source first and all output views in one auditable judge call', async () => {
    const judge = vi.fn<Parameters<typeof createMultiviewSubjectVisionComparator>[0]['judge']>(async () => `\`\`\`json
{
  "sourceSubjectDetected": true,
  "items": [
    {
      "itemId": "front",
      "outputSubjectDetected": true,
      "sameSubject": true,
      "identityScore": 0.96,
      "geometryConsistent": true,
      "geometryScore": 0.91,
      "cameraMatches": true,
      "cameraScore": 0.93,
      "backgroundCompliant": true,
      "backgroundScore": 0.9
    },
    {
      "itemId": "rear",
      "outputSubjectDetected": true,
      "sameSubject": false,
      "identityScore": 0.42,
      "geometryConsistent": true,
      "geometryScore": 0.82,
      "cameraMatches": false,
      "cameraScore": 0.28,
      "backgroundCompliant": false,
      "backgroundScore": 0.2,
      "detail": "背面主体轮廓发生替换"
    }
  ]
}
\`\`\``)
    const comparator = createMultiviewSubjectVisionComparator({
      evaluator: 'agent-vision-v1:test/vision',
      judge,
    })

    const result = await comparator({
      source: image('source'),
      outputs: collection().items.map((item) => ({
        itemId: item.id,
        label: item.label,
        result: item.result!,
        azimuth: item.azimuth,
        elevation: item.elevation,
      })),
    })

    expect(judge).toHaveBeenCalledTimes(1)
    expect(judge.mock.calls[0]?.[0].images.map((entry) => entry.itemId)).toEqual([
      'source',
      'front',
      'rear',
    ])
    expect(judge.mock.calls[0]?.[0].prompt).toContain('front')
    expect(judge.mock.calls[0]?.[0].prompt).toContain('方位角 180°')
    expect(result).toMatchObject({
      evaluator: 'agent-vision-v1:test/vision',
      sourceSubjectDetected: true,
      items: [
        {
          itemId: 'front',
          sameSubject: true,
          geometryConsistent: true,
          cameraMatches: true,
          backgroundCompliant: true,
        },
        {
          itemId: 'rear',
          sameSubject: false,
          geometryConsistent: true,
          cameraMatches: false,
          backgroundCompliant: false,
        },
      ],
    })
  })

  it('omits invalid or missing semantic fields so quality stays fail-closed', async () => {
    const comparator = createMultiviewSubjectVisionComparator({
      evaluator: 'test',
      judge: async () => JSON.stringify({
        sourceSubjectDetected: true,
        items: [{
          itemId: 'front',
          outputSubjectDetected: true,
          sameSubject: 'yes',
          identityScore: 4,
        }],
      }),
    })
    const source = collection()
    const reviewed = await evaluateMultiviewSubjectQuality({
      sourceResult: image('source'),
      collection: source,
      compareSubjects: comparator,
    })

    expect(reviewed.checks.map((check) => check.status)).toEqual([
      'unavailable',
      'unavailable',
      'unavailable',
      'unavailable',
    ])
    expect(reviewed.checks[0].details).toContain('正面：比较器未返回身份结论')
    expect(reviewed.checks[1].details).toContain('正面：比较器未返回几何结论')
    expect(reviewed.checks[2].details).toContain('正面：比较器未返回机位结论')
    expect(reviewed.checks[3].details).toContain('正面：比较器未返回背景策略结论')
  })

  it('rejects malformed structured output instead of guessing a pass', async () => {
    const comparator = createMultiviewSubjectVisionComparator({
      evaluator: 'test',
      judge: async () => '主体看起来基本一致',
    })
    await expect(comparator({
      source: image('source'),
      outputs: [],
    })).rejects.toThrow('视觉复核没有返回有效 JSON')
  })
})

describe('mergeMultiviewSubjectVisionReview', () => {
  it('replaces only semantic checks and recomputes the overall status', async () => {
    const base = collection()
    const semantic = await evaluateMultiviewSubjectQuality({
      sourceResult: image('source'),
      collection: base,
      compareSubjects: async () => ({
        evaluator: 'agent-vision-v1:test/vision',
        sourceSubjectDetected: true,
        items: [
          {
            itemId: 'front',
            outputSubjectDetected: true,
            sameSubject: true,
            geometryConsistent: true,
            cameraMatches: true,
            backgroundCompliant: true,
          },
          {
            itemId: 'rear',
            outputSubjectDetected: true,
            sameSubject: true,
            geometryConsistent: false,
            cameraMatches: false,
            backgroundCompliant: true,
            detail: '后视图宽度与来源不一致',
          },
        ],
      }),
    })
    const merged = mergeMultiviewSubjectVisionReview(base, semantic, {
      evaluatedAt: 200,
      totalTokens: 321,
    })

    expect(merged.quality?.checks[0]).toEqual(base.quality?.checks[0])
    expect(merged.quality?.checks.slice(1).map((check) => [check.id, check.status])).toEqual([
      ['subject-semantic-identity', 'pass'],
      ['subject-geometry-consistency', 'fail'],
      ['requested-camera-adherence', 'fail'],
      ['background-policy-compliance', 'pass'],
    ])
    expect(merged.quality).toMatchObject({
      status: 'fail',
      evaluatedAt: 200,
      metrics: {
        semanticComparatorAvailable: true,
        semanticComparatorEvaluator: 'agent-vision-v1:test/vision',
        semanticReviewTotalTokens: 321,
      },
    })
  })
})
