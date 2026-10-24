import { translateCapabilityWorkflowText } from '../../../i18n/capabilityWorkflowText'
import i18n from '../../../i18n/index'
import type {
  GenerationQualityCheck,
  GenerationResultCollectionItem,
} from '../model/generationCanvasTypes'
import type { CapabilityRecipeImageInspection } from '../runner/capabilityRecipePostprocess'
import {
  normalizedColorDistance,
  roundQualityMetric,
} from './capabilityQualityUtils'

type InspectedBackgroundItem = {
  item: GenerationResultCollectionItem
  inspection?: CapabilityRecipeImageInspection
  error?: string
}

export function evaluateMultiviewBackgroundQuality(input: {
  backgroundPolicy: unknown
  sourceInspection?: CapabilityRecipeImageInspection
  inspected: readonly InspectedBackgroundItem[]
}): GenerationQualityCheck {
  if (input.backgroundPolicy === 'neutral_turntable') {
    return {
      id: 'background-preservation-proxy',
      label: i18n.t('capabilityWorkflow.backgroundStrategyProxy'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.aNeutralTurntableBackgroundRequiresSemanticVisualReviewNot'),
    }
  }

  const sourceColor = input.sourceInspection?.borderAverageRgb
  const sourceWhite = input.sourceInspection?.borderNearWhiteRatio
  if (!sourceColor || typeof sourceWhite !== 'number') {
    return {
      id: 'background-preservation-proxy',
      label: i18n.t('capabilityWorkflow.backgroundRetentionProxy'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.sourceImageEdgePixelsAreMissingReplacementWithA'),
    }
  }

  const available = input.inspected.filter((entry): entry is InspectedBackgroundItem & {
    inspection: CapabilityRecipeImageInspection & {
      borderAverageRgb: [number, number, number]
      borderNearWhiteRatio: number
    }
  } => Boolean(
    entry.inspection?.borderAverageRgb
    && typeof entry.inspection.borderNearWhiteRatio === 'number',
  ))
  if (available.length === 0) {
    return {
      id: 'background-preservation-proxy',
      label: i18n.t('capabilityWorkflow.backgroundRetentionProxy'),
      status: 'unavailable',
      summary: i18n.t('capabilityWorkflow.noComparableOutputEdgePixels'),
    }
  }

  const compared = available.map((entry) => {
    const whiteGain = entry.inspection.borderNearWhiteRatio - sourceWhite
    const colorDistance = normalizedColorDistance(entry.inspection.borderAverageRgb, sourceColor)
    const lumaGain = entry.inspection.meanLuma - (input.sourceInspection?.meanLuma ?? 0)
    return { entry, whiteGain, colorDistance, lumaGain }
  })
  const failed = compared.filter(({ entry, whiteGain }) => (
    entry.inspection.borderNearWhiteRatio >= 0.45 && whiteGain >= 0.35
  ))
  const warnings = compared.filter(({ entry, whiteGain, colorDistance, lumaGain }) => (
    !failed.some((candidate) => candidate.entry.item.id === entry.item.id)
    && (
      whiteGain >= 0.2
      || (colorDistance >= 0.42 && Math.abs(lumaGain) >= 0.18)
    )
  ))
  const flagged = [...failed, ...warnings]
  return {
    id: 'background-preservation-proxy',
    label: i18n.t('capabilityWorkflow.backgroundRetentionProxy'),
    status: failed.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass',
    summary: failed.length > 0
      ? i18n.t('capabilityWorkflow.viewsMayHaveReplacedTheSourceSceneWithA', { v0: failed.length })
      : warnings.length > 0
        ? i18n.t('capabilityWorkflow.viewsHaveExcessiveEdgeDifferencesFromTheSourceScene', { v0: warnings.length })
        : i18n.t('capabilityWorkflow.noObviousWhiteBackgroundReplacementOrAbruptEdgeChanges'),
    itemIds: flagged.length ? flagged.map(({ entry }) => entry.item.id) : undefined,
    details: [
      ...flagged.map(({ entry, whiteGain, colorDistance }) => (
        i18n.t('capabilityWorkflow.whiteEdgeIncreaseEdgeColorDistance', { v0: translateCapabilityWorkflowText(entry.item.label), v1: roundQualityMetric(whiteGain), v2: roundQualityMetric(colorDistance) })
      )),
      i18n.t('capabilityWorkflow.thisConservativeEdgePixelProxyDoesNotProveThat'),
    ],
    metrics: {
      comparedBackgroundCount: available.length,
      whiteBackgroundReplacementCount: failed.length,
      backgroundDriftWarningCount: warnings.length,
    },
  }
}
