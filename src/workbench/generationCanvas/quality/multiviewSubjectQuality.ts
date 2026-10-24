import { translateCapabilityWorkflowText } from '../../../i18n/capabilityWorkflowText'
import i18n from '../../../i18n/index'
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
      label: i18n.t('capabilityWorkflow.semanticIdentityConsistency'),
      status: 'unavailable',
      summary,
      ...(details?.length ? { details } : {}),
    },
    {
      id: 'subject-geometry-consistency',
      label: i18n.t('capabilityWorkflow.subjectGeometryConsistency'),
      status: 'unavailable',
      summary,
      ...(details?.length ? { details } : {}),
    },
    {
      id: 'requested-camera-adherence',
      label: i18n.t('capabilityWorkflow.cameraAdherence'),
      status: 'unavailable',
      summary,
      ...(details?.length ? { details } : {}),
    },
    {
      id: 'background-policy-compliance',
      label: i18n.t('capabilityWorkflow.backgroundStrategyAdherence'),
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
  if (!entry.item.result || !readableImage(entry.item.result)) return entry.item.error || i18n.t('capabilityWorkflow.noReadableImageResult')
  if (!entry.comparison) return i18n.t('capabilityWorkflow.theComparatorReturnedNoResultForThisView')
  if (!entry.comparison.outputSubjectDetected) return i18n.t('capabilityWorkflow.noComparableSubjectDetected')
  if (field === 'sameSubject') return i18n.t('capabilityWorkflow.theComparatorReturnedNoIdentityVerdict')
  if (field === 'geometryConsistent') return i18n.t('capabilityWorkflow.theComparatorReturnedNoGeometryVerdict')
  if (field === 'cameraMatches') return i18n.t('capabilityWorkflow.theComparatorReturnedNoCameraVerdict')
  return i18n.t('capabilityWorkflow.theComparatorReturnedNoBackgroundStrategyVerdict')
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
    `${translateCapabilityWorkflowText(item.label)}：${comparison?.detail || i18n.t('capabilityWorkflow.didNotMeetTheComparatorThreshold', { v0: translateCapabilityWorkflowText(input.label) })}`
  ))
  const unavailableDetails = unavailable.map((entry) => (
    `${translateCapabilityWorkflowText(entry.item.label)}：${unavailableReason(entry, input.field)}`
  ))

  if (failed.length > 0) {
    return {
      id: input.id,
      label: input.label,
      status: 'fail',
      summary: i18n.t('capabilityWorkflow.viewsFailed', { v0: failed.length, v1: translateCapabilityWorkflowText(input.label) }),
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
      summary: i18n.t('capabilityWorkflow.noComparableViewsCannotVerify', { v0: translateCapabilityWorkflowText(input.label) }),
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
      summary: i18n.t('capabilityWorkflow.viewsCompletedVerification', { v0: comparable.length, v1: input.expected.length, v2: translateCapabilityWorkflowText(input.label) }),
      itemIds: unavailable.map(({ item }) => item.id),
      details: unavailableDetails,
      metrics,
    }
  }
  return {
    id: input.id,
    label: input.label,
    status: 'pass',
    summary: i18n.t('capabilityWorkflow.viewsPassedTheComparison', { v0: comparable.length, v1: translateCapabilityWorkflowText(input.label) }),
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
      checks: unavailableChecks(i18n.t('capabilityWorkflow.noReadableSourceImageSubjectIdentityAndGeometryCannot')),
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
      checks: unavailableChecks(i18n.t('capabilityWorkflow.noReadableMultiviewOutputsSubjectIdentityAndGeometryCannot')),
      comparatorAvailable: false,
    }
  }
  if (!input.compareSubjects) {
    return {
      checks: unavailableChecks(
        i18n.t('capabilityWorkflow.noMultiviewSemanticComparatorIsAvailablePixelProxiesCannot'),
        [i18n.t('capabilityWorkflow.resultsAreRetainedAnAuditableVisualSemanticComparatorOr')],
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
      checks: unavailableChecks(i18n.t('capabilityWorkflow.theMultiviewSemanticComparatorFailedIdentityAndGeometryRemain'), [message]),
      comparatorAvailable: false,
    }
  }

  const evaluator = typeof comparison.evaluator === 'string' && comparison.evaluator.trim()
    ? comparison.evaluator.trim()
    : 'multiview-subject-comparator'
  if (!comparison.sourceSubjectDetected) {
    return {
      checks: unavailableChecks(i18n.t('capabilityWorkflow.noComparableSubjectWasDetectedInTheSourceImage')),
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
    label: i18n.t('capabilityWorkflow.semanticIdentityConsistency'),
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
    label: i18n.t('capabilityWorkflow.subjectGeometryConsistency'),
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
    label: i18n.t('capabilityWorkflow.cameraAdherence'),
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
    label: i18n.t('capabilityWorkflow.backgroundStrategyAdherence'),
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
