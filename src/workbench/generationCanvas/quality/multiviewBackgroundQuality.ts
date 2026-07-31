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
      label: '背景策略代理',
      status: 'unavailable',
      summary: '中性转台背景需要视觉语义复核，不能由来源场景像素差判断',
    }
  }

  const sourceColor = input.sourceInspection?.borderAverageRgb
  const sourceWhite = input.sourceInspection?.borderNearWhiteRatio
  if (!sourceColor || typeof sourceWhite !== 'number') {
    return {
      id: 'background-preservation-proxy',
      label: '背景保留代理',
      status: 'unavailable',
      summary: '缺少来源图片边缘像素，无法检测场景被替换为白底',
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
      label: '背景保留代理',
      status: 'unavailable',
      summary: '没有可比较的结果图片边缘像素',
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
    label: '背景保留代理',
    status: failed.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass',
    summary: failed.length > 0
      ? `${failed.length} 个机位疑似把来源场景替换成白色或中性影棚背景`
      : warnings.length > 0
        ? `${warnings.length} 个机位的画面边缘与来源场景差异过大`
        : '未检测到明显的白底替换或画面边缘突变',
    itemIds: flagged.length ? flagged.map(({ entry }) => entry.item.id) : undefined,
    details: [
      ...flagged.map(({ entry, whiteGain, colorDistance }) => (
        `${entry.item.label}：白边增量 ${roundQualityMetric(whiteGain)}，边缘色差 ${roundQualityMetric(colorDistance)}`
      )),
      '这是保守的边缘像素代理；通过不代表已证明新机位中的完整三维场景正确。',
    ],
    metrics: {
      comparedBackgroundCount: available.length,
      whiteBackgroundReplacementCount: failed.length,
      backgroundDriftWarningCount: warnings.length,
    },
  }
}
