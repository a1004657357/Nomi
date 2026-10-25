import { translateCapabilityWorkflowText } from '../../../i18n/capabilityWorkflowText'
import i18n from '../../../i18n/index'
import type {
  GenerationQualityCheck,
  GenerationResultCollectionItem,
} from '../model/generationCanvasTypes'
import type { CapabilityRecipeImageInspection } from '../runner/capabilityRecipePostprocess'
import {
  normalizedColorDistance,
  normalizedPerceptualHashDistance,
  roundQualityMetric,
} from './capabilityQualityUtils'

type InspectedMultiviewItem = {
  item: GenerationResultCollectionItem
  inspection?: CapabilityRecipeImageInspection
  error?: string
}

type CenterRegion = NonNullable<CapabilityRecipeImageInspection['centerRegion']>

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0)
}

function symmetricRatio(value: number, baseline: number): number {
  const floor = 0.005
  return Math.max((value + floor) / (baseline + floor), (baseline + floor) / (value + floor))
}

function centerHashMedoid(
  entries: ReadonlyArray<InspectedMultiviewItem & { center: CenterRegion }>,
): CenterRegion {
  return entries.reduce((best, candidate) => {
    const distance = entries.reduce((sum, entry) => (
      sum + normalizedPerceptualHashDistance(candidate.center.perceptualHash, entry.center.perceptualHash)
    ), 0)
    return distance < best.distance ? { center: candidate.center, distance } : best
  }, { center: entries[0]!.center, distance: Number.POSITIVE_INFINITY }).center
}

function wholeImageFallback(
  available: ReadonlyArray<InspectedMultiviewItem & { inspection: CapabilityRecipeImageInspection }>,
): GenerationQualityCheck {
  const baseline: CapabilityRecipeImageInspection['averageRgb'] = [
    median(available.map((entry) => entry.inspection.averageRgb[0])),
    median(available.map((entry) => entry.inspection.averageRgb[1])),
    median(available.map((entry) => entry.inspection.averageRgb[2])),
  ]
  const outliers = available
    .map((entry) => ({
      entry,
      distance: normalizedColorDistance(entry.inspection.averageRgb, baseline),
    }))
    .filter(({ distance }) => distance > 0.38)
  const caveat = i18n.t('capabilityWorkflow.thisFallbackUsesWholeImageColorOnlyAndCannot')
  return {
    id: 'subject-continuity-proxy',
    label: i18n.t('capabilityWorkflow.subjectContinuityProxy'),
    status: outliers.length > 0 ? 'warning' : 'pass',
    summary: outliers.length > 0
      ? i18n.t('capabilityWorkflow.foundImagesWhoseColorDistributionsDifferSignificantlyFromThe', { v0: outliers.length })
      : i18n.t('capabilityWorkflow.noExtremeDriftInWholeImageColorDistributionsFound'),
    itemIds: outliers.length > 0 ? outliers.map(({ entry }) => entry.item.id) : undefined,
    details: [
      ...outliers.map(({ entry, distance }) => i18n.t('capabilityWorkflow.colorDeviation', { v0: translateCapabilityWorkflowText(entry.item.label), v1: roundQualityMetric(distance) })),
      caveat,
    ],
    metrics: {
      proxyMode: 'whole-image-color',
      visualOutlierCount: outliers.length,
      comparedViewCount: available.length,
    },
  }
}

export function evaluateMultiviewContinuityProxy(
  inspected: readonly InspectedMultiviewItem[],
): GenerationQualityCheck {
  const available = inspected.filter((entry): entry is InspectedMultiviewItem & {
    inspection: CapabilityRecipeImageInspection
  } => Boolean(entry.inspection))
  if (available.length < 2) {
    return {
      id: 'subject-continuity-proxy',
      label: i18n.t('capabilityWorkflow.subjectContinuityProxy'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.tooFewComparableImagesToCalculateContinuityProxyMetrics'),
    }
  }

  const centered = available.flatMap((entry) => (
    entry.inspection.centerRegion
      ? [{ ...entry, center: entry.inspection.centerRegion }]
      : []
  ))
  if (centered.length < 2) return wholeImageFallback(available)

  const medoid = centerHashMedoid(centered)
  const colorBaseline: CenterRegion['averageRgb'] = [
    median(centered.map((entry) => entry.center.averageRgb[0])),
    median(centered.map((entry) => entry.center.averageRgb[1])),
    median(centered.map((entry) => entry.center.averageRgb[2])),
  ]
  const edgeBaseline = median(centered.map((entry) => entry.center.edgeEnergy))
  const contrastBaseline = median(centered.map((entry) => entry.center.lumaStdDev))
  const candidates = centered.map((entry) => {
    const hashDistance = normalizedPerceptualHashDistance(
      entry.center.perceptualHash,
      medoid.perceptualHash,
    )
    const colorDistance = normalizedColorDistance(entry.center.averageRgb, colorBaseline)
    const edgeRatio = symmetricRatio(entry.center.edgeEnergy, edgeBaseline)
    const contrastRatio = symmetricRatio(entry.center.lumaStdDev, contrastBaseline)
    const signals: string[] = [
      hashDistance > 0.68 ? i18n.t('capabilityWorkflow.structure') : null,
      colorDistance > 0.36 ? i18n.t('capabilityWorkflow.color') : null,
      edgeRatio > 3 ? i18n.t('capabilityWorkflow.texture2') : null,
      contrastRatio > 3 ? i18n.t('capabilityWorkflow.contrast') : null,
    ].filter((signal) => signal !== null)
    return { entry, hashDistance, colorDistance, edgeRatio, contrastRatio, signals }
  })
  const outliers = candidates.filter((candidate) => candidate.signals.length >= 2)
  const caveat = i18n.t('capabilityWorkflow.thisCenterRegionProxyDetectsObviousDriftButCannot')
  return {
    id: 'subject-continuity-proxy',
    label: i18n.t('capabilityWorkflow.subjectContinuityProxy'),
    status: outliers.length > 0 || centered.length < available.length ? 'warning' : 'pass',
    summary: outliers.length > 0
      ? i18n.t('capabilityWorkflow.foundCentralSubjectsThatDeviateOnMultipleVisualSignals', { v0: outliers.length })
      : centered.length < available.length
        ? i18n.t('capabilityWorkflow.onlyImagesHaveComparableCenterRegions', { v0: centered.length, v1: available.length })
        : i18n.t('capabilityWorkflow.noObviousSimultaneousAnomaliesAcrossCenterSubjectSignals'),
    itemIds: outliers.length > 0 ? outliers.map(({ entry }) => entry.item.id) : undefined,
    details: [
      ...outliers.map(({ entry, signals, hashDistance, colorDistance, edgeRatio, contrastRatio }) => (
        [
          i18n.t('capabilityWorkflow.abnormalStructure', { v0: translateCapabilityWorkflowText(entry.item.label), v1: signals.join('、'), v2: roundQualityMetric(hashDistance) }),
          i18n.t('capabilityWorkflow.colorTextureRatio', { v0: roundQualityMetric(colorDistance), v1: roundQualityMetric(edgeRatio) }),
          i18n.t('capabilityWorkflow.contrastRatio', { v0: roundQualityMetric(contrastRatio) }),
        ].join('')
      )),
      caveat,
    ],
    metrics: {
      proxyMode: 'center-composite',
      visualOutlierCount: outliers.length,
      comparedViewCount: centered.length,
      missingCenterRegionCount: available.length - centered.length,
    },
  }
}
