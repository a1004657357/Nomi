import type {
  GenerationNodeResult,
  GenerationQualityCheck,
  GenerationResultCollection,
  GenerationResultCollectionItem,
} from '../model/generationCanvasTypes'
import { hasMediaLocator, roundQualityMetric } from './capabilityQualityUtils'

export type MultiviewSubjectComparatorOutput = {
  itemId: string
  outputSubjectDetected: boolean
  sameSubject?: boolean
  identityScore?: number
  geometryConsistent?: boolean
  geometryScore?: number
  cameraMatches?: boolean
  cameraScore?: number
  backgroundCompliant?: boolean
  backgroundScore?: number
  detail?: string
}

export type MultiviewSubjectComparison = {
  evaluator: string
  sourceSubjectDetected: boolean
  items: MultiviewSubjectComparatorOutput[]
}

export type MultiviewSubjectComparatorInput = {
  source: GenerationNodeResult
  outputs: Array<{
    itemId: string
    label: string
    result: GenerationNodeResult
    azimuth?: number
    elevation?: number
    shotSize?: string
  }>
  backgroundPolicy?: 'preserve_scene' | 'neutral_turntable'
}

export type MultiviewSubjectComparator = (
  input: MultiviewSubjectComparatorInput,
) => Promise<MultiviewSubjectComparison>

type SemanticField = 'sameSubject' | 'geometryConsistent' | 'cameraMatches' | 'backgroundCompliant'
type ScoreField = 'identityScore' | 'geometryScore' | 'cameraScore' | 'backgroundScore'

type ExpectedComparison = {
  item: GenerationResultCollectionItem
  comparison?: MultiviewSubjectComparatorOutput
}

export type MultiviewSubjectQualityResult = {
  checks: GenerationQualityCheck[]
  comparatorAvailable: boolean
  evaluator?: string
}

function readableImage(result: GenerationNodeResult | undefined): result is GenerationNodeResult {
  return Boolean(result?.type === 'image' && hasMediaLocator(result))
}

function unavailableChecks(summary: string, details?: string[]): MultiviewSubjectQualityResult['checks'] {
  return [
    {
      id: 'subject-semantic-identity',
      label: '语义身份一致性',
      status: 'unavailable',
      summary,
      ...(details?.length ? { details } : {}),
    },
    {
      id: 'subject-geometry-consistency',
      label: '主体几何一致性',
      status: 'unavailable',
      summary,
      ...(details?.length ? { details } : {}),
    },
    {
      id: 'requested-camera-adherence',
      label: '实际机位遵循',
      status: 'unavailable',
      summary,
      ...(details?.length ? { details } : {}),
    },
    {
      id: 'background-policy-compliance',
      label: '背景策略遵循',
      status: 'unavailable',
      summary,
      ...(details?.length ? { details } : {}),
    },
  ]
}

function validScore(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function unavailableReason(
  entry: ExpectedComparison,
  field: SemanticField,
): string {
  if (!entry.item.result || !readableImage(entry.item.result)) return entry.item.error || '没有可读取的图片结果'
  if (!entry.comparison) return '比较器未返回该机位'
  if (!entry.comparison.outputSubjectDetected) return '未检测到可比较主体'
  if (field === 'sameSubject') return '比较器未返回身份结论'
  if (field === 'geometryConsistent') return '比较器未返回几何结论'
  if (field === 'cameraMatches') return '比较器未返回机位结论'
  return '比较器未返回背景策略结论'
}

function semanticCheck(input: {
  expected: readonly ExpectedComparison[]
  field: SemanticField
  scoreField: ScoreField
  id: string
  label: string
  comparedMetric: string
  failedMetric: string
  unavailableMetric: string
  minimumMetric: string
}): GenerationQualityCheck {
  const comparable = input.expected.filter(({ comparison }) => (
    comparison?.outputSubjectDetected === true && typeof comparison[input.field] === 'boolean'
  ))
  const failed = comparable.filter(({ comparison }) => comparison?.[input.field] === false)
  const unavailable = input.expected.filter((entry) => !comparable.includes(entry))
  const scores = comparable.flatMap(({ comparison }) => {
    const score = comparison?.[input.scoreField]
    return validScore(score) ? [score] : []
  })
  const metrics: Record<string, number> = {
    [input.comparedMetric]: comparable.length,
    [input.failedMetric]: failed.length,
    [input.unavailableMetric]: unavailable.length,
    ...(scores.length ? { [input.minimumMetric]: roundQualityMetric(Math.min(...scores)) } : {}),
  }
  const failedDetails = failed.map(({ item, comparison }) => (
    `${item.label}：${comparison?.detail || `${input.label}未通过比较器阈值`}`
  ))
  const unavailableDetails = unavailable.map((entry) => (
    `${entry.item.label}：${unavailableReason(entry, input.field)}`
  ))

  if (failed.length > 0) {
    return {
      id: input.id,
      label: input.label,
      status: 'fail',
      summary: `${failed.length} 个机位的${input.label}未通过`,
      itemIds: failed.map(({ item }) => item.id),
      details: [...failedDetails, ...unavailableDetails],
      metrics,
    }
  }
  if (comparable.length === 0) {
    return {
      id: input.id,
      label: input.label,
      status: 'unavailable',
      summary: `没有可比较机位，无法验证${input.label}`,
      itemIds: unavailable.map(({ item }) => item.id),
      details: unavailableDetails,
      metrics,
    }
  }
  if (unavailable.length > 0) {
    return {
      id: input.id,
      label: input.label,
      status: 'warning',
      summary: `${comparable.length}/${input.expected.length} 个机位完成${input.label}验证`,
      itemIds: unavailable.map(({ item }) => item.id),
      details: unavailableDetails,
      metrics,
    }
  }
  return {
    id: input.id,
    label: input.label,
    status: 'pass',
    summary: `${comparable.length} 个机位通过${input.label}比较`,
    metrics,
  }
}

export async function evaluateMultiviewSubjectQuality(input: {
  sourceResult?: GenerationNodeResult
  collection: GenerationResultCollection
  compareSubjects?: MultiviewSubjectComparator
  backgroundPolicy?: 'preserve_scene' | 'neutral_turntable'
}): Promise<MultiviewSubjectQualityResult> {
  if (!readableImage(input.sourceResult)) {
    return {
      checks: unavailableChecks('缺少可读取的来源图片，无法验证主体身份或几何一致性'),
      comparatorAvailable: false,
    }
  }

  const outputs = input.collection.items.flatMap((item) => (
    item.status === 'success' && readableImage(item.result)
      ? [{
          itemId: item.id,
          label: item.label,
          result: item.result,
          ...(typeof item.azimuth === 'number' ? { azimuth: item.azimuth } : {}),
          ...(typeof item.elevation === 'number' ? { elevation: item.elevation } : {}),
          ...(typeof item.shotSize === 'string' ? { shotSize: item.shotSize } : {}),
        }]
      : []
  ))
  if (outputs.length === 0) {
    return {
      checks: unavailableChecks('没有可读取的多视角输出，无法验证主体身份或几何一致性'),
      comparatorAvailable: false,
    }
  }
  if (!input.compareSubjects) {
    return {
      checks: unavailableChecks(
        '当前没有多视角语义比较器，像素代理不能证明主体身份或三维几何一致',
        ['结果已保留；需接入可审计的视觉语义比较器或人工评审后才能给出结论。'],
      ),
      comparatorAvailable: false,
    }
  }

  let comparison: MultiviewSubjectComparison
  try {
    comparison = await input.compareSubjects({
      source: input.sourceResult,
      outputs,
      backgroundPolicy: input.backgroundPolicy,
    })
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error)
    return {
      checks: unavailableChecks('多视角语义比较器执行失败，身份与几何均未验证', [message]),
      comparatorAvailable: false,
    }
  }

  const evaluator = typeof comparison.evaluator === 'string' && comparison.evaluator.trim()
    ? comparison.evaluator.trim()
    : 'multiview-subject-comparator'
  if (!comparison.sourceSubjectDetected) {
    return {
      checks: unavailableChecks('来源图片未检测到可比较主体，身份与几何均未验证'),
      comparatorAvailable: true,
      evaluator,
    }
  }

  const expectedIds = new Set(input.collection.items.map((item) => item.id))
  const byItemId = new Map<string, MultiviewSubjectComparatorOutput>()
  for (const item of Array.isArray(comparison.items) ? comparison.items : []) {
    if (!expectedIds.has(item.itemId) || byItemId.has(item.itemId)) continue
    byItemId.set(item.itemId, item)
  }
  const expected = input.collection.items.map((item) => ({
    item,
    comparison: byItemId.get(item.id),
  }))
  const identity = semanticCheck({
    expected,
    field: 'sameSubject',
    scoreField: 'identityScore',
    id: 'subject-semantic-identity',
    label: '语义身份一致性',
    comparedMetric: 'comparedSubjectCount',
    failedMetric: 'failedSubjectCount',
    unavailableMetric: 'unavailableSubjectCount',
    minimumMetric: 'minimumIdentityScore',
  })
  const geometry = semanticCheck({
    expected,
    field: 'geometryConsistent',
    scoreField: 'geometryScore',
    id: 'subject-geometry-consistency',
    label: '主体几何一致性',
    comparedMetric: 'comparedGeometryCount',
    failedMetric: 'failedGeometryCount',
    unavailableMetric: 'unavailableGeometryCount',
    minimumMetric: 'minimumGeometryScore',
  })
  const camera = semanticCheck({
    expected,
    field: 'cameraMatches',
    scoreField: 'cameraScore',
    id: 'requested-camera-adherence',
    label: '实际机位遵循',
    comparedMetric: 'comparedCameraCount',
    failedMetric: 'failedCameraCount',
    unavailableMetric: 'unavailableCameraCount',
    minimumMetric: 'minimumCameraScore',
  })
  const background = semanticCheck({
    expected,
    field: 'backgroundCompliant',
    scoreField: 'backgroundScore',
    id: 'background-policy-compliance',
    label: '背景策略遵循',
    comparedMetric: 'comparedBackgroundCount',
    failedMetric: 'failedBackgroundCount',
    unavailableMetric: 'unavailableBackgroundCount',
    minimumMetric: 'minimumBackgroundScore',
  })
  return {
    checks: [identity, geometry, camera, background],
    comparatorAvailable: true,
    evaluator,
  }
}
