import { translateCapabilityWorkflowText } from '../../../i18n/capabilityWorkflowText'
import i18n from '../../../i18n/index'
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
  createMoodExpressionVisionComparator,
  mergeMoodExpressionVisionReview,
  type MoodExpressionVisionJudgeRequest,
} from './moodExpressionVisionReview'
import { evaluateMoodExpressionSemanticQuality } from './portraitIdentityQuality'
import type { VisionReviewModelOption } from './visionReviewModels'

type SendVisionReviewMessage = (
  input: WorkbenchAiRequest,
  handlers: WorkbenchAiStreamHandlers,
) => Promise<AgentsChatResponseDto>

type MoodVisionReviewDeps = {
  clearSession: (sessionKey: string) => Promise<void>
  send: SendVisionReviewMessage
  now: () => number
}

type MoodVisionReviewAssets = {
  sourceResult: GenerationNodeResult
  outputCount: number
  attachmentCount: number
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
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'mood'
}

export function validateMoodVisionReviewAssets(
  collection: GenerationResultCollection,
): MoodVisionReviewAssets {
  if (collection.quality?.kind !== 'mood' || collection.recipeId !== 'portrait.mood') {
    throw new Error(i18n.t('capabilityWorkflow.theCurrentResultIsNotAPortraitMoodCollection'))
  }
  if (!collection.source) throw new Error(i18n.t('capabilityWorkflow.theMoodCollectionHasNoRetainedSourcePortraitSnapshot'))
  const sourceUrl = localImageUrl(collection.source)
  if (!sourceUrl) throw new Error(i18n.t('capabilityWorkflow.theSourceImageIsNotSavedLocallyAndCannot'))
  const successful = collection.items.filter((item) => (
    item.status === 'success'
    && item.result?.type === 'image'
    && typeof item.energy === 'number'
    && typeof item.affinity === 'number'
  ))
  if (!successful.length) throw new Error(i18n.t('capabilityWorkflow.noSuccessfulMoodImagesAreAvailableForReview'))
  const remoteOnly = successful.filter((item) => !localImageUrl(item.result))
  if (remoteOnly.length) {
    throw new Error(i18n.t('capabilityWorkflow.isNotSavedLocallyAndCannotBeSafelySent', { v0: remoteOnly.map((item) => translateCapabilityWorkflowText(item.label)).join('、') }))
  }
  return {
    sourceResult: {
      id: collection.source.resultId,
      type: 'image',
      url: sourceUrl,
      createdAt: collection.createdAt,
    },
    outputCount: successful.length,
    attachmentCount: successful.length + 1,
  }
}

function attachmentsForJudge(request: MoodExpressionVisionJudgeRequest): AgentAttachmentPayload[] {
  return request.images.map((image, index) => {
    const url = localImageUrl(image.result)
    if (!url) throw new Error(i18n.t('capabilityWorkflow.isNotSavedLocallyVisualReviewStopped', { v0: translateCapabilityWorkflowText(image.label) }))
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

export async function reviewMoodCollectionWithVisionModel(input: {
  collection: GenerationResultCollection
  model: Pick<VisionReviewModelOption, 'vendorKey' | 'modelKey' | 'label'>
  projectId?: string
  deps?: Partial<MoodVisionReviewDeps>
}): Promise<GenerationResultCollection> {
  const assets = validateMoodVisionReviewAssets(input.collection)
  const deps: MoodVisionReviewDeps = {
    clearSession: input.deps?.clearSession ?? (async () => {}),
    send: input.deps?.send ?? sendWorkbenchAiMessage,
    now: input.deps?.now ?? Date.now,
  }
  const evaluator = `agent-vision-v1:${input.model.vendorKey}/${input.model.modelKey}`
  const sessionKey = [
    'nomi:mood-vision-review',
    input.projectId || 'local',
    input.collection.id,
  ].join(':')
  let response: AgentsChatResponseDto | undefined
  const comparator = createMoodExpressionVisionComparator({
    evaluator,
    judge: async (request) => {
      await deps.clearSession(sessionKey).catch(() => {})
      response = await deps.send({
        prompt: request.prompt,
        displayPrompt: i18n.t('capabilityWorkflow.moodPerformanceReviewResults', { v0: request.images.length - 1 }),
        sessionKey,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        skillKey: '',
        skillName: i18n.t('capabilityWorkflow.moodPerformanceVisualReview'),
        mode: 'chat',
        disableTools: true,
        agentVendorKey: input.model.vendorKey,
        agentModelKey: input.model.modelKey,
        attachments: attachmentsForJudge(request),
      }, {})
      if (response.finishReason === 'length') {
        throw new Error(i18n.t('capabilityWorkflow.theVisualModelReachedItsOutputLimitTheStructured'))
      }
      return response.text
    },
  })
  const semantic = await evaluateMoodExpressionSemanticQuality(
    input.collection,
    assets.sourceResult,
    comparator,
  )
  return mergeMoodExpressionVisionReview(input.collection, semantic.check, {
    evaluatedAt: deps.now(),
    evaluator: semantic.evaluator || evaluator,
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
