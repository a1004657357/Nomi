import i18n from '../../../i18n/index'
import type {
  GenerationNodeResult,
  GenerationQualityCheck,
  GenerationQualityReport,
  GenerationQualityStatus,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import type { CapabilityRecipeImageInspection } from '../runner/capabilityRecipePostprocess'
import type { CapabilityRecipeImageInspector } from './capabilityQualityTypes'
import {
  hasMediaLocator,
  normalizedColorDistance,
  normalizedPerceptualHashDistance,
  qualityStatusFromChecks,
  roundQualityMetric,
} from './capabilityQualityUtils'

type InspectionOutcome = {
  inspection?: CapabilityRecipeImageInspection
  error?: string
}

async function inspectSafely(
  result: GenerationNodeResult | undefined,
  inspectImage: CapabilityRecipeImageInspector | undefined,
): Promise<InspectionOutcome> {
  if (!result || result.type !== 'image' || !hasMediaLocator(result)) {
    return { error: i18n.t('capabilityWorkflow.theImageResultHasNoReadableAssetAddress') }
  }
  if (!inspectImage) return { error: i18n.t('capabilityWorkflow.noPixelInspectorIsAvailableInThisEnvironment') }
  try {
    return { inspection: await inspectImage(result) }
  } catch (error) {
    return { error: error instanceof Error && error.message ? error.message : String(error) }
  }
}

function visualSignatureDistance(
  left: CapabilityRecipeImageInspection,
  right: CapabilityRecipeImageInspection,
): number {
  return normalizedColorDistance(left.averageRgb, right.averageRgb) * 0.55
    + Math.abs(left.meanLuma - right.meanLuma) * 0.15
    + Math.abs(left.lumaStdDev - right.lumaStdDev) * 0.15
    + Math.abs(left.edgeEnergy - right.edgeEnergy) * 0.15
}

function imageContentCheck(
  itemId: string | undefined,
  output: InspectionOutcome,
): GenerationQualityCheck {
  if (!output.inspection) {
    return {
      id: 'style-image-content',
      label: i18n.t('capabilityWorkflow.imageValidity'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.theStylizedResultIsRetainedButItsPixelsCannot'),
      details: output.error ? [output.error] : undefined,
      ...(itemId ? { itemIds: [itemId] } : {}),
    }
  }
  const inspection = output.inspection
  const blank = inspection.opaqueRatio < 0.65
    || (inspection.lumaStdDev < 0.012 && inspection.edgeEnergy < 0.008)
  return {
    id: 'style-image-content',
    label: i18n.t('capabilityWorkflow.imageValidity'),
    status: blank ? 'fail' : 'pass',
    summary: blank
      ? i18n.t('capabilityWorkflow.theOutputIsTransparentBlankOrLowInformation')
      : i18n.t('capabilityWorkflow.theOutputContainsValidPixelsAndVisibleDetail'),
    metrics: {
      opaqueRatio: roundQualityMetric(inspection.opaqueRatio),
      lumaStdDev: roundQualityMetric(inspection.lumaStdDev),
      edgeEnergy: roundQualityMetric(inspection.edgeEnergy),
    },
    ...(blank && itemId ? { itemIds: [itemId] } : {}),
  }
}

function aspectRetentionCheck(
  itemId: string | undefined,
  source: InspectionOutcome,
  output: InspectionOutcome,
): GenerationQualityCheck {
  if (!source.inspection || !output.inspection) {
    return {
      id: 'style-aspect-retention',
      label: i18n.t('capabilityWorkflow.aspectRatioRetention'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.sourceOrOutputDimensionsAreMissingAspectRatiosCannot'),
      details: [source.error, output.error].filter((detail): detail is string => Boolean(detail)),
      ...(itemId ? { itemIds: [itemId] } : {}),
    }
  }
  const sourceRatio = source.inspection.width / Math.max(1, source.inspection.height)
  const outputRatio = output.inspection.width / Math.max(1, output.inspection.height)
  const relativeError = Math.abs(outputRatio - sourceRatio) / Math.max(Number.EPSILON, sourceRatio)
  const status: GenerationQualityStatus = relativeError <= 0.03
    ? 'pass'
    : relativeError <= 0.1
      ? 'warning'
      : 'fail'
  return {
    id: 'style-aspect-retention',
    label: i18n.t('capabilityWorkflow.aspectRatioRetention'),
    status,
    summary: status === 'pass'
      ? i18n.t('capabilityWorkflow.theResultRetainsTheSourceAspectRatio')
      : i18n.t('capabilityWorkflow.theResultAspectRatioDiffersFromTheSourceBy', { v0: Math.round(relativeError * 100) }),
    metrics: {
      sourceAspectRatio: roundQualityMetric(sourceRatio, 4),
      outputAspectRatio: roundQualityMetric(outputRatio, 4),
      relativeError: roundQualityMetric(relativeError, 4),
    },
    ...(status !== 'pass' && itemId ? { itemIds: [itemId] } : {}),
  }
}

function contentRetentionCheck(
  itemId: string | undefined,
  source: InspectionOutcome,
  output: InspectionOutcome,
): GenerationQualityCheck {
  const sourceHash = source.inspection?.centerRegion?.perceptualHash
    || source.inspection?.perceptualHash
  const outputHash = output.inspection?.centerRegion?.perceptualHash
    || output.inspection?.perceptualHash
  if (!sourceHash || !outputHash) {
    return {
      id: 'style-content-retention',
      label: i18n.t('capabilityWorkflow.contentRetentionProxy'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.noComparableCenterRegionPixelSignatures'),
      details: [source.error, output.error].filter((detail): detail is string => Boolean(detail)),
      ...(itemId ? { itemIds: [itemId] } : {}),
    }
  }
  const distance = normalizedPerceptualHashDistance(sourceHash, outputHash)
  const status: GenerationQualityStatus = distance <= 0.35
    ? 'pass'
    : distance <= 0.55
      ? 'warning'
      : 'fail'
  return {
    id: 'style-content-retention',
    label: i18n.t('capabilityWorkflow.contentRetentionProxy'),
    status,
    summary: status === 'pass'
      ? i18n.t('capabilityWorkflow.theCenterRegionStructureRemainsCloseToTheSource')
      : status === 'warning'
        ? i18n.t('capabilityWorkflow.theCenterRegionStructureChangedSubstantiallyCheckTheSubject')
        : i18n.t('capabilityWorkflow.theCenterRegionStructureDivergedSeverelyTheSubjectOr'),
    details: [i18n.t('capabilityWorkflow.thisPixelStructureProxyIsNotSemanticOrFace')],
    metrics: { normalizedHashDistance: roundQualityMetric(distance, 4) },
    ...(status !== 'pass' && itemId ? { itemIds: [itemId] } : {}),
  }
}

function styleMovementCheck(
  itemId: string | undefined,
  source: InspectionOutcome,
  output: InspectionOutcome,
  references: InspectionOutcome[],
  referenceCount: number,
): GenerationQualityCheck {
  const inspectedReferences = references.flatMap((entry) => entry.inspection ? [entry.inspection] : [])
  if (!source.inspection || !output.inspection || inspectedReferences.length === 0) {
    return {
      id: 'style-transfer-proxy',
      label: i18n.t('capabilityWorkflow.styleTransferProxy'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.noReadableSourceResultOrStyleReferenceImage'),
      details: [
        source.error,
        output.error,
        ...references.flatMap((entry) => entry.error ? [entry.error] : []),
        i18n.t('capabilityWorkflow.textOnlyStyleConstraintsCannotBeVerifiedByA'),
      ].filter((detail): detail is string => Boolean(detail)),
      metrics: {
        referenceCount,
        inspectedReferenceCount: inspectedReferences.length,
      },
      ...(itemId ? { itemIds: [itemId] } : {}),
    }
  }

  const candidates = inspectedReferences.map((reference) => {
    const sourceToReference = visualSignatureDistance(source.inspection!, reference)
    const outputToReference = visualSignatureDistance(output.inspection!, reference)
    const progress = sourceToReference > 0.03
      ? 1 - outputToReference / sourceToReference
      : Number.NEGATIVE_INFINITY
    return { sourceToReference, outputToReference, progress }
  })
  const comparable = candidates.filter((candidate) => Number.isFinite(candidate.progress))
  if (comparable.length === 0) {
    return {
      id: 'style-transfer-proxy',
      label: i18n.t('capabilityWorkflow.styleTransferProxy'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.theStyleReferenceAndSourceHaveNearlyIdenticalLocal'),
      metrics: {
        referenceCount,
        inspectedReferenceCount: inspectedReferences.length,
      },
      ...(itemId ? { itemIds: [itemId] } : {}),
    }
  }

  const best = comparable.reduce((current, candidate) => (
    candidate.progress > current.progress ? candidate : current
  ))
  const sourceToOutput = visualSignatureDistance(source.inspection, output.inspection)
  const noVisibleChange = sourceToOutput <= 0.015
  const status: GenerationQualityStatus = !noVisibleChange && best.progress >= 0.2
    ? 'pass'
    : 'warning'
  return {
    id: 'style-transfer-proxy',
    label: i18n.t('capabilityWorkflow.styleTransferProxy'),
    status,
    summary: status === 'pass'
      ? i18n.t('capabilityWorkflow.theResultVisualSignatureMovedApproximatelyTowardTheStyle', { v0: Math.round(best.progress * 100) })
      : noVisibleChange
        ? i18n.t('capabilityWorkflow.theResultHasAlmostNoMeasurableVisualChangeFrom')
        : i18n.t('capabilityWorkflow.theResultDidNotClearlyMoveTowardTheStyle'),
    details: [i18n.t('capabilityWorkflow.thisCheckComparesColorBrightnessLocalContrastAndEdge')],
    metrics: {
      referenceCount,
      inspectedReferenceCount: inspectedReferences.length,
      sourceToOutputDistance: roundQualityMetric(sourceToOutput, 4),
      sourceToReferenceDistance: roundQualityMetric(best.sourceToReference, 4),
      outputToReferenceDistance: roundQualityMetric(best.outputToReference, 4),
      styleProgress: roundQualityMetric(best.progress, 4),
    },
    ...(status !== 'pass' && itemId ? { itemIds: [itemId] } : {}),
  }
}

export async function evaluateStyleTransferCollection({
  collection,
  sourceResult,
  styleReferenceResults = [],
  inspectImage,
  evaluatedAt = Date.now(),
}: {
  collection: GenerationResultCollection
  sourceResult?: GenerationNodeResult
  styleReferenceResults?: GenerationNodeResult[]
  inspectImage?: CapabilityRecipeImageInspector
  evaluatedAt?: number
}): Promise<GenerationResultCollection> {
  const item = collection.items[0]
  const result = item?.status === 'success'
    && item.result?.type === 'image'
    && hasMediaLocator(item.result)
    ? item.result
    : undefined
  const [source, output, ...references] = await Promise.all([
    inspectSafely(sourceResult?.type === 'image' ? sourceResult : undefined, inspectImage),
    inspectSafely(result, inspectImage),
    ...styleReferenceResults.map((reference) => inspectSafely(
      reference.type === 'image' ? reference : undefined,
      inspectImage,
    )),
  ])
  const checks: GenerationQualityCheck[] = [
    result
      ? {
          id: 'style-output',
          label: i18n.t('capabilityWorkflow.stylizedResult'),
          status: 'pass',
          summary: i18n.t('capabilityWorkflow.aReadableStylizedImageResultIsRetained'),
        }
      : {
          id: 'style-output',
          label: i18n.t('capabilityWorkflow.stylizedResult'),
          status: 'fail',
          summary: item?.error || i18n.t('capabilityWorkflow.noReadableStylizedImageResult'),
          ...(item ? { itemIds: [item.id] } : {}),
        },
    imageContentCheck(item?.id, output),
    aspectRetentionCheck(item?.id, source, output),
    contentRetentionCheck(item?.id, source, output),
    styleMovementCheck(item?.id, source, output, references, styleReferenceResults.length),
  ]
  const quality: GenerationQualityReport = {
    version: 1,
    kind: 'style',
    evaluator: 'style-transfer-local-v1',
    status: qualityStatusFromChecks(checks),
    evaluatedAt,
    checks,
    metrics: {
      inspectedSource: Boolean(source.inspection),
      inspectedOutput: Boolean(output.inspection),
      referenceCount: styleReferenceResults.length,
      inspectedReferenceCount: references.filter((entry) => entry.inspection).length,
    },
  }
  return { ...collection, quality }
}
