import { translateCapabilityWorkflowText } from '../../../i18n/capabilityWorkflowText'
import i18n from '../../../i18n/index'
import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type {
  GenerationNodeResult,
  GenerationQualityCheck,
  GenerationQualityReport,
  GenerationQualityStatus,
  GenerationResultCollection,
  GenerationResultCollectionItem,
} from '../model/generationCanvasTypes'
import {
  evaluatePortraitIdentityQuality,
  type MoodExpressionComparator,
  type PortraitFaceComparator,
} from '../quality/portraitIdentityQuality'
import type {
  CapabilityRecipeImageInspector,
  CapabilityRecipeVideoInspector,
} from '../quality/capabilityQualityTypes'
import {
  hasMediaLocator,
  normalizedColorDistance,
  normalizedPerceptualHashDistance,
  qualityStatusFromChecks as statusFromChecks,
  roundQualityMetric as round,
} from '../quality/capabilityQualityUtils'
import { evaluateCustomViewCollection } from '../quality/customViewQuality'
import { evaluateMultiviewContinuityProxy } from '../quality/multiviewContinuityQuality'
import { evaluateMultiviewBackgroundQuality } from '../quality/multiviewBackgroundQuality'
import {
  evaluateMultiviewSubjectQuality,
  type MultiviewSubjectComparator,
} from '../quality/multiviewSubjectQuality'
import { evaluateModel3dCollection } from '../quality/model3dRecipeQuality'
import { evaluateStyleTransferCollection } from '../quality/styleTransferQuality'
import { evaluateVideoCollection } from '../quality/videoRecipeQuality'
import type { CapabilityRecipeImageInspection } from './capabilityRecipePostprocess'

export type {
  CapabilityRecipeImageInspector,
  CapabilityRecipeVideoInspection,
  CapabilityRecipeVideoInspector,
} from '../quality/capabilityQualityTypes'
export { normalizedPerceptualHashDistance }

export type CapabilityRecipeQualityOptions = {
  sourceResult?: GenerationNodeResult
  styleReferenceResults?: GenerationNodeResult[]
  compareFaces?: PortraitFaceComparator
  compareMoodExpressions?: MoodExpressionComparator
  compareMultiviewSubjects?: MultiviewSubjectComparator
  inspectVideo?: CapabilityRecipeVideoInspector
}

type InspectedItem = {
  item: GenerationResultCollectionItem
  inspection?: CapabilityRecipeImageInspection
  error?: string
}

function viewContractCheck(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
): GenerationQualityCheck {
  const expected = plan.outputs
  const actual = collection.items
  const exactOrder = expected.length === 9
    && actual.length === 9
    && expected.every((output, index) => {
      const item = actual[index]
      return Boolean(
        item
        && item.id === output.id
        && item.label === output.label
        && item.azimuth === output.azimuth
        && item.elevation === output.elevation,
      )
    })
  return exactOrder
    ? {
        id: 'view-contract',
        label: i18n.t('capabilityWorkflow.cameraSlots'),
        status: 'pass',
        summary: i18n.t('capabilityWorkflow.all9ViewsHaveTheAgreedOrderAndAngle'),
        metrics: { expectedCount: 9, actualCount: actual.length },
      }
    : {
        id: 'view-contract',
        label: i18n.t('capabilityWorkflow.cameraSlots'),
        status: 'fail',
        summary: i18n.t('capabilityWorkflow.theGridViewCountOrderOrAngleMetadataIs'),
        details: [
          i18n.t('capabilityWorkflow.plannedSlotsCollectionHasSlots', { v0: expected.length, v1: actual.length }),
          i18n.t('capabilityWorkflow.thisChecksTheStructuralContractNotActualCameraAngles'),
        ],
        metrics: { expectedCount: expected.length, actualCount: actual.length },
      }
}

function mediaAvailabilityCheck(collection: GenerationResultCollection): GenerationQualityCheck {
  const successfulImages = collection.items.filter((item) => (
    item.status === 'success'
    && item.result?.type === 'image'
    && Boolean(item.result.url || item.result.thumbnailUrl || item.result.providerUrl)
  ))
  const missing = collection.items.filter((item) => !successfulImages.includes(item))
  return successfulImages.length === 9
    ? {
        id: 'image-availability',
        label: i18n.t('capabilityWorkflow.imageCompleteness'),
        status: 'pass',
        summary: i18n.t('capabilityWorkflow.all9ViewsHaveReadableImageResults'),
        metrics: { successfulImageCount: successfulImages.length },
      }
    : {
        id: 'image-availability',
        label: i18n.t('capabilityWorkflow.imageCompleteness'),
        status: 'fail',
        summary: i18n.t('capabilityWorkflow.only9ViewsHaveReadableImages', { v0: successfulImages.length }),
        itemIds: missing.map((item) => item.id),
        details: missing.map((item) => `${translateCapabilityWorkflowText(item.label)}：${item.error || item.status}`),
        metrics: { successfulImageCount: successfulImages.length, missingImageCount: missing.length },
      }
}

function dimensionsCheck(inspected: readonly InspectedItem[]): GenerationQualityCheck {
  const available = inspected.filter((entry) => entry.inspection)
  if (available.length === 0) {
    return {
      id: 'dimensions',
      label: i18n.t('capabilityWorkflow.dimensionConsistency'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.imageDimensionsCouldNotBeRead'),
      details: inspected.flatMap((entry) => entry.error ? [`${translateCapabilityWorkflowText(entry.item.label)}：${entry.error}`] : []),
    }
  }
  const dimensions = new Map<string, string[]>()
  for (const entry of available) {
    const inspection = entry.inspection!
    const key = `${inspection.width}x${inspection.height}`
    dimensions.set(key, [...(dimensions.get(key) ?? []), entry.item.label])
  }
  if (dimensions.size === 1) {
    return {
      id: 'dimensions',
      label: i18n.t('capabilityWorkflow.dimensionConsistency'),
      status: inspected.some((entry) => entry.error) ? 'warning' : 'pass',
      summary: i18n.t('capabilityWorkflow.allInspectedImagesHaveConsistentDimensions', { v0: available.length, v1: Array.from(dimensions.keys())[0] }),
      details: inspected.flatMap((entry) => entry.error ? [i18n.t('capabilityWorkflow.wasNotInspected', { v0: translateCapabilityWorkflowText(entry.item.label), v1: entry.error })] : []),
      metrics: { inspectedImageCount: available.length, distinctDimensionCount: 1 },
    }
  }
  return {
    id: 'dimensions',
    label: i18n.t('capabilityWorkflow.dimensionConsistency'),
    status: 'warning',
    summary: i18n.t('capabilityWorkflow.foundOutputDimensions', { v0: dimensions.size }),
    details: Array.from(dimensions, ([size, labels]) => `${size}：${labels.join('、')}`),
    itemIds: available.map((entry) => entry.item.id),
    metrics: { inspectedImageCount: available.length, distinctDimensionCount: dimensions.size },
  }
}

function contentCheck(inspected: readonly InspectedItem[]): GenerationQualityCheck {
  const available = inspected.filter((entry) => entry.inspection)
  if (available.length === 0) {
    return {
      id: 'image-content',
      label: i18n.t('capabilityWorkflow.imageValidity'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.pixelsCouldNotBeReadBlankOrLowInformation'),
    }
  }
  const blank = available.filter((entry) => {
    const inspection = entry.inspection!
    return inspection.opaqueRatio < 0.65
      || (inspection.lumaStdDev < 0.012 && inspection.edgeEnergy < 0.008)
  })
  if (blank.length > 0) {
    return {
      id: 'image-content',
      label: i18n.t('capabilityWorkflow.imageValidity'),
      status: 'fail',
      summary: i18n.t('capabilityWorkflow.foundBlankTransparentOrLowInformationImages', { v0: blank.length }),
      itemIds: blank.map((entry) => entry.item.id),
      details: blank.map((entry) => {
        const inspection = entry.inspection!
        return i18n.t('capabilityWorkflow.opacityDetail', { v0: translateCapabilityWorkflowText(entry.item.label), v1: round(inspection.opaqueRatio), v2: round(inspection.edgeEnergy) })
      }),
      metrics: { blankImageCount: blank.length, inspectedImageCount: available.length },
    }
  }
  return {
    id: 'image-content',
    label: i18n.t('capabilityWorkflow.imageValidity'),
    status: inspected.some((entry) => entry.error) ? 'warning' : 'pass',
    summary: i18n.t('capabilityWorkflow.allInspectedImagesContainValidPixelsAndVisibleDetail', { v0: available.length }),
    details: inspected.flatMap((entry) => entry.error ? [i18n.t('capabilityWorkflow.wasNotInspected', { v0: translateCapabilityWorkflowText(entry.item.label), v1: entry.error })] : []),
    metrics: { blankImageCount: 0, inspectedImageCount: available.length },
  }
}

function viewDiversityCheck(inspected: readonly InspectedItem[]): GenerationQualityCheck {
  const available = inspected.filter((entry): entry is InspectedItem & { inspection: CapabilityRecipeImageInspection } => (
    Boolean(entry.inspection?.perceptualHash)
  ))
  if (available.length < 2) {
    return {
      id: 'view-diversity',
      label: i18n.t('capabilityWorkflow.viewDiversity'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.tooFewComparableImagesToCheckDuplicateViewpoints'),
    }
  }

  const exactPairs: Array<{ label: string; itemIds: [string, string] }> = []
  const nearPairs: Array<{ label: string; itemIds: [string, string] }> = []
  let minimumDistance = 1
  for (let left = 0; left < available.length; left += 1) {
    for (let right = left + 1; right < available.length; right += 1) {
      const leftEntry = available[left]!
      const rightEntry = available[right]!
      const distance = normalizedPerceptualHashDistance(
        leftEntry.inspection.perceptualHash,
        rightEntry.inspection.perceptualHash,
      )
      minimumDistance = Math.min(minimumDistance, distance)
      const pair = {
        label: `${translateCapabilityWorkflowText(leftEntry.item.label)} ↔ ${translateCapabilityWorkflowText(rightEntry.item.label)}`,
        itemIds: [leftEntry.item.id, rightEntry.item.id] as [string, string],
      }
      if (distance <= 0.01) exactPairs.push(pair)
      else if (distance <= 0.06) nearPairs.push(pair)
    }
  }

  if (exactPairs.length > 0) {
    return {
      id: 'view-diversity',
      label: i18n.t('capabilityWorkflow.viewDiversity'),
      status: 'fail',
      summary: i18n.t('capabilityWorkflow.foundPairsOfNearlyIdenticalImages', { v0: exactPairs.length }),
      details: [...exactPairs, ...nearPairs].slice(0, 8).map((pair) => pair.label),
      itemIds: Array.from(new Set([...exactPairs, ...nearPairs].flatMap((pair) => pair.itemIds))),
      metrics: {
        exactDuplicatePairCount: exactPairs.length,
        nearDuplicatePairCount: nearPairs.length,
        minimumPerceptualDistance: round(minimumDistance),
      },
    }
  }
  if (nearPairs.length > 0) {
    return {
      id: 'view-diversity',
      label: i18n.t('capabilityWorkflow.viewDiversity'),
      status: 'warning',
      summary: i18n.t('capabilityWorkflow.foundPairsOfHighlySimilarImagesConfirmThatThe', { v0: nearPairs.length }),
      details: nearPairs.slice(0, 8).map((pair) => pair.label),
      itemIds: Array.from(new Set(nearPairs.flatMap((pair) => pair.itemIds))),
      metrics: {
        exactDuplicatePairCount: 0,
        nearDuplicatePairCount: nearPairs.length,
        minimumPerceptualDistance: round(minimumDistance),
      },
    }
  }
  return {
    id: 'view-diversity',
    label: i18n.t('capabilityWorkflow.viewDiversity'),
    status: 'pass',
    summary: i18n.t('capabilityWorkflow.noDuplicateOrHighlySimilarViewsFound'),
    details: [i18n.t('capabilityWorkflow.thisPixelSimilarityCheckDoesNotReplaceManualConfirmation2')],
    metrics: {
      exactDuplicatePairCount: 0,
      nearDuplicatePairCount: 0,
      minimumPerceptualDistance: round(minimumDistance),
    },
  }
}

async function evaluateGrid9Collection(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
  inspectImage?: CapabilityRecipeImageInspector,
  evaluatedAt = Date.now(),
  sourceResult?: GenerationNodeResult,
  compareSubjects?: MultiviewSubjectComparator,
): Promise<GenerationResultCollection> {
  const imageItems = collection.items.filter((item) => (
    item.status === 'success'
    && item.result?.type === 'image'
    && Boolean(item.result.url || item.result.thumbnailUrl || item.result.providerUrl)
  ))
  const [inspected, sourceInspection, semantic] = await Promise.all([
    Promise.all(imageItems.map(async (item): Promise<InspectedItem> => {
      if (!inspectImage || !item.result) return { item, error: i18n.t('capabilityWorkflow.noPixelInspectorIsAvailableInThisEnvironment') }
      try {
        return { item, inspection: await inspectImage(item.result) }
      } catch (error) {
        return {
          item,
          error: error instanceof Error && error.message ? error.message : String(error),
        }
      }
    })),
    sourceResult && inspectImage
      ? inspectImage(sourceResult).catch(() => undefined)
      : Promise.resolve(undefined),
    evaluateMultiviewSubjectQuality({
      sourceResult,
      collection,
      compareSubjects,
      backgroundPolicy: plan.params.backgroundPolicy === 'neutral_turntable'
        ? 'neutral_turntable'
        : 'preserve_scene',
    }),
  ])

  const checks: GenerationQualityCheck[] = [
    viewContractCheck(plan, collection),
    mediaAvailabilityCheck(collection),
    dimensionsCheck(inspected),
    contentCheck(inspected),
    evaluateMultiviewBackgroundQuality({
      backgroundPolicy: plan.params.backgroundPolicy,
      sourceInspection,
      inspected,
    }),
    viewDiversityCheck(inspected),
    evaluateMultiviewContinuityProxy(inspected),
    ...semantic.checks,
  ]
  const quality: GenerationQualityReport = {
    version: 1,
    kind: 'grid9',
    evaluator: 'grid9-local-v2',
    status: statusFromChecks(checks),
    evaluatedAt,
    checks,
    metrics: {
      expectedImageCount: 9,
      successfulImageCount: imageItems.length,
      inspectedImageCount: inspected.filter((entry) => entry.inspection).length,
      inspectionErrorCount: inspected.filter((entry) => entry.error).length,
      semanticComparatorAvailable: semantic.comparatorAvailable,
      backgroundPolicy: plan.params.backgroundPolicy === 'neutral_turntable'
        ? 'neutral_turntable'
        : 'preserve_scene',
      ...(semantic.evaluator ? { semanticComparatorEvaluator: semantic.evaluator } : {}),
    },
  }
  return { ...collection, quality }
}

type PanoramaNormalization = {
  sourceWidth: number
  sourceHeight: number
  sourceAspectRatio: number
  targetAspectRatio: number
  croppedFraction: number
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function panoramaNormalizationFromResult(
  result: NonNullable<GenerationResultCollectionItem['result']>,
): PanoramaNormalization | undefined {
  const raw = recordValue(result.raw)
  const postprocess = recordValue(raw?.capabilityRecipePostprocess)
  const normalization = recordValue(postprocess?.panoramaNormalization)
  if (!normalization) return undefined
  const sourceWidth = Number(normalization.sourceWidth)
  const sourceHeight = Number(normalization.sourceHeight)
  const sourceAspectRatio = Number(normalization.sourceAspectRatio)
  const targetAspectRatio = Number(normalization.targetAspectRatio)
  const croppedFraction = Number(normalization.croppedFraction)
  if (![sourceWidth, sourceHeight, sourceAspectRatio, targetAspectRatio, croppedFraction].every(Number.isFinite)) {
    return undefined
  }
  return { sourceWidth, sourceHeight, sourceAspectRatio, targetAspectRatio, croppedFraction }
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function panoramaSeamDistance(inspection: CapabilityRecipeImageInspection): number | undefined {
  const left = inspection.leftEdgeRgb
  const right = inspection.rightEdgeRgb
  const count = Math.min(left?.length ?? 0, right?.length ?? 0)
  if (!left || !right || count === 0) return undefined
  let total = 0
  for (let index = 0; index < count; index += 1) {
    total += normalizedColorDistance(left[index]!, right[index]!)
  }
  return total / count
}

function panoramaAspectCheck(
  item: GenerationResultCollectionItem,
  inspection?: CapabilityRecipeImageInspection,
): GenerationQualityCheck {
  if (!inspection) {
    return {
      id: 'panorama-aspect',
      label: i18n.t('capabilityWorkflow.label21AspectRatio'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.panoramaDimensionsCouldNotBeRead'),
      itemIds: [item.id],
    }
  }
  const ratio = inspection.width / Math.max(1, inspection.height)
  const relativeError = Math.abs(ratio - 2) / 2
  if (relativeError <= 0.005) {
    return {
      id: 'panorama-aspect',
      label: i18n.t('capabilityWorkflow.label21AspectRatio'),
      status: 'pass',
      summary: i18n.t('capabilityWorkflow.outputDimensionsXMatch21', { v0: inspection.width, v1: inspection.height }),
      metrics: { aspectRatio: round(ratio), relativeError: round(relativeError) },
    }
  }
  return {
    id: 'panorama-aspect',
    label: i18n.t('capabilityWorkflow.label21AspectRatio'),
    status: 'fail',
    summary: i18n.t('capabilityWorkflow.outputRatio1DoesNotMatchTheEquirectangular2', { v0: round(ratio) }),
    itemIds: [item.id],
    metrics: { aspectRatio: round(ratio), relativeError: round(relativeError) },
  }
}

function panoramaNormalizationCheck(
  item: GenerationResultCollectionItem,
): GenerationQualityCheck {
  const result = item.result
  if (!result || !hasMediaLocator(result)) {
    return {
      id: 'panorama-normalization',
      label: i18n.t('capabilityWorkflow.nativePanoramaSource'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.noReadablePanoramaGenerationResult'),
      itemIds: [item.id],
    }
  }
  const normalization = panoramaNormalizationFromResult(result)
  if (!normalization) {
    return {
      id: 'panorama-normalization',
      label: i18n.t('capabilityWorkflow.nativePanoramaSource'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.noNormalizationMetadataCroppingFromARegularImageCannot'),
      itemIds: [item.id],
    }
  }
  const percent = normalization.croppedFraction * 100
  if (normalization.croppedFraction <= 0.005) {
    return {
      id: 'panorama-normalization',
      label: i18n.t('capabilityWorkflow.nativePanoramaSource'),
      status: 'pass',
      summary: i18n.t('capabilityWorkflow.theProviderOriginalIsAlready21X', { v0: normalization.sourceWidth, v1: normalization.sourceHeight }),
      metrics: {
        sourceAspectRatio: round(normalization.sourceAspectRatio),
        croppedPercent: round(percent, 1),
      },
    }
  }
  const status: GenerationQualityStatus = normalization.croppedFraction > 0.2 ? 'fail' : 'warning'
  return {
    id: 'panorama-normalization',
    label: i18n.t('capabilityWorkflow.nativePanoramaSource'),
    status,
    summary: i18n.t('capabilityWorkflow.theOutputWasCenterCroppedTo21Removing', { v0: round(percent, 1) }),
    details: [
      i18n.t('capabilityWorkflow.providerOriginalRatio1', { v0: round(normalization.sourceAspectRatio) }),
      i18n.t('capabilityWorkflow.centerCroppingCorrectsDimensionsOnlyItCannotTurnA'),
    ],
    itemIds: [item.id],
    metrics: {
      sourceAspectRatio: round(normalization.sourceAspectRatio),
      croppedPercent: round(percent, 1),
    },
  }
}

function panoramaSeamCheck(
  item: GenerationResultCollectionItem,
  inspection?: CapabilityRecipeImageInspection,
): GenerationQualityCheck {
  if (!inspection) {
    return {
      id: 'panorama-seam',
      label: i18n.t('capabilityWorkflow.leftRightSeam'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.pixelsCouldNotBeReadLeftAndRightEdges'),
      itemIds: [item.id],
    }
  }
  const distance = panoramaSeamDistance(inspection)
  if (distance === undefined) {
    return {
      id: 'panorama-seam',
      label: i18n.t('capabilityWorkflow.leftRightSeam'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.pixelSamplesDoNotIncludeTheLeftAndRight'),
      itemIds: [item.id],
    }
  }
  const status: GenerationQualityStatus = distance <= 0.08 ? 'pass' : distance <= 0.18 ? 'warning' : 'fail'
  return {
    id: 'panorama-seam',
    label: i18n.t('capabilityWorkflow.leftRightSeam'),
    status,
    summary: status === 'pass'
      ? i18n.t('capabilityWorkflow.leftAndRightEdgeColorsAreContinuousNoObvious')
      : status === 'warning'
        ? i18n.t('capabilityWorkflow.visibleDifferencesExistBetweenLeftAndRightEdgesCheck')
        : i18n.t('capabilityWorkflow.leftRightEdgeDifferencesAreExcessiveAVisibleDiscontinuity'),
    itemIds: status === 'pass' ? undefined : [item.id],
    metrics: { normalizedSeamDistance: round(distance) },
  }
}

function panoramaPoleCheck(
  item: GenerationResultCollectionItem,
  inspection?: CapabilityRecipeImageInspection,
): GenerationQualityCheck {
  const top = inspection?.topBandLuma
  const bottom = inspection?.bottomBandLuma
  const middle = inspection?.middleBandLuma
  if (!top || !bottom || !middle || top.length === 0 || bottom.length === 0) {
    return {
      id: 'panorama-poles',
      label: i18n.t('capabilityWorkflow.poleRisk'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.pixelSamplesDoNotIncludeTopAndBottomStrips'),
      itemIds: [item.id],
    }
  }
  const topVariation = standardDeviation(top)
  const bottomVariation = standardDeviation(bottom)
  const middleVariation = standardDeviation(middle)
  const poleVariation = Math.max(topVariation, bottomVariation)
  const status: GenerationQualityStatus = poleVariation <= 0.18
    ? 'pass'
    : poleVariation <= 0.32
      ? 'warning'
      : 'fail'
  return {
    id: 'panorama-poles',
    label: i18n.t('capabilityWorkflow.poleRisk'),
    status,
    summary: status === 'pass'
      ? i18n.t('capabilityWorkflow.noAbnormalHorizontalTextureChangesAtTheTopOr')
      : status === 'warning'
        ? i18n.t('capabilityWorkflow.topOrBottomTextureChangesAreLargeCheckZenith')
        : i18n.t('capabilityWorkflow.excessiveHorizontalVariationNearThePolesMayCauseVisible'),
    details: [i18n.t('capabilityWorkflow.thisPixelDistributionProxyIsNotACompleteSpherical')],
    itemIds: status === 'pass' ? undefined : [item.id],
    metrics: {
      topVariation: round(topVariation),
      bottomVariation: round(bottomVariation),
      middleVariation: round(middleVariation),
    },
  }
}

function panoramaProjectionCheck(
  item: GenerationResultCollectionItem,
  inspection?: CapabilityRecipeImageInspection,
): GenerationQualityCheck {
  if (!inspection) {
    return {
      id: 'panorama-projection-proxy',
      label: i18n.t('capabilityWorkflow.projectionUsability'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.pixelsCouldNotBeReadProjectionProxyChecksCannot'),
      itemIds: [item.id],
    }
  }
  const blank = inspection.opaqueRatio < 0.98
    || (inspection.lumaStdDev < 0.012 && inspection.edgeEnergy < 0.008)
  if (blank) {
    return {
      id: 'panorama-projection-proxy',
      label: i18n.t('capabilityWorkflow.projectionUsability'),
      status: 'fail',
      summary: i18n.t('capabilityWorkflow.theImageIsTransparentBlankOrLowInformationAnd'),
      itemIds: [item.id],
      metrics: {
        opaqueRatio: round(inspection.opaqueRatio),
        lumaStdDev: round(inspection.lumaStdDev),
        edgeEnergy: round(inspection.edgeEnergy),
      },
    }
  }
  return {
    id: 'panorama-projection-proxy',
    label: i18n.t('capabilityWorkflow.projectionUsability'),
    status: 'pass',
    summary: i18n.t('capabilityWorkflow.imageCoverageAndDetailMeetTheLocalEquirectangularProxy'),
    details: [i18n.t('capabilityWorkflow.manuallyCheckBuildingsPeopleAndHorizonDistortionInThe')],
    metrics: {
      opaqueRatio: round(inspection.opaqueRatio),
      lumaStdDev: round(inspection.lumaStdDev),
      edgeEnergy: round(inspection.edgeEnergy),
    },
  }
}

async function evaluatePanoramaCollection(
  collection: GenerationResultCollection,
  inspectImage?: CapabilityRecipeImageInspector,
  evaluatedAt = Date.now(),
): Promise<GenerationResultCollection> {
  const item = collection.items[0] ?? {
    id: 'panorama',
    label: i18n.t('capabilityWorkflow.label360DegreePanorama'),
    status: 'error' as const,
    error: i18n.t('capabilityWorkflow.noPanoramaOutputSlot'),
  }
  const result = item.status === 'success'
    && item.result?.type === 'image'
    && hasMediaLocator(item.result)
    ? item.result
    : undefined
  const availability: GenerationQualityCheck = result
    ? {
        id: 'panorama-image',
        label: i18n.t('capabilityWorkflow.panoramaImage'),
        status: 'pass',
        summary: i18n.t('capabilityWorkflow.aReadablePanoramaImageResultWasObtained'),
      }
    : {
        id: 'panorama-image',
        label: i18n.t('capabilityWorkflow.panoramaImage'),
        status: 'fail',
        summary: item.error || i18n.t('capabilityWorkflow.noReadablePanoramaImageResult'),
        itemIds: [item.id],
      }

  let inspection: CapabilityRecipeImageInspection | undefined
  let inspectionError = ''
  if (result && inspectImage) {
    try {
      inspection = await inspectImage(result)
    } catch (error) {
      inspectionError = error instanceof Error && error.message ? error.message : String(error)
    }
  } else if (result) {
    inspectionError = i18n.t('capabilityWorkflow.noPixelInspectorIsAvailableInThisEnvironment')
  }

  const checks: GenerationQualityCheck[] = [
    availability,
    panoramaAspectCheck(item, inspection),
    panoramaNormalizationCheck(item),
    panoramaSeamCheck(item, inspection),
    panoramaPoleCheck(item, inspection),
    panoramaProjectionCheck(item, inspection),
  ]
  if (inspectionError) {
    checks.push({
      id: 'panorama-inspection',
      label: i18n.t('capabilityWorkflow.pixelReading'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.thePanoramaResultIsRetainedButSomeLocalQuality'),
      details: [inspectionError],
      itemIds: [item.id],
    })
  }
  const quality: GenerationQualityReport = {
    version: 1,
    kind: 'panorama',
    evaluator: 'panorama-local-v1',
    status: statusFromChecks(checks),
    evaluatedAt,
    checks,
    metrics: {
      outputCount: collection.items.length,
      inspected: Boolean(inspection),
      ...(inspection ? {
        width: inspection.width,
        height: inspection.height,
        aspectRatio: round(inspection.width / Math.max(1, inspection.height)),
      } : {}),
    },
  }
  return { ...collection, quality }
}

export async function evaluateCapabilityRecipeCollection(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
  inspectImage?: CapabilityRecipeImageInspector,
  evaluatedAt = Date.now(),
  options: CapabilityRecipeQualityOptions = {},
): Promise<GenerationResultCollection> {
  if (plan.recipeId === 'image.multiview.grid9') {
    return evaluateGrid9Collection(
      plan,
      collection,
      inspectImage,
      evaluatedAt,
      options.sourceResult,
      options.compareMultiviewSubjects,
    )
  }
  if (plan.recipeId === 'image.multiview.custom') {
    return evaluateCustomViewCollection(plan, collection, inspectImage, evaluatedAt, {
      sourceResult: options.sourceResult,
      compareSubjects: options.compareMultiviewSubjects,
    })
  }
  if (plan.recipeId === 'scene.panorama.2to1') {
    return evaluatePanoramaCollection(collection, inspectImage, evaluatedAt)
  }
  if (plan.recipeId === 'portrait.refine' || plan.recipeId === 'portrait.mood') {
    return evaluatePortraitIdentityQuality({
      plan,
      collection,
      sourceResult: options.sourceResult,
      inspectImage,
      compareFaces: options.compareFaces,
      compareMoodExpressions: options.compareMoodExpressions,
      evaluatedAt,
    })
  }
  if (plan.recipeId === 'image.style.transfer') {
    return evaluateStyleTransferCollection({
      collection,
      sourceResult: options.sourceResult,
      styleReferenceResults: options.styleReferenceResults,
      inspectImage,
      evaluatedAt,
    })
  }
  if (plan.recipeId === 'image.multiview.reconstruct3d') {
    return evaluateModel3dCollection(collection, evaluatedAt)
  }
  if (
    plan.recipeId === 'video.look.apply'
    || plan.recipeId === 'video.effect.reference'
    || plan.recipeId === 'video.edit.look'
    || plan.recipeId === 'video.edit.effect'
  ) {
    return evaluateVideoCollection(plan, collection, options.inspectVideo, evaluatedAt, options.sourceResult)
  }
  return collection
}
