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
  const caveat = '仅使用整图颜色降级检查；不能证明人物、物体身份或三维几何一致。'
  return {
    id: 'subject-continuity-proxy',
    label: '主体连续性代理',
    status: outliers.length > 0 ? 'warning' : 'pass',
    summary: outliers.length > 0
      ? `发现 ${outliers.length} 张整图色彩分布明显偏离其余机位`
      : '未发现整图色彩分布的极端漂移',
    itemIds: outliers.length > 0 ? outliers.map(({ entry }) => entry.item.id) : undefined,
    details: [
      ...outliers.map(({ entry, distance }) => `${entry.item.label}：色彩偏离 ${roundQualityMetric(distance)}`),
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
      label: '主体连续性代理',
      status: 'unavailable',
      summary: '可比较图片不足，无法计算连续性代理指标',
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
    const signals = [
      hashDistance > 0.68 ? '结构' : null,
      colorDistance > 0.36 ? '颜色' : null,
      edgeRatio > 3 ? '纹理' : null,
      contrastRatio > 3 ? '对比度' : null,
    ].filter((signal): signal is string => signal !== null)
    return { entry, hashDistance, colorDistance, edgeRatio, contrastRatio, signals }
  })
  const outliers = candidates.filter((candidate) => candidate.signals.length >= 2)
  const caveat = '中心区域复合代理用于发现明显漂移；不能证明人物、物体身份或三维几何一致。'
  return {
    id: 'subject-continuity-proxy',
    label: '主体连续性代理',
    status: outliers.length > 0 || centered.length < available.length ? 'warning' : 'pass',
    summary: outliers.length > 0
      ? `发现 ${outliers.length} 张中心主体在多项视觉信号上同时偏离`
      : centered.length < available.length
        ? `仅 ${centered.length}/${available.length} 张具有可比较的中心区域`
        : '中心主体复合代理未发现多信号同时异常的明显漂移',
    itemIds: outliers.length > 0 ? outliers.map(({ entry }) => entry.item.id) : undefined,
    details: [
      ...outliers.map(({ entry, signals, hashDistance, colorDistance, edgeRatio, contrastRatio }) => (
        `${entry.item.label}：${signals.join('、')}异常（结构 ${roundQualityMetric(hashDistance)}，`
        + `颜色 ${roundQualityMetric(colorDistance)}，纹理比 ${roundQualityMetric(edgeRatio)}，`
        + `对比度比 ${roundQualityMetric(contrastRatio)}）`
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
