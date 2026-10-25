import { translateCapabilityWorkflowText } from '../../../i18n/capabilityWorkflowText'
import i18n from '../../../i18n/index'
import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type {
  GenerationNodeResult,
  GenerationQualityCheck,
  GenerationQualityReport,
  GenerationResultCollection,
  GenerationResultCollectionItem,
} from '../model/generationCanvasTypes'
import type { CapabilityRecipeImageInspection } from '../runner/capabilityRecipePostprocess'
import type { CapabilityRecipeImageInspector } from './capabilityQualityTypes'
import {
  normalizedPerceptualHashDistance,
  qualityStatusFromChecks,
  roundQualityMetric,
} from './capabilityQualityUtils'
import { evaluateMultiviewContinuityProxy } from './multiviewContinuityQuality'
import { evaluateMultiviewBackgroundQuality } from './multiviewBackgroundQuality'
import {
  evaluateMultiviewSubjectQuality,
  type MultiviewSubjectComparator,
} from './multiviewSubjectQuality'

type InspectedItem = {
  item: GenerationResultCollectionItem
  inspection?: CapabilityRecipeImageInspection
  error?: string
}

function cameraContractCheck(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
): GenerationQualityCheck {
  const exact = plan.outputs.length > 0
    && collection.items.length === plan.outputs.length
    && plan.outputs.every((output, index) => {
      const item = collection.items[index]
      return Boolean(
        item
        && item.id === output.id
        && item.label === output.label
        && item.azimuth === output.azimuth
        && item.elevation === output.elevation
        && item.shotSize === output.shotSize,
      )
    })
  return {
    id: 'custom-view-contract',
    label: i18n.t('capabilityWorkflow.cameraSlots'),
    status: exact ? 'pass' : 'fail',
    summary: exact
      ? i18n.t('capabilityWorkflow.metadataOrderAndParametersAreCompleteForCustomViews', { v0: plan.outputs.length })
      : i18n.t('capabilityWorkflow.outputCountOrderOrCameraParametersDoNotMatch'),
    details: [
      i18n.t('capabilityWorkflow.plannedViewsCollectionHasViews', { v0: plan.outputs.length, v1: collection.items.length }),
      i18n.t('capabilityWorkflow.thisChecksTheTaskContractNotCameraAnglesInferred'),
    ],
    metrics: {
      expectedCount: plan.outputs.length,
      actualCount: collection.items.length,
    },
  }
}

function imageAvailabilityCheck(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
): GenerationQualityCheck {
  const successful = collection.items.filter((item) => (
    item.status === 'success'
    && item.result?.type === 'image'
    && Boolean(item.result.url || item.result.thumbnailUrl || item.result.providerUrl)
  ))
  const missing = collection.items.filter((item) => !successful.includes(item))
  const complete = successful.length === plan.outputs.length
  return {
    id: 'custom-view-images',
    label: i18n.t('capabilityWorkflow.imageCompleteness'),
    status: complete ? 'pass' : 'fail',
    summary: complete
      ? i18n.t('capabilityWorkflow.allViewsHaveReadableImages', { v0: successful.length })
      : i18n.t('capabilityWorkflow.onlyViewsHaveReadableImages', { v0: successful.length, v1: plan.outputs.length }),
    details: missing.map((item) => `${translateCapabilityWorkflowText(item.label)}：${item.error || item.status}`),
    itemIds: complete ? undefined : missing.map((item) => item.id),
    metrics: {
      expectedImageCount: plan.outputs.length,
      successfulImageCount: successful.length,
    },
  }
}

function contentCheck(inspected: readonly InspectedItem[]): GenerationQualityCheck {
  const available = inspected.filter((entry) => entry.inspection)
  if (available.length === 0) {
    return {
      id: 'custom-view-content',
      label: i18n.t('capabilityWorkflow.imageValidity'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.pixelsCouldNotBeReadBlankOrLowInformation'),
      details: inspected.flatMap((entry) => entry.error ? [`${translateCapabilityWorkflowText(entry.item.label)}：${entry.error}`] : []),
    }
  }
  const blank = available.filter((entry) => {
    const inspection = entry.inspection!
    return inspection.opaqueRatio < 0.65
      || (inspection.lumaStdDev < 0.012 && inspection.edgeEnergy < 0.008)
  })
  return {
    id: 'custom-view-content',
    label: i18n.t('capabilityWorkflow.imageValidity'),
    status: blank.length > 0 ? 'fail' : available.length < inspected.length ? 'warning' : 'pass',
    summary: blank.length > 0
      ? i18n.t('capabilityWorkflow.foundBlankTransparentOrLowInformationImages', { v0: blank.length })
      : i18n.t('capabilityWorkflow.allInspectedImagesContainValidPixelsAndVisibleDetail', { v0: available.length }),
    details: [
      ...blank.map((entry) => i18n.t('capabilityWorkflow.imageInformationIsTooLow', { v0: translateCapabilityWorkflowText(entry.item.label) })),
      ...inspected.flatMap((entry) => entry.error ? [i18n.t('capabilityWorkflow.wasNotInspected', { v0: translateCapabilityWorkflowText(entry.item.label), v1: entry.error })] : []),
    ],
    itemIds: blank.length > 0 ? blank.map((entry) => entry.item.id) : undefined,
    metrics: {
      blankImageCount: blank.length,
      inspectedImageCount: available.length,
    },
  }
}

function dimensionsCheck(inspected: readonly InspectedItem[]): GenerationQualityCheck {
  const available = inspected.filter((entry) => entry.inspection)
  if (available.length === 0) {
    return {
      id: 'custom-view-dimensions',
      label: i18n.t('capabilityWorkflow.dimensionConsistency'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.imageDimensionsCouldNotBeRead'),
    }
  }
  const dimensions = new Map<string, string[]>()
  for (const entry of available) {
    const inspection = entry.inspection!
    const key = `${inspection.width}x${inspection.height}`
    dimensions.set(key, [...(dimensions.get(key) ?? []), entry.item.label])
  }
  return {
    id: 'custom-view-dimensions',
    label: i18n.t('capabilityWorkflow.dimensionConsistency'),
    status: dimensions.size === 1
      ? available.length < inspected.length ? 'warning' : 'pass'
      : 'warning',
    summary: dimensions.size === 1
      ? i18n.t('capabilityWorkflow.allInspectedImagesHaveConsistentDimensions', { v0: available.length, v1: Array.from(dimensions.keys())[0] })
      : i18n.t('capabilityWorkflow.foundOutputDimensions', { v0: dimensions.size }),
    details: dimensions.size > 1
      ? Array.from(dimensions, ([size, labels]) => `${size}：${labels.join('、')}`)
      : undefined,
    metrics: {
      inspectedImageCount: available.length,
      distinctDimensionCount: dimensions.size,
    },
  }
}

function diversityCheck(inspected: readonly InspectedItem[]): GenerationQualityCheck {
  const available = inspected.filter((entry): entry is InspectedItem & {
    inspection: CapabilityRecipeImageInspection
  } => Boolean(entry.inspection?.perceptualHash))
  if (available.length < 2) {
    return {
      id: 'custom-view-diversity',
      label: i18n.t('capabilityWorkflow.viewDiversity'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.tooFewComparableImagesToCheckDuplicateViews'),
    }
  }
  const exactPairs: string[] = []
  const nearPairs: string[] = []
  let minimumDistance = 1
  for (let left = 0; left < available.length; left += 1) {
    for (let right = left + 1; right < available.length; right += 1) {
      const first = available[left]!
      const second = available[right]!
      const distance = normalizedPerceptualHashDistance(
        first.inspection.perceptualHash,
        second.inspection.perceptualHash,
      )
      minimumDistance = Math.min(minimumDistance, distance)
      const label = `${translateCapabilityWorkflowText(first.item.label)} ↔ ${translateCapabilityWorkflowText(second.item.label)}`
      if (distance <= 0.01) exactPairs.push(label)
      else if (distance <= 0.06) nearPairs.push(label)
    }
  }
  const status = exactPairs.length > 0 ? 'fail' : nearPairs.length > 0 ? 'warning' : 'pass'
  return {
    id: 'custom-view-diversity',
    label: i18n.t('capabilityWorkflow.viewDiversity'),
    status,
    summary: exactPairs.length > 0
      ? i18n.t('capabilityWorkflow.foundPairsOfNearlyIdenticalViews', { v0: exactPairs.length })
      : nearPairs.length > 0
        ? i18n.t('capabilityWorkflow.foundPairsOfHighlySimilarImages', { v0: nearPairs.length })
        : i18n.t('capabilityWorkflow.noDuplicateOrHighlySimilarViewsFound'),
    details: [
      ...exactPairs,
      ...nearPairs,
      i18n.t('capabilityWorkflow.thisPixelSimilarityCheckDoesNotReplaceManualConfirmation'),
    ].slice(0, 8),
    metrics: {
      exactDuplicatePairCount: exactPairs.length,
      nearDuplicatePairCount: nearPairs.length,
      minimumPerceptualDistance: roundQualityMetric(minimumDistance, 4),
    },
  }
}

function packagingCheck(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
): GenerationQualityCheck {
  const independentlyPackaged = collection.items.length === plan.outputs.length
    && collection.items.every((item) => item.result?.type === 'image' && !item.result.alternatives?.length)
  return {
    id: 'custom-view-packaging',
    label: i18n.t('capabilityWorkflow.independentSingleFramePackaging'),
    status: independentlyPackaged ? 'pass' : 'warning',
    summary: independentlyPackaged
      ? i18n.t('capabilityWorkflow.eachViewIsSavedAsASeparateImageResult')
      : i18n.t('capabilityWorkflow.someViewsWereNotSavedAsIndependentSingleFrame'),
    details: [i18n.t('capabilityWorkflow.thisStructuralCheckCannotRuleOutCollagesWithinA')],
  }
}

export async function evaluateCustomViewCollection(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
  inspectImage?: CapabilityRecipeImageInspector,
  evaluatedAt = Date.now(),
  options: {
    sourceResult?: GenerationNodeResult
    compareSubjects?: MultiviewSubjectComparator
  } = {},
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
    options.sourceResult && inspectImage
      ? inspectImage(options.sourceResult).catch(() => undefined)
      : Promise.resolve(undefined),
    evaluateMultiviewSubjectQuality({
      sourceResult: options.sourceResult,
      collection,
      compareSubjects: options.compareSubjects,
      backgroundPolicy: plan.params.backgroundPolicy === 'neutral_turntable'
        ? 'neutral_turntable'
        : 'preserve_scene',
    }),
  ])
  const checks: GenerationQualityCheck[] = [
    cameraContractCheck(plan, collection),
    imageAvailabilityCheck(plan, collection),
    contentCheck(inspected),
    evaluateMultiviewBackgroundQuality({
      backgroundPolicy: plan.params.backgroundPolicy,
      sourceInspection,
      inspected,
    }),
    dimensionsCheck(inspected),
    diversityCheck(inspected),
    evaluateMultiviewContinuityProxy(inspected),
    ...semantic.checks,
    packagingCheck(plan, collection),
  ]
  const quality: GenerationQualityReport = {
    version: 1,
    kind: 'multiview',
    evaluator: 'custom-view-local-v2',
    status: qualityStatusFromChecks(checks),
    evaluatedAt,
    checks,
    metrics: {
      expectedImageCount: plan.outputs.length,
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
