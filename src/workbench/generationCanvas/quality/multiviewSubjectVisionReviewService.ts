import type {
  AgentAttachmentPayload,
  AgentsChatResponseDto,
} from '../../../api/desktopClient'
import {
  sendWorkbenchAiMessage,
  type WorkbenchAiRequest,
  type WorkbenchAiStreamHandlers,
} from '../../ai/workbenchAiClient'
import type {
  GenerationNodeResult,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import {
  createMultiviewSubjectVisionComparator,
  mergeMultiviewSubjectVisionReview,
  type MultiviewVisionJudgeRequest,
} from './multiviewSubjectVisionReview'
import {
  evaluateMultiviewSubjectQuality,
  type MultiviewSubjectComparator,
} from './multiviewSubjectQuality'
import type { VisionReviewModelOption } from './visionReviewModels'

type SendVisionReviewMessage = (
  input: WorkbenchAiRequest,
  handlers: WorkbenchAiStreamHandlers,
) => Promise<AgentsChatResponseDto>

type VisionReviewDeps = {
  clearSession: (sessionKey: string) => Promise<void>
  send: SendVisionReviewMessage
  now: () => number
}

export type MultiviewVisionReviewAssetCheck =
  | {
      ok: true
      sourceResult: GenerationNodeResult
      successfulOutputCount: number
      attachmentCount: number
    }
  | {
      ok: false
      error: string
    }

function localImageUrl(input: {
  url?: string
  thumbnailUrl?: string
} | undefined): string | null {
  return [input?.url, input?.thumbnailUrl].find(
    (value): value is string => typeof value === 'string' && value.startsWith('nomi-local://'),
  ) ?? null
}

function mimeTypeFromUrl(url: string): string {
  const clean = url.toLowerCase().split(/[?#]/)[0]
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg'
  if (clean.endsWith('.webp')) return 'image/webp'
  if (clean.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

function safeFileStem(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'view'
}

function backgroundPolicyForCollection(
  collection: GenerationResultCollection,
): 'preserve_scene' | 'neutral_turntable' {
  return collection.quality?.metrics?.backgroundPolicy === 'neutral_turntable'
    ? 'neutral_turntable'
    : 'preserve_scene'
}

export function validateMultiviewVisionReviewAssets(
  collection: GenerationResultCollection,
): MultiviewVisionReviewAssetCheck {
  if (!collection.quality || !['grid9', 'multiview'].includes(collection.quality.kind)) {
    return { ok: false, error: '当前结果不是九宫格或自定义机位集合' }
  }
  if (!collection.source) return { ok: false, error: '结果集合没有保留来源图片快照' }
  const sourceUrl = localImageUrl(collection.source)
  if (!sourceUrl) {
    return { ok: false, error: '来源图片尚未落盘，无法安全发送给视觉模型复核' }
  }
  const successful = collection.items.filter((item) => item.status === 'success' && item.result?.type === 'image')
  if (!successful.length) return { ok: false, error: '当前没有可复核的成功图片结果' }
  const remoteOnly = successful.filter((item) => !localImageUrl(item.result))
  if (remoteOnly.length) {
    return {
      ok: false,
      error: `${remoteOnly.map((item) => item.label).join('、')} 尚未落盘，无法安全发送给视觉模型复核`,
    }
  }
  return {
    ok: true,
    sourceResult: {
      id: collection.source.resultId,
      type: 'image',
      url: sourceUrl,
      createdAt: collection.createdAt,
    },
    successfulOutputCount: successful.length,
    attachmentCount: successful.length + 1,
  }
}

function attachmentsForJudge(
  request: MultiviewVisionJudgeRequest,
): AgentAttachmentPayload[] {
  return request.images.map((image, index) => {
    const url = localImageUrl(image.result)
    if (!url) throw new Error(`${image.label} 尚未落盘，视觉复核已停止`)
    const contentType = mimeTypeFromUrl(url)
    const extension = contentType === 'image/jpeg'
      ? 'jpg'
      : contentType === 'image/webp'
        ? 'webp'
        : contentType === 'image/gif'
          ? 'gif'
          : 'png'
    return {
      url,
      contentType,
      fileName: `${String(index + 1).padStart(2, '0')}-${safeFileStem(image.itemId)}.${extension}`,
      kind: 'image',
    }
  })
}

function createWorkbenchVisionReviewRunner(input: {
  model: Pick<VisionReviewModelOption, 'vendorKey' | 'modelKey' | 'label'>
  sessionId: string
  projectId?: string
  deps?: Partial<VisionReviewDeps>
}): {
  comparator: MultiviewSubjectComparator
  evaluator: string
  response: () => AgentsChatResponseDto | undefined
} {
  const deps: VisionReviewDeps = {
    clearSession: input.deps?.clearSession ?? (async () => {}),
    send: input.deps?.send ?? sendWorkbenchAiMessage,
    now: input.deps?.now ?? Date.now,
  }
  const evaluator = `agent-vision-v1:${input.model.vendorKey}/${input.model.modelKey}`
  const sessionKey = [
    'nomi:multiview-vision-review',
    input.projectId || 'local',
    input.sessionId,
  ].join(':')
  let lastResponse: AgentsChatResponseDto | undefined
  const comparator = createMultiviewSubjectVisionComparator({
    evaluator,
    judge: async (request) => {
      await deps.clearSession(sessionKey).catch(() => {})
      lastResponse = await deps.send({
        prompt: request.prompt,
        displayPrompt: `多视角主体复核（${request.images.length - 1} 个机位）`,
        sessionKey,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        skillKey: '',
        skillName: '多视角视觉复核',
        mode: 'chat',
        disableTools: true,
        agentVendorKey: input.model.vendorKey,
        agentModelKey: input.model.modelKey,
        attachments: attachmentsForJudge(request),
      }, {})
      if (lastResponse.finishReason === 'length') {
        throw new Error('视觉模型输出达到长度上限，结构化复核结果不完整')
      }
      return lastResponse.text
    },
  })
  return { comparator, evaluator, response: () => lastResponse }
}

export function createWorkbenchMultiviewSubjectComparator(input: {
  model: Pick<VisionReviewModelOption, 'vendorKey' | 'modelKey' | 'label'>
  sessionId: string
  projectId?: string
  deps?: Partial<VisionReviewDeps>
}): MultiviewSubjectComparator {
  return createWorkbenchVisionReviewRunner(input).comparator
}

export async function reviewMultiviewCollectionWithVisionModel(input: {
  collection: GenerationResultCollection
  model: Pick<VisionReviewModelOption, 'vendorKey' | 'modelKey' | 'label'>
  projectId?: string
  deps?: Partial<VisionReviewDeps>
}): Promise<GenerationResultCollection> {
  const assets = validateMultiviewVisionReviewAssets(input.collection)
  if (!assets.ok) throw new Error(assets.error)
  const runner = createWorkbenchVisionReviewRunner({
    model: input.model,
    sessionId: input.collection.id,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.deps ? { deps: input.deps } : {}),
  })
  const semantic = await evaluateMultiviewSubjectQuality({
    sourceResult: assets.sourceResult,
    collection: input.collection,
    compareSubjects: runner.comparator,
    backgroundPolicy: backgroundPolicyForCollection(input.collection),
  })
  const response = runner.response()
  return mergeMultiviewSubjectVisionReview(input.collection, semantic, {
    evaluatedAt: input.deps?.now?.() ?? Date.now(),
    requestedEvaluator: runner.evaluator,
    ...(response?.usage?.promptTokens !== undefined
      ? { promptTokens: response.usage.promptTokens }
      : {}),
    ...(response?.usage?.completionTokens !== undefined
      ? { completionTokens: response.usage.completionTokens }
      : {}),
    ...(response?.usage?.totalTokens !== undefined
      ? { totalTokens: response.usage.totalTokens }
      : {}),
  })
}
