import { describe, expect, it, vi } from 'vitest'
import type { GenerationResultCollection } from '../model/generationCanvasTypes'
import {
  createWorkbenchMultiviewSubjectComparator,
  reviewMultiviewCollectionWithVisionModel,
} from './multiviewSubjectVisionReviewService'

type SendVisionReview = NonNullable<NonNullable<Parameters<typeof reviewMultiviewCollectionWithVisionModel>[0]['deps']>['send']>

function collection(local = true): GenerationResultCollection {
  const url = (id: string) => local
    ? `nomi-local://asset/project/${id}.png`
    : `https://temporary.example/${id}.png`
  return {
    id: 'collection-1',
    recipeId: 'image.multiview.grid9',
    createdAt: 100,
    source: {
      nodeId: 'source-node',
      resultId: 'source-result',
      label: '来源主体',
      url: url('source'),
    },
    items: [
      {
        id: 'front',
        label: '正面',
        status: 'success',
        result: {
          id: 'front-result',
          type: 'image',
          url: url('front'),
          createdAt: 100,
        },
      },
    ],
    quality: {
      version: 1,
      kind: 'grid9',
      evaluator: 'grid9-local-v2',
      status: 'unavailable',
      evaluatedAt: 101,
      checks: [
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
    },
  }
}

describe('reviewMultiviewCollectionWithVisionModel', () => {
  it('builds one reusable batch comparator for the generation pipeline', async () => {
    const clearSession = vi.fn(async () => {})
    const send = vi.fn<SendVisionReview>(async () => ({
      text: JSON.stringify({
        sourceSubjectDetected: true,
        items: [{ itemId: 'front', outputSubjectDetected: true, sameSubject: true }],
      }),
      finishReason: 'stop',
    }))
    const comparator = createWorkbenchMultiviewSubjectComparator({
      model: { vendorKey: 'relay', modelKey: 'qwen-vl-plus', label: 'Qwen VL Plus' },
      sessionId: 'run-1',
      projectId: 'project-1',
      deps: { clearSession, send },
    })

    const result = await comparator({
      source: { id: 'source', type: 'image', url: 'nomi-local://source.png', createdAt: 1 },
      outputs: [{
        itemId: 'front', label: '正面',
        result: { id: 'front', type: 'image', url: 'nomi-local://front.png', createdAt: 1 },
      }],
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(clearSession).toHaveBeenCalledWith('nomi:multiview-vision-review:project-1:run-1')
    expect(send.mock.calls[0]?.[0].attachments).toHaveLength(2)
    expect(result).toMatchObject({ evaluator: 'agent-vision-v1:relay/qwen-vl-plus' })
  })

  it('uses one isolated multimodal chat call and records usage in the report', async () => {
    const clearSession = vi.fn(async () => {})
    const send = vi.fn<SendVisionReview>(async () => ({
      text: JSON.stringify({
        sourceSubjectDetected: true,
        items: [{
          itemId: 'front',
          outputSubjectDetected: true,
          sameSubject: true,
          identityScore: 0.93,
          geometryConsistent: true,
          geometryScore: 0.88,
          cameraMatches: true,
          cameraScore: 0.91,
          backgroundCompliant: true,
          backgroundScore: 0.9,
        }],
      }),
      finishReason: 'stop',
      usage: {
        promptTokens: 150,
        completionTokens: 50,
        totalTokens: 200,
      },
    }))

    const reviewed = await reviewMultiviewCollectionWithVisionModel({
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
      'nomi-local://asset/project/front.png',
    ])
    expect(reviewed.quality).toMatchObject({
      status: 'pass',
      evaluatedAt: 200,
      metrics: {
        semanticReviewTotalTokens: 200,
      },
    })
  })

  it('rejects remote-only assets before any model call', async () => {
    const send = vi.fn()
    await expect(reviewMultiviewCollectionWithVisionModel({
      collection: collection(false),
      model: {
        vendorKey: 'relay',
        modelKey: 'qwen-vl-plus',
        label: 'Qwen VL Plus · Relay',
      },
      projectId: 'project',
      deps: {
        clearSession: vi.fn(async () => {}),
        send,
        now: () => 200,
      },
    })).rejects.toThrow('来源图片尚未落盘')
    expect(send).not.toHaveBeenCalled()
  })
})
