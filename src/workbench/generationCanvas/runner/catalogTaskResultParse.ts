import { type TaskKind, type TaskResultDto } from '../../api/taskApi'
import i18n from '../../../i18n'
import type {
  GenerationCanvasNode,
  GenerationNodeResult,
  GenerationProvenance,
  GenerationResultType,
} from '../model/generationCanvasTypes'
import { asFiniteNumber, asTrimmedString, selectedModelKey } from './catalogTaskResolve'

// transcribe(Whisper) 也是「无 asset、文本在 raw」——同走文本支（raw.text 由 extractTextFromChatRaw 末尾捕获）。
const TEXT_TASK_KINDS = new Set<TaskKind>(['chat', 'prompt_refine', 'image_to_prompt', 'transcribe'])

/**
 * C5: 从 chat 任务的 raw 响应里取出模型生成的文本。runtime 文本分支直接 POST
 * /v1/chat/completions 并把响应原样放进 raw（assets 为空），所以这里要兼容
 * OpenAI（choices[].message.content）与 Anthropic Messages（content[].text）两种形状。
 */
function extractTextFromChatRaw(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as Record<string, unknown>
  // APIMart MiniMax-H3 Context-IR 是异步 profile：完成态文本位于
  // data.result.prompt（不是 OpenAI choices，也不是视频 assets）。保留通用 shape 读取，
  // 让 prompt_refine mapping 与已有文本节点/优化器共用同一归一出口。
  const data = record.data
  if (data && typeof data === 'object') {
    const result = (data as Record<string, unknown>).result
    if (result && typeof result === 'object') {
      const prompt = asTrimmedString((result as Record<string, unknown>).prompt)
      if (prompt) return prompt
    }
  }
  const directResult = record.result
  if (directResult && typeof directResult === 'object') {
    const prompt = asTrimmedString((directResult as Record<string, unknown>).prompt)
    if (prompt) return prompt
  }
  const choices = record.choices
  if (Array.isArray(choices) && choices.length) {
    const first = choices[0] as Record<string, unknown> | undefined
    const message = first?.message as Record<string, unknown> | undefined
    const content = message?.content
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === 'string' ? part : asTrimmedString((part as Record<string, unknown>)?.text)))
        .filter(Boolean)
        .join('')
        .trim()
    }
    const legacyText = asTrimmedString(first?.text)
    if (legacyText) return legacyText
  }
  const content = record.content
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => asTrimmedString((part as Record<string, unknown>)?.text))
      .filter(Boolean)
      .join('')
      .trim()
    if (joined) return joined
  }
  return asTrimmedString(record.text)
}

function generationTypeForTask(taskKind: TaskKind): GenerationResultType {
  if (taskKind === 'text_to_video' || taskKind === 'image_to_video') return 'video'
  if (taskKind === 'text_to_audio') return 'audio'
  if (taskKind === 'text_to_3d' || taskKind === 'image_to_3d') return 'model3d'
  return 'image'
}

function readFailureMessageFromRaw(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const record = raw as Record<string, unknown>
  const direct = [record.message, record.error, record.errorMessage, record.failureReason, record.reason]
  for (const value of direct) {
    const text = asTrimmedString(value)
    if (text) return text
  }
  const nested = [record.raw, record.response, record.data, record.result, record.jimengWeb, record.pavoWeb]
  for (const value of nested) {
    const text = readFailureMessageFromRaw(value)
    if (text) return text
  }
  return ''
}

function describeTaskFailure(result: TaskResultDto): string {
  const directMessage = typeof result.error === 'string' ? result.error.trim() : ''
  const rawMessage = readFailureMessageFromRaw(result.raw)
  const suffix = [result.id ? `taskId=${result.id}` : '', result.kind ? `kind=${result.kind}` : '']
    .filter(Boolean)
    .join(', ')
  const prefix = directMessage || rawMessage || '模型任务执行失败'
  return suffix ? `${prefix} (${suffix})` : prefix
}

function readDurationSeconds(asset: { durationSeconds?: unknown } | null | undefined): number | undefined {
  return asFiniteNumber(asset?.durationSeconds)
}

export function normalizeCatalogTaskResult(result: TaskResultDto, node: GenerationCanvasNode): GenerationNodeResult {
  if (result.status === 'failed') {
    throw new Error(describeTaskFailure(result))
  }
  // C5: 文本任务没有 asset，文本在 raw 里。单独成支，不走下面的图片/视频 asset 逻辑。
  if (TEXT_TASK_KINDS.has(result.kind)) {
    const text = extractTextFromChatRaw(result.raw)
    if (!text) throw new Error(i18n.t('generationCommon.error.noText'))
    const provenance = extractProvenanceFromTaskResult(result)
    return {
      id: `${node.id}-${result.id || Date.now()}`,
      type: 'text',
      text,
      model: selectedModelKey(node) || undefined,
      taskId: result.id,
      taskKind: 'text',
      raw: result.raw,
      createdAt: Date.now(),
      ...(provenance ? { provenance } : {}),
    }
  }
  const inferredType = generationTypeForTask(result.kind)
  // Prefer actual asset type over taskKind inference — if the API returns a video asset, show video
  const firstVideoAsset = result.assets.find((item) => item.type === 'video' && asTrimmedString(item.url))
  const firstImageAsset = result.assets.find((item) => item.type === 'image' && asTrimmedString(item.url))
  const firstAudioAsset = result.assets.find((item) => item.type === 'audio' && asTrimmedString(item.url))
  const firstModel3dAsset = result.assets.find((item) => item.type === 'model3d' && asTrimmedString(item.url))
  const asset = inferredType === 'model3d'
    ? firstModel3dAsset
    : firstVideoAsset || firstImageAsset || firstAudioAsset || result.assets.find((item) => asTrimmedString(item.url))
  if (!asset)
    throw new Error(
      inferredType === 'video'
        ? i18n.t('generationCommon.error.noVideoUrl')
        : inferredType === 'audio'
          ? i18n.t('generationCommon.error.noAudio')
          : inferredType === 'model3d'
            ? i18n.t('generationCommon.error.noModel3dUrl')
            : i18n.t('generationCommon.error.noImageUrl'),
    )
  // E11: propagate provenance from electron TaskResult into the node result.
  const provenance = extractProvenanceFromTaskResult(result)
  const createdAt = Date.now()
  const baseId = `${node.id}-${result.id || createdAt}`
  const buildAssetResult = (
    candidate: (typeof result.assets)[number],
    id: string,
    includeRaw: boolean,
  ): GenerationNodeResult => {
    const candidateType =
      candidate.type === 'video' || candidate.type === 'image' || candidate.type === 'audio' || candidate.type === 'model3d'
        ? candidate.type
        : inferredType
    return {
      id,
      type: candidateType,
      url: candidate.url,
      thumbnailUrl: candidate.thumbnailUrl || undefined,
      ...(candidate.providerUrl ? { providerUrl: candidate.providerUrl } : {}),
      model: selectedModelKey(node) || undefined,
      durationSeconds: candidateType === 'video' ? readDurationSeconds(candidate) : undefined,
      taskId: result.id,
      taskKind: candidateType,
      assetId: candidate.assetId || undefined,
      assetRefId: candidate.assetRefId || undefined,
      ...(candidateType === 'model3d' && candidate.model3dValidation
        ? { model3dValidation: candidate.model3dValidation }
        : {}),
      ...(includeRaw ? { raw: result.raw } : {}),
      createdAt,
      ...(provenance ? { provenance } : {}),
    }
  }
  const primary = buildAssetResult(asset, baseId, true)
  const alternatives = result.assets
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate !== asset && Boolean(asTrimmedString(candidate.url)))
    .map(({ candidate, index }) => buildAssetResult(candidate, `${baseId}-asset-${index + 1}`, false))
  return alternatives.length ? { ...primary, alternatives } : primary
}

/**
 * E11: Extract provenance from electron TaskResult.
 *
 * The runtime attaches a `provenance` sibling field at the TaskResult level
 * (see electron/runtime.ts runTask). This helper validates the minimum
 * required field (`timestamp`) and returns a clean GenerationProvenance
 * for the renderer to embed in node.result.provenance.
 *
 * Returns undefined for legacy results (e.g., from v0.4.0 cached tasks).
 */
function extractProvenanceFromTaskResult(result: TaskResultDto): GenerationProvenance | undefined {
  const raw = (result as TaskResultDto & { provenance?: unknown }).provenance
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const ts = typeof rec.timestamp === 'number' ? rec.timestamp : Date.now()
  return {
    timestamp: ts,
    ...(typeof rec.provider === 'string' ? { provider: rec.provider } : {}),
    ...(typeof rec.modelKey === 'string' ? { modelKey: rec.modelKey } : {}),
    ...(typeof rec.modelVersion === 'string' ? { modelVersion: rec.modelVersion } : {}),
    ...(typeof rec.prompt === 'string' ? { prompt: rec.prompt } : {}),
    ...(typeof rec.negativePrompt === 'string' ? { negativePrompt: rec.negativePrompt } : {}),
    ...(typeof rec.seed === 'number' ? { seed: rec.seed } : {}),
    ...(rec.params && typeof rec.params === 'object' ? { params: rec.params as Record<string, unknown> } : {}),
    ...(typeof rec.vendorRequestId === 'string' ? { vendorRequestId: rec.vendorRequestId } : {}),
    ...(typeof rec.agentRunId === 'string' ? { agentRunId: rec.agentRunId } : {}),
  }
}
