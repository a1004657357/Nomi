import type { WorkbenchAiRequest } from '../../src/workbench/ai/workbenchAiClient'
import type {
  GenerationNodeResult,
  GenerationResultCollection,
} from '../../src/workbench/generationCanvas/model/generationCanvasTypes'
import { reviewMultiviewCollectionWithVisionModel } from '../../src/workbench/generationCanvas/quality/multiviewSubjectVisionReviewService'

export type VisionReviewAdapterAssertion = {
  label: string
  passed: boolean
  evidence?: string
}

const VIEW_IDS = ['front', 'right', 'rear'] as const

function image(id: string, local: boolean): GenerationNodeResult {
  return {
    id: `${id}-result`,
    type: 'image',
    url: local
      ? `nomi-local://asset/eval/${id}.png`
      : `https://temporary.example/${id}.png`,
    createdAt: 1,
  }
}

function collection(local: boolean): GenerationResultCollection {
  return {
    id: local ? 'vision-review-local' : 'vision-review-remote',
    recipeId: 'image.multiview.custom',
    createdAt: 1,
    source: {
      nodeId: 'source-node',
      resultId: 'source-result',
      label: '来源主体',
      url: image('source', local).url,
    },
    items: VIEW_IDS.map((id, index) => ({
      id,
      label: id === 'front' ? '正面' : id === 'right' ? '右侧' : '背面',
      azimuth: index * 90,
      elevation: 0,
      status: 'success',
      result: image(id, local),
    })),
    quality: {
      version: 1,
      kind: 'multiview',
      evaluator: 'custom-view-local-v2',
      status: 'unavailable',
      evaluatedAt: 1,
      checks: [
        {
          id: 'image-availability',
          label: '图片完整性',
          status: 'pass',
          summary: '3 张结果可读取',
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

function assertion(
  passed: boolean,
  label: string,
  evidence?: string,
): VisionReviewAdapterAssertion {
  return { label, passed, ...(evidence ? { evidence } : {}) }
}

export async function evaluateVisionReviewAdapterContract(): Promise<VisionReviewAdapterAssertion[]> {
  let clearCalls = 0
  let sendCalls = 0
  let requestSnapshot: WorkbenchAiRequest | null = null
  const reviewed = await reviewMultiviewCollectionWithVisionModel({
    collection: collection(true),
    model: {
      vendorKey: 'eval-vision-vendor',
      modelKey: 'eval-vision-model',
      label: 'Eval Vision Model',
    },
    projectId: 'eval-project',
    deps: {
      clearSession: async () => {
        clearCalls += 1
      },
      send: async (request) => {
        sendCalls += 1
        requestSnapshot = request
        return {
          id: 'eval-vision-response', status: 'finished', toolCalls: [], artifacts: [],
          text: JSON.stringify({
            sourceSubjectDetected: true,
            items: VIEW_IDS.map((itemId) => ({
              itemId,
              outputSubjectDetected: true,
              sameSubject: true,
              identityScore: 0.94,
              geometryConsistent: true,
              geometryScore: 0.89,
              cameraMatches: true,
              cameraScore: 0.92,
              backgroundCompliant: true,
              backgroundScore: 0.9,
            })),
          }),
          finishReason: 'stop',
          usage: {
            cachedPromptTokens: 0,
            promptTokens: 180,
            completionTokens: 60,
            totalTokens: 240,
          },
        }
      },
      now: () => 200,
    },
  })

  const request = requestSnapshot as WorkbenchAiRequest | null
  const attachmentUrls = request?.attachments?.map((entry) => entry.url) ?? []
  const semanticCheckIds = new Set([
    'subject-semantic-identity',
    'subject-geometry-consistency',
    'requested-camera-adherence',
    'background-policy-compliance',
  ])
  const semanticChecks = reviewed.quality?.checks.filter((entry) => semanticCheckIds.has(entry.id)) ?? []
  const sendCallsBeforeRemoteCheck = sendCalls
  let remoteError = ''
  try {
    await reviewMultiviewCollectionWithVisionModel({
      collection: collection(false),
      model: {
        vendorKey: 'eval-vision-vendor',
        modelKey: 'eval-vision-model',
        label: 'Eval Vision Model',
      },
      deps: {
        clearSession: async () => {
          clearCalls += 1
        },
        send: async () => {
          sendCalls += 1
          throw new Error('remote-only assets must not reach the model adapter')
        },
        now: () => 201,
      },
    })
  } catch (error) {
    remoteError = error instanceof Error ? error.message : String(error)
  }

  return [
    assertion(sendCallsBeforeRemoteCheck === 1, 'All output views use one multimodal model request', String(sendCallsBeforeRemoteCheck)),
    assertion(clearCalls === 1, 'The production adapter uses one isolated cleared review session', String(clearCalls)),
    assertion(
      request?.disableTools === true
        && request.mode === 'chat'
        && request.agentVendorKey === 'eval-vision-vendor'
        && request.agentModelKey === 'eval-vision-model',
      'The request disables tools and pins the explicitly selected vision model',
    ),
    assertion(
      attachmentUrls.join(',') === [
        'nomi-local://asset/eval/source.png',
        'nomi-local://asset/eval/front.png',
        'nomi-local://asset/eval/right.png',
        'nomi-local://asset/eval/rear.png',
      ].join(','),
      'The source is first and every local output follows in stable order',
      attachmentUrls.join(','),
    ),
    assertion(
      reviewed.quality?.checks[0]?.id === 'image-availability'
        && reviewed.quality.checks[0].status === 'pass',
      'Existing local quality checks survive semantic review merging',
    ),
    assertion(
      reviewed.quality?.status === 'pass'
        && semanticChecks.length === 4
        && semanticChecks.every((entry) => entry.status === 'pass'),
      'Complete structured review can pass identity, geometry, camera, and background independently',
    ),
    assertion(
      reviewed.quality?.metrics?.semanticComparatorEvaluator
        === 'agent-vision-v1:eval-vision-vendor/eval-vision-model'
        && reviewed.quality.metrics.semanticReviewTotalTokens === 240,
      'The report records evaluator provenance and token usage',
    ),
    assertion(
      remoteError.includes('来源图片尚未落盘') && sendCalls === sendCallsBeforeRemoteCheck,
      'Remote-only assets fail before any model request',
      remoteError,
    ),
  ]
}
