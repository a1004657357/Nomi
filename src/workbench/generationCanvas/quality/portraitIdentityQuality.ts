import { translateCapabilityWorkflowText } from '../../../i18n/capabilityWorkflowText'
import i18n from '../../../i18n/index'
import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type {
  GenerationNodeResult,
  GenerationQualityCheck,
  GenerationQualityStatus,
  GenerationResultCollection,
  GenerationResultCollectionItem,
} from '../model/generationCanvasTypes'
import type { CapabilityRecipeImageInspection } from '../runner/capabilityRecipePostprocess'

export type PortraitFaceComparison = {
  sourceFaceDetected: boolean
  outputFaceDetected: boolean
  identitySimilarity?: number
}

export type PortraitFaceComparator = (
  source: GenerationNodeResult,
  output: GenerationNodeResult,
) => Promise<PortraitFaceComparison>

export type MoodExpressionComparatorOutput = {
  itemId: string
  faceDetected: boolean
  targetMatches?: boolean
  targetScore?: number
  muscleRegions?: string[]
  detail?: string
}

export type MoodExpressionComparison = {
  evaluator: string
  items: MoodExpressionComparatorOutput[]
}

export type MoodExpressionComparator = (input: {
  source: GenerationNodeResult
  outputs: Array<{
    itemId: string
    label: string
    energy: number
    affinity: number
    result: GenerationNodeResult
  }>
}) => Promise<MoodExpressionComparison>

export type EvaluatePortraitIdentityQualityInput = {
  plan: RecipeRunPlan
  collection: GenerationResultCollection
  sourceResult?: GenerationNodeResult
  inspectImage?: (result: GenerationNodeResult) => Promise<CapabilityRecipeImageInspection>
  compareFaces?: PortraitFaceComparator
  compareMoodExpressions?: MoodExpressionComparator
  evaluatedAt?: number
}

type InspectedOutput = {
  item: GenerationResultCollectionItem
  result?: GenerationNodeResult
  inspection?: CapabilityRecipeImageInspection
  error?: string
}

type FaceComparisonEntry = {
  entry: InspectedOutput
  comparison?: PortraitFaceComparison
  error?: string
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function statusFromChecks(checks: readonly GenerationQualityCheck[]): GenerationQualityStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail'
  if (checks.some((check) => check.status === 'warning')) return 'warning'
  if (checks.some((check) => check.status === 'unavailable')) return 'unavailable'
  return 'pass'
}

function hashDistance(left: string, right: string): number {
  const length = Math.min(left.length, right.length)
  if (length === 0) return 1
  let different = Math.abs(left.length - right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) different += 1
  }
  return different / Math.max(left.length, right.length)
}

function colorDistance(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]!) ** 2, 0)) / Math.sqrt(3)
}

function usableImage(result: GenerationNodeResult | undefined): result is GenerationNodeResult {
  return Boolean(
    result?.type === 'image'
    && (result.url || result.thumbnailUrl || result.providerUrl),
  )
}

function sourceCheck(sourceResult: GenerationNodeResult | undefined): GenerationQualityCheck {
  return usableImage(sourceResult)
    ? {
        id: 'portrait-source',
        label: i18n.t('capabilityWorkflow.sourcePortrait'),
        status: 'pass',
        summary: i18n.t('capabilityWorkflow.aComparableOriginalPortraitSnapshotIsRetained'),
      }
    : {
        id: 'portrait-source',
        label: i18n.t('capabilityWorkflow.sourcePortrait'),
        status: 'fail',
        summary: i18n.t('capabilityWorkflow.noReadableOriginalPortraitIdentityAndSkinDetailCannot'),
      }
}

function outputCheck(collection: GenerationResultCollection): GenerationQualityCheck {
  const available = collection.items.filter((item) => item.status === 'success' && usableImage(item.result))
  const missing = collection.items.filter((item) => !available.includes(item))
  return missing.length === 0 && available.length > 0
    ? {
        id: 'portrait-output',
        label: i18n.t('capabilityWorkflow.resultCompleteness'),
        status: 'pass',
        summary: i18n.t('capabilityWorkflow.allResultsAreReadable', { v0: available.length }),
        metrics: { successfulImageCount: available.length },
      }
    : {
        id: 'portrait-output',
        label: i18n.t('capabilityWorkflow.resultCompleteness'),
        status: 'fail',
        summary: i18n.t('capabilityWorkflow.onlyResultsAreReadable', { v0: available.length, v1: collection.items.length }),
        itemIds: missing.map((item) => item.id),
        details: missing.map((item) => `${translateCapabilityWorkflowText(item.label)}：${item.error || item.status}`),
        metrics: { successfulImageCount: available.length, missingImageCount: missing.length },
      }
}

async function inspectOutputs(
  collection: GenerationResultCollection,
  inspectImage?: EvaluatePortraitIdentityQualityInput['inspectImage'],
): Promise<InspectedOutput[]> {
  return Promise.all(collection.items.map(async (item) => {
    const result = usableImage(item.result) ? item.result : undefined
    if (!result) return { item, error: item.error || i18n.t('capabilityWorkflow.noReadableImageResult') }
    if (!inspectImage) return { item, result, error: i18n.t('capabilityWorkflow.noPixelInspectorIsAvailableInThisEnvironment') }
    try {
      return { item, result, inspection: await inspectImage(result) }
    } catch (error) {
      return {
        item,
        result,
        error: error instanceof Error && error.message ? error.message : String(error),
      }
    }
  }))
}

async function identityCheck(
  sourceResult: GenerationNodeResult | undefined,
  inspected: readonly InspectedOutput[],
  compareFaces?: PortraitFaceComparator,
): Promise<GenerationQualityCheck> {
  if (!usableImage(sourceResult)) {
    return {
      id: 'portrait-identity',
      label: i18n.t('capabilityWorkflow.identityProtection'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.noSourcePortraitIdentityCannotBeVerified'),
    }
  }
  if (!compareFaces) {
    return {
      id: 'portrait-identity',
      label: i18n.t('capabilityWorkflow.identityProtection'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.noFaceIdentityComparatorIsAvailablePixelProxiesCannot'),
      details: [i18n.t('capabilityWorkflow.resultsAreRetainedLocalFaceEmbeddingsOrVisualReview')],
    }
  }

  const comparisons = (await Promise.all(inspected.map(async (entry): Promise<FaceComparisonEntry | null> => {
    if (!entry.result) return null
    try {
      return { entry, comparison: await compareFaces(sourceResult, entry.result) }
    } catch (error) {
      return {
        entry,
        error: error instanceof Error && error.message ? error.message : String(error),
      }
    }
  }))).filter((entry): entry is FaceComparisonEntry => Boolean(entry))
  const unavailable = comparisons.filter(({ comparison, error }) => (
    Boolean(error)
    || !comparison?.sourceFaceDetected
    || !comparison.outputFaceDetected
    || typeof comparison.identitySimilarity !== 'number'
  ))
  const comparable = comparisons.filter((entry): entry is FaceComparisonEntry & {
    comparison: PortraitFaceComparison & { identitySimilarity: number }
  } => typeof entry.comparison?.identitySimilarity === 'number')
  const failed = comparable.filter(({ comparison }) => comparison.identitySimilarity < 0.55)
  const warnings = comparable.filter(({ comparison }) => (
    comparison.identitySimilarity >= 0.55 && comparison.identitySimilarity < 0.72
  ))

  if (failed.length > 0) {
    return {
      id: 'portrait-identity',
      label: i18n.t('capabilityWorkflow.identityProtection'),
      status: 'fail',
      summary: i18n.t('capabilityWorkflow.faceIdentitySimilarityIsBelowTheSafetyThresholdFor', { v0: failed.length }),
      itemIds: failed.map(({ entry }) => entry.item.id),
      details: failed.map(({ entry, comparison }) => (
        i18n.t('capabilityWorkflow.identitySimilarity', { v0: translateCapabilityWorkflowText(entry.item.label), v1: round(comparison.identitySimilarity) })
      )),
      metrics: { failedIdentityCount: failed.length },
    }
  }
  if (warnings.length > 0 || unavailable.length > 0) {
    return {
      id: 'portrait-identity',
      label: i18n.t('capabilityWorkflow.identityProtection'),
      status: 'warning',
      summary: warnings.length > 0
        ? i18n.t('capabilityWorkflow.identitySimilarityIsLowForResultsManualReviewIs', { v0: warnings.length })
        : i18n.t('capabilityWorkflow.noComparableFacesWereDetectedInResults', { v0: unavailable.length }),
      itemIds: [...warnings, ...unavailable].map(({ entry }) => entry.item.id),
      details: [
        ...warnings.map(({ entry, comparison }) => `${translateCapabilityWorkflowText(entry.item.label)}：${round(comparison.identitySimilarity)}`),
        ...unavailable.map(({ entry, error }) => `${translateCapabilityWorkflowText(entry.item.label)}：${error || i18n.t('capabilityWorkflow.noCompleteFaceDetected')}`),
      ],
      metrics: {
        warningIdentityCount: warnings.length,
        unavailableIdentityCount: unavailable.length,
      },
    }
  }
  if (comparable.length === 0) {
    return {
      id: 'portrait-identity',
      label: i18n.t('capabilityWorkflow.identityProtection'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.noComparableFaceResultsIdentityCannotBeVerified'),
    }
  }
  return {
    id: 'portrait-identity',
    label: i18n.t('capabilityWorkflow.identityProtection'),
    status: 'pass',
    summary: i18n.t('capabilityWorkflow.resultsPassedTheFaceIdentitySimilarityCheck', { v0: comparable.length }),
    metrics: {
      comparedFaceCount: comparable.length,
      minimumIdentitySimilarity: round(Math.min(...comparable.map(({ comparison }) => comparison.identitySimilarity))),
    },
  }
}

function visualProxyCheck(
  sourceInspection: CapabilityRecipeImageInspection | undefined,
  inspected: readonly InspectedOutput[],
): GenerationQualityCheck {
  const source = sourceInspection?.centerRegion
  const available = inspected.filter((entry) => entry.inspection?.centerRegion)
  if (!source || available.length === 0) {
    return {
      id: 'portrait-visual-proxy',
      label: i18n.t('capabilityWorkflow.centralPortraitChangeProxy'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.tooFewCenterRegionPixelsToCheckObviousDrift'),
      details: [i18n.t('capabilityWorkflow.thisProxyDetectsLargeVisualChangesOnlyAndIs')],
    }
  }
  const drifted = available.flatMap((entry) => {
    const output = entry.inspection!.centerRegion!
    const perceptualDistance = hashDistance(source.perceptualHash, output.perceptualHash)
    const rgbDistance = colorDistance(source.averageRgb, output.averageRgb)
    return perceptualDistance > 0.68 || rgbDistance > 0.48
      ? [{ entry, perceptualDistance, rgbDistance }]
      : []
  })
  return drifted.length > 0
    ? {
        id: 'portrait-visual-proxy',
        label: i18n.t('capabilityWorkflow.centralPortraitChangeProxy'),
        status: 'warning',
        summary: i18n.t('capabilityWorkflow.resultsHaveExcessiveCenterRegionChanges', { v0: drifted.length }),
        itemIds: drifted.map(({ entry }) => entry.item.id),
        details: [
          ...drifted.map(({ entry, perceptualDistance, rgbDistance }) => (
            i18n.t('capabilityWorkflow.pixelDistanceColorDistance', { v0: translateCapabilityWorkflowText(entry.item.label), v1: round(perceptualDistance), v2: round(rgbDistance) })
          )),
          i18n.t('capabilityWorkflow.thisProxyDetectsObviousDriftOnlyAndCannotProve'),
        ],
        metrics: { visualDriftCount: drifted.length },
      }
    : {
        id: 'portrait-visual-proxy',
        label: i18n.t('capabilityWorkflow.centralPortraitChangeProxy'),
        status: 'pass',
        summary: i18n.t('capabilityWorkflow.noLargeCenterRegionCompositionOrColorDriftFound'),
        details: [i18n.t('capabilityWorkflow.thisProxyDetectsObviousDriftOnlyAndCannotProve2')],
        metrics: { visualDriftCount: 0 },
      }
}

function skinTextureCheck(
  sourceInspection: CapabilityRecipeImageInspection | undefined,
  inspected: readonly InspectedOutput[],
): GenerationQualityCheck {
  const source = sourceInspection?.centerRegion
  const available = inspected.filter((entry) => entry.inspection?.centerRegion)
  if (!source || source.edgeEnergy <= 0 || available.length === 0) {
    return {
      id: 'portrait-skin-texture',
      label: i18n.t('capabilityWorkflow.skinTextureAndDetail'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.noCenterRegionTextureDataSmoothingOrOversharpeningRisks'),
    }
  }
  const severe: Array<{ entry: InspectedOutput; ratio: number }> = []
  const warnings: Array<{ entry: InspectedOutput; ratio: number }> = []
  for (const entry of available) {
    const ratio = entry.inspection!.centerRegion!.edgeEnergy / source.edgeEnergy
    if (ratio < 0.25 || ratio > 4) severe.push({ entry, ratio })
    else if (ratio < 0.55 || ratio > 2.4) warnings.push({ entry, ratio })
  }
  const flagged = [...severe, ...warnings]
  const status: GenerationQualityStatus = severe.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass'
  return {
    id: 'portrait-skin-texture',
    label: i18n.t('capabilityWorkflow.skinTextureAndDetail'),
    status,
    summary: status === 'pass'
      ? i18n.t('capabilityWorkflow.centerRegionTextureChangesAreWithinAReasonableRange')
      : severe.length > 0
        ? i18n.t('capabilityWorkflow.resultsHaveSevereSmoothingOrOversharpeningRisks', { v0: severe.length })
        : i18n.t('capabilityWorkflow.resultsHaveLargeTextureChangesZoomInToInspect', { v0: warnings.length }),
    itemIds: status === 'pass' ? undefined : flagged.map(({ entry }) => entry.item.id),
    details: flagged.map(({ entry, ratio }) => i18n.t('capabilityWorkflow.detailRatio', { v0: translateCapabilityWorkflowText(entry.item.label), v1: round(ratio) })),
    metrics: {
      severeTextureCount: severe.length,
      warningTextureCount: warnings.length,
    },
  }
}

function artifactCheck(
  sourceInspection: CapabilityRecipeImageInspection | undefined,
  inspected: readonly InspectedOutput[],
): GenerationQualityCheck {
  const failed: InspectedOutput[] = []
  const warnings: InspectedOutput[] = []
  const sourceAspect = sourceInspection
    ? sourceInspection.width / Math.max(1, sourceInspection.height)
    : undefined
  for (const entry of inspected) {
    const inspection = entry.inspection
    if (!inspection) {
      warnings.push(entry)
      continue
    }
    if (
      inspection.opaqueRatio < 0.9
      || (inspection.lumaStdDev < 0.01 && inspection.edgeEnergy < 0.006)
    ) {
      failed.push(entry)
      continue
    }
    const aspect = inspection.width / Math.max(1, inspection.height)
    if (sourceAspect && Math.abs(aspect - sourceAspect) / sourceAspect > 0.2) warnings.push(entry)
  }
  if (failed.length > 0) {
    return {
      id: 'portrait-artifacts',
      label: i18n.t('capabilityWorkflow.artifactsAndValidity'),
      status: 'fail',
      summary: i18n.t('capabilityWorkflow.resultsAreBlankTransparentOrLowInformation', { v0: failed.length }),
      itemIds: failed.map(({ item }) => item.id),
    }
  }
  if (warnings.length > 0) {
    return {
      id: 'portrait-artifacts',
      label: i18n.t('capabilityWorkflow.artifactsAndValidity'),
      status: 'warning',
      summary: i18n.t('capabilityWorkflow.resultsHaveIncompletePixelInspectionOrExcessiveAspectRatio', { v0: warnings.length }),
      itemIds: warnings.map(({ item }) => item.id),
      details: warnings.map(({ item, error }) => `${translateCapabilityWorkflowText(item.label)}：${error || i18n.t('capabilityWorkflow.theAspectRatioDiffersGreatlyFromTheOriginal')}`),
    }
  }
  return {
    id: 'portrait-artifacts',
    label: i18n.t('capabilityWorkflow.artifactsAndValidity'),
    status: 'pass',
    summary: i18n.t('capabilityWorkflow.noBlankTransparentOrObviouslyIncorrectAspectRatioOutputs'),
  }
}

function moodCoordinateCheck(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
): GenerationQualityCheck {
  const exact = plan.outputs.length === collection.items.length
    && plan.outputs.every((output, index) => {
      const item = collection.items[index]
      return Boolean(
        item
        && item.id === output.id
        && item.energy === output.energy
        && item.affinity === output.affinity,
      )
    })
  const coordinateKeys = collection.items.map((item) => `${item.energy}:${item.affinity}`)
  const unique = coordinateKeys.every((key) => !key.includes('undefined'))
    && new Set(coordinateKeys).size === coordinateKeys.length
  const fullMatrix = collection.items.length === 25
    && Array.from({ length: 25 }, (_, index) => `${Math.floor(index / 5)}:${index % 5}`)
      .every((key) => coordinateKeys.includes(key))
  if (!exact || !unique || (collection.items.length === 25 && !fullMatrix)) {
    return {
      id: 'mood-coordinate-contract',
      label: i18n.t('capabilityWorkflow.moodCoordinates'),
      status: 'fail',
      summary: i18n.t('capabilityWorkflow.moodResultCountOrderOrEnergyAffinityCoordinatesAre'),
      itemIds: collection.items.map((item) => item.id),
      metrics: {
        plannedCount: plan.outputs.length,
        actualCount: collection.items.length,
        uniqueCoordinateCount: new Set(coordinateKeys).size,
      },
    }
  }
  return {
    id: 'mood-coordinate-contract',
    label: i18n.t('capabilityWorkflow.moodCoordinates'),
    status: 'pass',
    summary: fullMatrix
      ? i18n.t('capabilityWorkflow.all25MoodCoordinatesFollowThe5x5RowColumn')
      : i18n.t('capabilityWorkflow.allTrialCoordinateLabelsAreCompleteAndUnique', { v0: collection.items.length }),
    metrics: {
      coordinateCount: collection.items.length,
      fullMatrix,
    },
  }
}

function moodExpressionCheck(
  sourceInspection: CapabilityRecipeImageInspection | undefined,
  inspected: readonly InspectedOutput[],
): GenerationQualityCheck {
  const available = inspected.filter((entry) => entry.inspection?.centerRegion?.perceptualHash)
  if (available.length === 0) {
    return {
      id: 'mood-expression-distinction',
      label: i18n.t('capabilityWorkflow.expressionPixelDistinctionProxy'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.noComparableCenterRegionPixels'),
      details: [i18n.t('capabilityWorkflow.pixelDifferencesCannotProveTheTargetExpressionSMeaning')],
    }
  }
  if (available.length === 1) {
    const sourceHash = sourceInspection?.centerRegion?.perceptualHash
    const outputHash = available[0]!.inspection!.centerRegion!.perceptualHash
    if (!sourceHash) {
      return {
        id: 'mood-expression-distinction',
        label: i18n.t('capabilityWorkflow.expressionPixelDistinctionProxy'),
        status: 'unavailable',
        summary: i18n.t('capabilityWorkflow.noOriginalCenterRegionVisibleChangesInASingle'),
        details: [i18n.t('capabilityWorkflow.pixelDifferencesCannotProveTheTargetExpressionSMeaning')],
      }
    }
    const distance = hashDistance(sourceHash, outputHash)
    return {
      id: 'mood-expression-distinction',
      label: i18n.t('capabilityWorkflow.expressionPixelDistinctionProxy'),
      status: distance <= 0.01 ? 'fail' : distance <= 0.04 ? 'warning' : 'pass',
      summary: distance <= 0.01
        ? i18n.t('capabilityWorkflow.theMoodResultIsNearlyIdenticalToTheOriginal')
        : distance <= 0.04
          ? i18n.t('capabilityWorkflow.theMoodChangeIsVerySubtleZoomInTo')
          : i18n.t('capabilityWorkflow.theMoodResultVisiblyDiffersFromTheOriginal'),
      itemIds: distance <= 0.04 ? [available[0]!.item.id] : undefined,
      metrics: { sourceDifference: round(distance) },
      details: [i18n.t('capabilityWorkflow.thisCheckDetectsImageChangesOnlyAndCannotProve')],
    }
  }

  const exact: Array<[InspectedOutput, InspectedOutput]> = []
  const near: Array<[InspectedOutput, InspectedOutput]> = []
  for (let left = 0; left < available.length; left += 1) {
    for (let right = left + 1; right < available.length; right += 1) {
      const leftEntry = available[left]!
      const rightEntry = available[right]!
      const distance = hashDistance(
        leftEntry.inspection!.centerRegion!.perceptualHash,
        rightEntry.inspection!.centerRegion!.perceptualHash,
      )
      if (distance <= 0.01) exact.push([leftEntry, rightEntry])
      else if (distance <= 0.035) near.push([leftEntry, rightEntry])
    }
  }
  const pairs = [...exact, ...near]
  const status: GenerationQualityStatus = exact.length > 0 ? 'fail' : near.length > 0 ? 'warning' : 'pass'
  return {
    id: 'mood-expression-distinction',
    label: i18n.t('capabilityWorkflow.expressionPixelDistinctionProxy'),
    status,
    summary: status === 'pass'
      ? i18n.t('capabilityWorkflow.noDuplicateCenterImagesFoundAmongMoodResults', { v0: available.length })
      : exact.length > 0
        ? i18n.t('capabilityWorkflow.foundPairsOfNearlyIdenticalMoodResults', { v0: exact.length })
        : i18n.t('capabilityWorkflow.foundPairsOfHighlySimilarMoodResults', { v0: near.length }),
    itemIds: status === 'pass'
      ? undefined
      : Array.from(new Set(pairs.flatMap(([left, right]) => [left.item.id, right.item.id]))),
    details: [
      ...pairs.slice(0, 8).map(([left, right]) => `${translateCapabilityWorkflowText(left.item.label)} ↔ ${translateCapabilityWorkflowText(right.item.label)}`),
      i18n.t('capabilityWorkflow.thisCheckDetectsDuplicateImagesOnlyAndCannotProve'),
    ],
    metrics: { exactDuplicatePairCount: exact.length, nearDuplicatePairCount: near.length },
  }
}

export async function evaluateMoodExpressionSemanticQuality(
  collection: GenerationResultCollection,
  sourceResult: GenerationNodeResult | undefined,
  compareMoodExpressions: MoodExpressionComparator | undefined,
): Promise<{ check: GenerationQualityCheck; evaluator?: string }> {
  if (!usableImage(sourceResult)) {
    return {
      check: {
        id: 'mood-expression-semantic',
        label: i18n.t('capabilityWorkflow.targetExpressionSemantics'),
        status: 'unavailable',
        summary: i18n.t('capabilityWorkflow.noSourcePortraitTheTargetExpressionCannotBeVerified'),
      },
    }
  }
  const outputs = collection.items.flatMap((item) => (
    item.status === 'success'
    && usableImage(item.result)
    && typeof item.energy === 'number'
    && typeof item.affinity === 'number'
      ? [{
          itemId: item.id,
          label: item.label,
          energy: item.energy,
          affinity: item.affinity,
          result: item.result,
        }]
      : []
  ))
  if (outputs.length === 0) {
    return {
      check: {
        id: 'mood-expression-semantic',
        label: i18n.t('capabilityWorkflow.targetExpressionSemantics'),
        status: 'unavailable',
        summary: i18n.t('capabilityWorkflow.noMoodImagesAreAvailableForReview'),
      },
    }
  }
  if (!compareMoodExpressions) {
    return {
      check: {
        id: 'mood-expression-semantic',
        label: i18n.t('capabilityWorkflow.targetExpressionSemantics'),
        status: 'unavailable',
        summary: i18n.t('capabilityWorkflow.noExpressionSemanticComparatorIsAvailablePixelDifferencesCannot'),
        details: [i18n.t('capabilityWorkflow.useVisualModelReviewOrManuallyCheckBrowEyelid')],
        itemIds: outputs.map((output) => output.itemId),
      },
    }
  }

  let comparison: MoodExpressionComparison
  try {
    comparison = await compareMoodExpressions({ source: sourceResult, outputs })
  } catch (error) {
    return {
      check: {
        id: 'mood-expression-semantic',
        label: i18n.t('capabilityWorkflow.targetExpressionSemantics'),
        status: 'unavailable',
        summary: i18n.t('capabilityWorkflow.theExpressionSemanticComparatorFailedTheTargetMoodRemains'),
        details: [error instanceof Error ? error.message : String(error)],
        itemIds: outputs.map((output) => output.itemId),
      },
    }
  }

  const byItemId = new Map(
    comparison.items
      .filter((entry) => outputs.some((output) => output.itemId === entry.itemId))
      .map((entry) => [entry.itemId, entry]),
  )
  const failed: Array<{ output: typeof outputs[number]; comparison: MoodExpressionComparatorOutput }> = []
  const unavailable: Array<{ output: typeof outputs[number]; reason: string }> = []
  const scores: number[] = []
  for (const output of outputs) {
    const entry = byItemId.get(output.itemId)
    if (!entry) {
      unavailable.push({ output, reason: i18n.t('capabilityWorkflow.theComparatorReturnedNoResultForThisMoodCell') })
      continue
    }
    if (!entry.faceDetected) {
      unavailable.push({ output, reason: i18n.t('capabilityWorkflow.noComparableFaceDetected') })
      continue
    }
    if (typeof entry.targetMatches !== 'boolean') {
      unavailable.push({ output, reason: i18n.t('capabilityWorkflow.theComparatorReturnedNoTargetExpressionVerdict') })
      continue
    }
    if (typeof entry.targetScore === 'number' && Number.isFinite(entry.targetScore)) {
      scores.push(entry.targetScore)
    }
    if (
      !entry.targetMatches
      || !Array.isArray(entry.muscleRegions)
      || new Set(entry.muscleRegions.map((region) => region.trim()).filter(Boolean)).size < 3
    ) {
      failed.push({ output, comparison: entry })
    }
  }
  const metrics: Record<string, number> = {
    comparedExpressionCount: outputs.length - unavailable.length,
    failedExpressionCount: failed.length,
    unavailableExpressionCount: unavailable.length,
    ...(scores.length ? { minimumTargetScore: round(Math.min(...scores)) } : {}),
  }
  if (failed.length > 0) {
    return {
      evaluator: comparison.evaluator,
      check: {
        id: 'mood-expression-semantic',
        label: i18n.t('capabilityWorkflow.targetExpressionSemantics'),
        status: 'fail',
        summary: i18n.t('capabilityWorkflow.moodCellsMissedTheTargetExpressionOrLackEvidence', { v0: failed.length }),
        itemIds: failed.map(({ output }) => output.itemId),
        details: [
          ...failed.map(({ output, comparison: entry }) => (
            `${translateCapabilityWorkflowText(output.label)}：${entry.detail || i18n.t('capabilityWorkflow.theExpressionDoesNotMatchOrFewerThan3')}`
          )),
          ...unavailable.map(({ output, reason }) => `${translateCapabilityWorkflowText(output.label)}：${reason}`),
        ],
        metrics,
      },
    }
  }
  if (unavailable.length > 0) {
    return {
      evaluator: comparison.evaluator,
      check: {
        id: 'mood-expression-semantic',
        label: i18n.t('capabilityWorkflow.targetExpressionSemantics'),
        status: outputs.length === unavailable.length ? 'unavailable' : 'warning',
        summary: i18n.t('capabilityWorkflow.moodCellsCompletedSemanticVerification', { v0: outputs.length - unavailable.length, v1: outputs.length }),
        itemIds: unavailable.map(({ output }) => output.itemId),
        details: unavailable.map(({ output, reason }) => `${translateCapabilityWorkflowText(output.label)}：${reason}`),
        metrics,
      },
    }
  }
  return {
    evaluator: comparison.evaluator,
    check: {
      id: 'mood-expression-semantic',
      label: i18n.t('capabilityWorkflow.targetExpressionSemantics'),
      status: 'pass',
      summary: i18n.t('capabilityWorkflow.allMoodCellsPassedTargetExpressionAndMultiRegion', { v0: outputs.length }),
      metrics,
    },
  }
}

export async function evaluatePortraitIdentityQuality({
  plan,
  collection,
  sourceResult,
  inspectImage,
  compareFaces,
  compareMoodExpressions,
  evaluatedAt = Date.now(),
}: EvaluatePortraitIdentityQualityInput): Promise<GenerationResultCollection> {
  let sourceInspection: CapabilityRecipeImageInspection | undefined
  if (usableImage(sourceResult) && inspectImage) {
    try {
      sourceInspection = await inspectImage(sourceResult)
    } catch {
      sourceInspection = undefined
    }
  }
  const inspected = await inspectOutputs(collection, inspectImage)
  const identity = await identityCheck(sourceResult, inspected, compareFaces)
  const moodSemantic = plan.recipeId === 'portrait.mood'
    ? await evaluateMoodExpressionSemanticQuality(collection, sourceResult, compareMoodExpressions)
    : undefined
  const sharedChecks: GenerationQualityCheck[] = [
    sourceCheck(sourceResult),
    outputCheck(collection),
    identity,
    visualProxyCheck(sourceInspection, inspected),
  ]
  const checks = plan.recipeId === 'portrait.mood'
    ? [
        ...sharedChecks.slice(0, 2),
        moodCoordinateCheck(plan, collection),
        ...sharedChecks.slice(2),
        moodSemantic!.check,
        moodExpressionCheck(sourceInspection, inspected),
        skinTextureCheck(sourceInspection, inspected),
        artifactCheck(sourceInspection, inspected),
      ]
    : [
        ...sharedChecks,
        skinTextureCheck(sourceInspection, inspected),
        artifactCheck(sourceInspection, inspected),
      ]
  return {
    ...collection,
    quality: {
      version: 1,
      kind: plan.recipeId === 'portrait.mood' ? 'mood' : 'portrait',
      evaluator: plan.recipeId === 'portrait.mood'
        ? 'mood-identity-local-v1'
        : 'portrait-identity-local-v1',
      status: statusFromChecks(checks),
      evaluatedAt,
      checks,
      metrics: {
        outputCount: collection.items.length,
        inspectedOutputCount: inspected.filter((entry) => entry.inspection).length,
        faceComparatorAvailable: Boolean(compareFaces),
        ...(plan.recipeId === 'portrait.mood' ? {
          moodExpressionComparatorAvailable: Boolean(compareMoodExpressions),
          ...(moodSemantic?.evaluator ? { moodExpressionComparatorEvaluator: moodSemantic.evaluator } : {}),
        } : {}),
      },
    },
  }
}
