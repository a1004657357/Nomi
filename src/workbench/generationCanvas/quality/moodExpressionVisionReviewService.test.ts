import { describe, expect, it, vi } from 'vitest'
import type { GenerationResultCollection } from '../model/generationCanvasTypes'
import { reviewMoodCollectionWithVisionModel } from './moodExpressionVisionReviewService'

type SendVisionReview = NonNullable<NonNullable<Parameters<typeof reviewMoodCollectionWithVisionModel>[0]['deps']>['send']>

function collection(local = true): GenerationResultCollection {
  const url = (id: string) => local
    ? `nomi-local://asset/project/${id}.png`
    : `https://temporary.example/${id}.png`
  return {
    id: 'mood-run',
    recipeId: 'portrait.mood',
    createdAt: 100,
    source: {
      nodeId: 'source',
      resultId: 'source-result',
      label: '来源人像',
      url: url('source'),
    },
    items: [{
      id: 'mood-e4-a0',
      label: '能量 4 · 亲和 0',
      energy: 4,
      affinity: 0,
      status: 'success',
      result: {
        id: 'mood-result',
        type: 'image',
        url: url('mood-e4-a0'),
        createdAt: 100,
      },
    }],
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

describe('reviewMoodCollectionWithVisionModel', () => {
  it('uses one isolated multimodal call and writes semantic evidence into quality', async () => {
    const clearSession = vi.fn(async () => {})
    const send = vi.fn<SendVisionReview>(async () => ({
      id: 'mood-review-response',
      status: 'finished',
      toolCalls: [],
      artifacts: [],
      text: JSON.stringify({
        items: [{
          itemId: 'mood-e4-a0',
          faceDetected: true,
          targetMatches: true,
          targetScore: 0.92,
          muscleRegions: ['eyelid', 'cheek', 'mouth'],
        }],
      }),
      finishReason: 'stop',
      usage: {
        promptTokens: 120,
        completionTokens: 40,
        cachedPromptTokens: 0,
        totalTokens: 160,
      },
    }))

    const reviewed = await reviewMoodCollectionWithVisionModel({
      collection: collection(),
      model: {
        vendorKey: 'relay',
        modelKey: 'qwen-vl-plus',
        label: 'Qwen VL Plus · Relay',
      },
      projectId: 'project',
      deps: {
        clearSession,
        send,
        now: () => 200,
      },
    })

    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      mode: 'chat',
      disableTools: true,
      agentVendorKey: 'relay',
      agentModelKey: 'qwen-vl-plus',
    })
    expect(send.mock.calls[0]?.[0].attachments?.map((item) => item.url)).toEqual([
      'nomi-local://asset/project/source.png',
      'nomi-local://asset/project/mood-e4-a0.png',
    ])
    expect(reviewed.quality).toMatchObject({
      status: 'pass',
      evaluatedAt: 200,
      metrics: {
        semanticReviewTotalTokens: 160,
      },
    })
  })

  it('rejects remote-only assets before any model call', async () => {
    const send = vi.fn()
    await expect(reviewMoodCollectionWithVisionModel({
      collection: collection(false),
      model: {
        vendorKey: 'relay',
        modelKey: 'qwen-vl-plus',
        label: 'Qwen VL Plus · Relay',
      },
      deps: {
        clearSession: vi.fn(async () => {}),
        send,
        now: () => 200,
      },
    })).rejects.toThrow('来源图片尚未落盘')
    expect(send).not.toHaveBeenCalled()
  })
})
