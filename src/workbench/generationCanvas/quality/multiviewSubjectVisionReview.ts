import i18n from '../../../i18n'
import { zhCapabilityWorkflow } from '../../../i18n/locales/capabilityWorkflow'
import type {
  GenerationNodeResult,
  GenerationQualityCheck,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import { qualityStatusFromChecks } from './capabilityQualityUtils'
import type {
  MultiviewSubjectComparator,
  MultiviewSubjectComparatorInput,
  MultiviewSubjectComparatorOutput,
  MultiviewSubjectQualityResult,
} from './multiviewSubjectQuality'

export type MultiviewVisionReviewImage = {
  role: 'source' | 'output'
  itemId: string
  label: string
  result: GenerationNodeResult
  azimuth?: number
  elevation?: number
  shotSize?: string
}

export type MultiviewVisionJudgeRequest = {
  prompt: string
  images: MultiviewVisionReviewImage[]
}

export type MultiviewVisionJudge = (
  request: MultiviewVisionJudgeRequest,
) => Promise<string>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function parseStructuredJson(text: string): unknown {
  const clean = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(clean)?.[1]?.trim()
  const candidates = [fenced, clean].filter((candidate): candidate is string => Boolean(candidate))
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      const start = candidate.indexOf('{')
      const end = candidate.lastIndexOf('}')
      if (start < 0 || end <= start) continue
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        // Try the next candidate.
      }
    }
  }
  throw new Error(i18n.t('capabilityWorkflow.theVisualReviewDidNotReturnValidJSON'))
}

function parseComparisonOutput(
  value: unknown,
  allowedItemIds: ReadonlySet<string>,
): {
  sourceSubjectDetected: boolean
  items: MultiviewSubjectComparatorOutput[]
} {
  const root = asRecord(value)
  if (!root || typeof root.sourceSubjectDetected !== 'boolean' || !Array.isArray(root.items)) {
    throw new Error(i18n.t('capabilityWorkflow.theVisualReviewJSONIsMissingSourceSubjectDetectedOrItems'))
  }
  const seen = new Set<string>()
  const items = root.items.flatMap((raw): MultiviewSubjectComparatorOutput[] => {
    const item = asRecord(raw)
    const itemId = typeof item?.itemId === 'string' ? item.itemId.trim() : ''
    if (
      !item
      || !itemId
      || !allowedItemIds.has(itemId)
      || seen.has(itemId)
      || typeof item.outputSubjectDetected !== 'boolean'
    ) {
      return []
    }
    seen.add(itemId)
    return [{
      itemId,
      outputSubjectDetected: item.outputSubjectDetected,
      ...(typeof item.sameSubject === 'boolean' ? { sameSubject: item.sameSubject } : {}),
      ...(validScore(item.identityScore) ? { identityScore: item.identityScore } : {}),
      ...(typeof item.geometryConsistent === 'boolean'
        ? { geometryConsistent: item.geometryConsistent }
        : {}),
      ...(validScore(item.geometryScore) ? { geometryScore: item.geometryScore } : {}),
      ...(typeof item.cameraMatches === 'boolean' ? { cameraMatches: item.cameraMatches } : {}),
      ...(validScore(item.cameraScore) ? { cameraScore: item.cameraScore } : {}),
      ...(typeof item.backgroundCompliant === 'boolean'
        ? { backgroundCompliant: item.backgroundCompliant }
        : {}),
      ...(validScore(item.backgroundScore) ? { backgroundScore: item.backgroundScore } : {}),
      ...(typeof item.detail === 'string' && item.detail.trim()
        ? { detail: item.detail.trim().slice(0, 500) }
        : {}),
    }]
  })
  return { sourceSubjectDetected: root.sourceSubjectDetected, items }
}

function outputDescription(
  output: MultiviewSubjectComparatorInput['outputs'][number],
  index: number,
): string {
  const camera = [
    typeof output.azimuth === 'number' ? `方位角 ${output.azimuth}°` : '',
    typeof output.elevation === 'number' ? `俯仰角 ${output.elevation}°` : '',
    output.shotSize ? `景别 ${output.shotSize}` : '',
  ].filter(Boolean).join('，')
  // Fixed judge-protocol text, not display copy; do not translate with the UI locale.
  const promptLine = `图 ${index + 2}：itemId="${output.itemId}"，${output.label}${camera ? `，${camera}` : ''}`
  return promptLine
}

function buildVisionReviewPrompt(input: MultiviewSubjectComparatorInput): string {
  const imageMap = [
    '图 1：来源主体，作为身份与几何基准。',
    ...input.outputs.map(outputDescription),
  ]
  return [
    '你正在复核一组由同一来源图生成的多视角图片。',
    '一次性比较全部附件，不要只判断画风或背景。',
    '身份一致性：判断是否仍为来源中的同一个人物、物体或角色。',
    '几何一致性：判断主体的稳定形状、比例、部件数量和部件关系是否一致；相机角度和可见面变化不算几何错误。',
    '实际机位：逐张判断画面是否真正符合该图标注的方位角、俯仰角和景别；画面彼此不同不能替代机位正确。',
    input.backgroundPolicy === 'neutral_turntable'
      ? '背景策略：结果应使用跨机位一致的中性转台或影棚背景，不保留来源场景。'
      : '背景策略：结果应保留来源图的真实场景语义、光线与物体关系；替换成白底、纯色、透明或影棚背景必须判定不符合。',
    '看不清或证据不足时不要猜，省略对应的布尔字段。',
    '',
    '附件顺序：',
    ...imageMap,
    '',
    '只返回一个 JSON 对象，不要 Markdown、解释或额外文字：',
    '{',
    '  "sourceSubjectDetected": true,',
    '  "items": [',
    '    {',
    '      "itemId": "必须原样使用上面的 itemId",',
    '      "outputSubjectDetected": true,',
    '      "sameSubject": true,',
    '      "identityScore": 0.0,',
    '      "geometryConsistent": true,',
    '      "geometryScore": 0.0,',
    '      "cameraMatches": true,',
    '      "cameraScore": 0.0,',
    '      "backgroundCompliant": true,',
    '      "backgroundScore": 0.0,',
    '      "detail": "简短、可核查的差异"',
    '    }',
    '  ]',
    '}',
    '分数范围必须为 0 到 1。每个输出机位最多返回一次。',
  ].join('\n')
}

export function createMultiviewSubjectVisionComparator(input: {
  evaluator: string
  judge: MultiviewVisionJudge
}): MultiviewSubjectComparator {
  return async (comparisonInput) => {
    const images: MultiviewVisionReviewImage[] = [
      {
        role: 'source',
        itemId: 'source',
        label: zhCapabilityWorkflow.sourceSubject,
        result: comparisonInput.source,
      },
      ...comparisonInput.outputs.map((output) => ({
        role: 'output' as const,
        ...output,
      })),
    ]
    const text = await input.judge({
      prompt: buildVisionReviewPrompt(comparisonInput),
      images,
    })
    const allowedItemIds = new Set(comparisonInput.outputs.map((output) => output.itemId))
    const parsed = parseComparisonOutput(parseStructuredJson(text), allowedItemIds)
    return {
      evaluator: input.evaluator,
      sourceSubjectDetected: parsed.sourceSubjectDetected,
      items: parsed.items,
    }
  }
}

const SEMANTIC_CHECK_IDS = new Set([
  'subject-semantic-identity',
  'subject-geometry-consistency',
  'requested-camera-adherence',
  'background-policy-compliance',
])

function replaceSemanticChecks(
  current: readonly GenerationQualityCheck[],
  next: readonly GenerationQualityCheck[],
): GenerationQualityCheck[] {
  const nextById = new Map(next.map((check) => [check.id, check]))
  const replaced = current.map((check) => nextById.get(check.id) ?? check)
  const currentIds = new Set(current.map((check) => check.id))
  return [
    ...replaced,
    ...next.filter((check) => SEMANTIC_CHECK_IDS.has(check.id) && !currentIds.has(check.id)),
  ]
}

export function mergeMultiviewSubjectVisionReview(
  collection: GenerationResultCollection,
  semantic: MultiviewSubjectQualityResult,
  options: {
    evaluatedAt: number
    requestedEvaluator?: string
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  },
): GenerationResultCollection {
  const quality = collection.quality
  if (!quality || (quality.kind !== 'grid9' && quality.kind !== 'multiview')) {
    throw new Error(i18n.t('capabilityWorkflow.theCurrentResultIsNotAReviewableMultiviewQuality'))
  }
  const checks = replaceSemanticChecks(quality.checks, semantic.checks)
  const evaluator = semantic.evaluator || options.requestedEvaluator
  return {
    ...collection,
    quality: {
      ...quality,
      status: qualityStatusFromChecks(checks),
      evaluatedAt: options.evaluatedAt,
      checks,
      metrics: {
        ...(quality.metrics ?? {}),
        semanticComparatorAvailable: semantic.comparatorAvailable,
        ...(evaluator ? { semanticComparatorEvaluator: evaluator } : {}),
        ...(typeof options.promptTokens === 'number'
          ? { semanticReviewPromptTokens: options.promptTokens }
          : {}),
        ...(typeof options.completionTokens === 'number'
          ? { semanticReviewCompletionTokens: options.completionTokens }
          : {}),
        ...(typeof options.totalTokens === 'number'
          ? { semanticReviewTotalTokens: options.totalTokens }
          : {}),
      },
    },
  }
}
