import i18n from '../../../i18n'
import { zhCapabilityWorkflow } from '../../../i18n/locales/capabilityWorkflow'
import type {
  GenerationNodeResult,
  GenerationQualityCheck,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import { qualityStatusFromChecks } from './capabilityQualityUtils'
import type {
  MoodExpressionComparator,
  MoodExpressionComparatorOutput,
} from './portraitIdentityQuality'

export type MoodExpressionVisionReviewImage = {
  role: 'source' | 'output'
  itemId: string
  label: string
  result: GenerationNodeResult
}

export type MoodExpressionVisionJudgeRequest = {
  prompt: string
  images: MoodExpressionVisionReviewImage[]
}

export type MoodExpressionVisionJudge = (
  request: MoodExpressionVisionJudgeRequest,
) => Promise<string>

const MUSCLE_REGIONS = new Set(['brow', 'eyelid', 'cheek', 'mouth', 'jaw'])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseStructuredJson(text: string): unknown {
  const clean = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(clean)?.[1]?.trim()
  for (const candidate of [fenced, clean].filter((entry): entry is string => Boolean(entry))) {
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
  throw new Error(i18n.t('capabilityWorkflow.theExpressionVisualReviewDidNotReturnValidJSON'))
}

function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function parseItems(value: unknown, allowedIds: ReadonlySet<string>): MoodExpressionComparatorOutput[] {
  const root = asRecord(value)
  if (!root || !Array.isArray(root.items)) throw new Error(i18n.t('capabilityWorkflow.theExpressionVisualReviewJSONHasNoItems'))
  const seen = new Set<string>()
  return root.items.flatMap((raw): MoodExpressionComparatorOutput[] => {
    const item = asRecord(raw)
    const itemId = typeof item?.itemId === 'string' ? item.itemId.trim() : ''
    if (
      !item
      || !itemId
      || !allowedIds.has(itemId)
      || seen.has(itemId)
      || typeof item.faceDetected !== 'boolean'
    ) {
      return []
    }
    seen.add(itemId)
    const muscleRegions = Array.isArray(item.muscleRegions)
      ? Array.from(new Set(item.muscleRegions.flatMap((region) => (
          typeof region === 'string' && MUSCLE_REGIONS.has(region.trim())
            ? [region.trim()]
            : []
        ))))
      : undefined
    return [{
      itemId,
      faceDetected: item.faceDetected,
      ...(typeof item.targetMatches === 'boolean' ? { targetMatches: item.targetMatches } : {}),
      ...(validScore(item.targetScore) ? { targetScore: item.targetScore } : {}),
      ...(muscleRegions ? { muscleRegions } : {}),
      ...(typeof item.detail === 'string' && item.detail.trim()
        ? { detail: item.detail.trim().slice(0, 500) }
        : {}),
    }]
  })
}

function targetDescription(input: {
  itemId: string
  label: string
  energy: number
  affinity: number
}, index: number): string {
  // Fixed judge-protocol text, not display copy; do not translate with the UI locale.
  const promptLine = `图 ${index + 2}：itemId="${input.itemId}"，${input.label}，能量 ${input.energy}/4，亲和 ${input.affinity}/4`
  return promptLine
}

function buildPrompt(input: Parameters<MoodExpressionComparator>[0]): string {
  return [
    '你正在复核同一人物的一组情绪表演图片。',
    '图 1 是来源人像，只用于核对原始头部朝向、视线、身份和基准表情。',
    '逐张判断结果是否真正符合标注的能量与亲和坐标。',
    '必须观察 brow（眉部）、eyelid（眼睑）、cheek（脸颊）、mouth（嘴部）、jaw（下颌）五个区域。',
    'targetMatches=true 只在目标情绪成立且至少三个区域提供一致证据时使用。',
    '不能把视线偏移当作表情达标；如果主要变化只是看向别处、转头、换机位或改光线，必须判 false。',
    '看不清时省略 targetMatches，不要猜。',
    '',
    '附件顺序：',
    '图 1：来源人像。',
    ...input.outputs.map(targetDescription),
    '',
    '只返回一个 JSON 对象，不要 Markdown 或额外文字：',
    '{',
    '  "items": [',
    '    {',
    '      "itemId": "必须原样使用上面的 itemId",',
    '      "faceDetected": true,',
    '      "targetMatches": true,',
    '      "targetScore": 0.0,',
    '      "muscleRegions": ["brow", "eyelid", "cheek", "mouth", "jaw"],',
    '      "detail": "简短说明可见的肌肉证据或不匹配原因"',
    '    }',
    '  ]',
    '}',
    'targetScore 范围必须为 0 到 1。每个输出最多返回一次。',
  ].join('\n')
}

export function createMoodExpressionVisionComparator(input: {
  evaluator: string
  judge: MoodExpressionVisionJudge
}): MoodExpressionComparator {
  return async (comparisonInput) => {
    const images: MoodExpressionVisionReviewImage[] = [
      {
        role: 'source',
        itemId: 'source',
        label: zhCapabilityWorkflow.sourcePortrait,
        result: comparisonInput.source,
      },
      ...comparisonInput.outputs.map((output) => ({
        role: 'output' as const,
        itemId: output.itemId,
        label: output.label,
        result: output.result,
      })),
    ]
    const text = await input.judge({
      prompt: buildPrompt(comparisonInput),
      images,
    })
    return {
      evaluator: input.evaluator,
      items: parseItems(
        parseStructuredJson(text),
        new Set(comparisonInput.outputs.map((output) => output.itemId)),
      ),
    }
  }
}

export function mergeMoodExpressionVisionReview(
  collection: GenerationResultCollection,
  semanticCheck: GenerationQualityCheck,
  options: {
    evaluatedAt: number
    evaluator: string
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  },
): GenerationResultCollection {
  const quality = collection.quality
  if (!quality || quality.kind !== 'mood') {
    throw new Error(i18n.t('capabilityWorkflow.theCurrentResultIsNotAReviewableMoodQuality'))
  }
  const hasSemantic = quality.checks.some((check) => check.id === 'mood-expression-semantic')
  const checks = hasSemantic
    ? quality.checks.map((check) => (
        check.id === 'mood-expression-semantic' ? semanticCheck : check
      ))
    : [...quality.checks, semanticCheck]
  return {
    ...collection,
    quality: {
      ...quality,
      status: qualityStatusFromChecks(checks),
      evaluatedAt: options.evaluatedAt,
      checks,
      metrics: {
        ...(quality.metrics ?? {}),
        moodExpressionComparatorAvailable: true,
        moodExpressionComparatorEvaluator: options.evaluator,
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
