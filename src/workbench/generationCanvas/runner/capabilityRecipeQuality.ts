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
        label: '机位槽位',
        status: 'pass',
        summary: '9 个机位按约定顺序和角度元数据完整',
        metrics: { expectedCount: 9, actualCount: actual.length },
      }
    : {
        id: 'view-contract',
        label: '机位槽位',
        status: 'fail',
        summary: '九宫格机位数量、顺序或角度元数据不完整',
        details: [
          `计划 ${expected.length} 个槽位，集合 ${actual.length} 个槽位`,
          '该检查验证结构契约，不宣称已从像素中识别真实拍摄角度。',
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
        label: '图片完整性',
        status: 'pass',
        summary: '9 个机位均有可读取的图片结果',
        metrics: { successfulImageCount: successfulImages.length },
      }
    : {
        id: 'image-availability',
        label: '图片完整性',
        status: 'fail',
        summary: `仅 ${successfulImages.length}/9 个机位有可读取图片`,
        itemIds: missing.map((item) => item.id),
        details: missing.map((item) => `${item.label}：${item.error || item.status}`),
        metrics: { successfulImageCount: successfulImages.length, missingImageCount: missing.length },
      }
}

function dimensionsCheck(inspected: readonly InspectedItem[]): GenerationQualityCheck {
  const available = inspected.filter((entry) => entry.inspection)
  if (available.length === 0) {
    return {
      id: 'dimensions',
      label: '尺寸一致性',
      status: 'unavailable',
      summary: '未能读取图片尺寸',
      details: inspected.flatMap((entry) => entry.error ? [`${entry.item.label}：${entry.error}`] : []),
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
      label: '尺寸一致性',
      status: inspected.some((entry) => entry.error) ? 'warning' : 'pass',
      summary: `${available.length} 张已检测图片尺寸一致：${Array.from(dimensions.keys())[0]}`,
      details: inspected.flatMap((entry) => entry.error ? [`${entry.item.label} 未检测：${entry.error}`] : []),
      metrics: { inspectedImageCount: available.length, distinctDimensionCount: 1 },
    }
  }
  return {
    id: 'dimensions',
    label: '尺寸一致性',
    status: 'warning',
    summary: `检测到 ${dimensions.size} 种输出尺寸`,
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
      label: '画面有效性',
      status: 'unavailable',
      summary: '未能读取像素，无法检测空白或低信息画面',
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
      label: '画面有效性',
      status: 'fail',
      summary: `发现 ${blank.length} 张空白、透明或低信息画面`,
      itemIds: blank.map((entry) => entry.item.id),
      details: blank.map((entry) => {
        const inspection = entry.inspection!
        return `${entry.item.label}：透明度 ${round(inspection.opaqueRatio)}，细节 ${round(inspection.edgeEnergy)}`
      }),
      metrics: { blankImageCount: blank.length, inspectedImageCount: available.length },
    }
  }
  return {
    id: 'image-content',
    label: '画面有效性',
    status: inspected.some((entry) => entry.error) ? 'warning' : 'pass',
    summary: `${available.length} 张已检测图片均包含有效像素和可见细节`,
    details: inspected.flatMap((entry) => entry.error ? [`${entry.item.label} 未检测：${entry.error}`] : []),
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
      label: '视角差异',
      status: 'unavailable',
      summary: '可比较图片不足，无法检测重复视角',
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
        label: `${leftEntry.item.label} ↔ ${rightEntry.item.label}`,
        itemIds: [leftEntry.item.id, rightEntry.item.id] as [string, string],
      }
      if (distance <= 0.01) exactPairs.push(pair)
      else if (distance <= 0.06) nearPairs.push(pair)
    }
  }

  if (exactPairs.length > 0) {
    return {
      id: 'view-diversity',
      label: '视角差异',
      status: 'fail',
      summary: `发现 ${exactPairs.length} 组几乎相同的画面`,
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
      label: '视角差异',
      status: 'warning',
      summary: `发现 ${nearPairs.length} 组高度相似画面，建议确认机位是否真的变化`,
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
    label: '视角差异',
    status: 'pass',
    summary: '未发现重复或高度相似的机位画面',
    details: ['这是像素相似度检查，不替代人工确认实际方位角。'],
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
      if (!inspectImage || !item.result) return { item, error: '当前运行环境未提供像素检测器' }
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
      label: '2:1 画幅',
      status: 'unavailable',
      summary: '未能读取全景图尺寸',
      itemIds: [item.id],
    }
  }
  const ratio = inspection.width / Math.max(1, inspection.height)
  const relativeError = Math.abs(ratio - 2) / 2
  if (relativeError <= 0.005) {
    return {
      id: 'panorama-aspect',
      label: '2:1 画幅',
      status: 'pass',
      summary: `输出尺寸 ${inspection.width}x${inspection.height}，符合 2:1`,
      metrics: { aspectRatio: round(ratio), relativeError: round(relativeError) },
    }
  }
  return {
    id: 'panorama-aspect',
    label: '2:1 画幅',
    status: 'fail',
    summary: `输出比例 ${round(ratio)}:1，不符合等距柱状 2:1 画幅`,
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
      label: '原生全景来源',
      status: 'unavailable',
      summary: '没有可读取的全景生成结果',
      itemIds: [item.id],
    }
  }
  const normalization = panoramaNormalizationFromResult(result)
  if (!normalization) {
    return {
      id: 'panorama-normalization',
      label: '原生全景来源',
      status: 'unavailable',
      summary: '缺少归一化元数据，无法判断是否由普通图片裁切而来',
      itemIds: [item.id],
    }
  }
  const percent = normalization.croppedFraction * 100
  if (normalization.croppedFraction <= 0.005) {
    return {
      id: 'panorama-normalization',
      label: '原生全景来源',
      status: 'pass',
      summary: `供应商原图已是 2:1（${normalization.sourceWidth}x${normalization.sourceHeight}）`,
      metrics: {
        sourceAspectRatio: round(normalization.sourceAspectRatio),
        croppedPercent: round(percent, 1),
      },
    }
  }
  const status: GenerationQualityStatus = normalization.croppedFraction > 0.2 ? 'fail' : 'warning'
  return {
    id: 'panorama-normalization',
    label: '原生全景来源',
    status,
    summary: `输出通过中心裁切归一为 2:1，裁掉约 ${round(percent, 1)}% 原图面积`,
    details: [
      `供应商原图比例 ${round(normalization.sourceAspectRatio)}:1`,
      '中心裁切只能修正尺寸，不能把普通图片变成真实可环绕全景。',
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
      label: '左右接缝',
      status: 'unavailable',
      summary: '未能读取像素，无法比较左右边缘',
      itemIds: [item.id],
    }
  }
  const distance = panoramaSeamDistance(inspection)
  if (distance === undefined) {
    return {
      id: 'panorama-seam',
      label: '左右接缝',
      status: 'unavailable',
      summary: '像素采样不包含左右边缘数据',
      itemIds: [item.id],
    }
  }
  const status: GenerationQualityStatus = distance <= 0.08 ? 'pass' : distance <= 0.18 ? 'warning' : 'fail'
  return {
    id: 'panorama-seam',
    label: '左右接缝',
    status,
    summary: status === 'pass'
      ? '左右边缘色彩连续，未发现明显接缝'
      : status === 'warning'
        ? '左右边缘存在可见差异，建议进入全景预览检查接缝'
        : '左右边缘差异过大，环绕时很可能出现明显断层',
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
      label: '极点风险',
      status: 'unavailable',
      summary: '像素采样不包含顶部和底部带状数据',
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
    label: '极点风险',
    status,
    summary: status === 'pass'
      ? '顶部和底部未发现异常的横向纹理变化'
      : status === 'warning'
        ? '顶部或底部纹理变化偏大，建议检查天顶与地面扭曲'
        : '极点区域横向变化过强，可能出现明显拉伸或拼接扭曲',
    details: ['这是像素分布代理指标，不是完整球面投影求解。'],
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
      label: '投影可用性',
      status: 'unavailable',
      summary: '未能读取像素，无法执行投影代理检查',
      itemIds: [item.id],
    }
  }
  const blank = inspection.opaqueRatio < 0.98
    || (inspection.lumaStdDev < 0.012 && inspection.edgeEnergy < 0.008)
  if (blank) {
    return {
      id: 'panorama-projection-proxy',
      label: '投影可用性',
      status: 'fail',
      summary: '画面透明、空白或信息量过低，无法作为可用全景',
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
    label: '投影可用性',
    status: 'pass',
    summary: '画面覆盖和细节满足本地等距柱状代理检查',
    details: ['仍需在可拖动全景预览中人工确认建筑直线、人物和地平线是否扭曲。'],
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
    label: '360° 全景',
    status: 'error' as const,
    error: '没有全景输出槽位',
  }
  const result = item.status === 'success'
    && item.result?.type === 'image'
    && hasMediaLocator(item.result)
    ? item.result
    : undefined
  const availability: GenerationQualityCheck = result
    ? {
        id: 'panorama-image',
        label: '全景图片',
        status: 'pass',
        summary: '已获得一个可读取的全景图片结果',
      }
    : {
        id: 'panorama-image',
        label: '全景图片',
        status: 'fail',
        summary: item.error || '没有可读取的全景图片结果',
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
    inspectionError = '当前运行环境未提供像素检测器'
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
      label: '像素读取',
      status: 'unavailable',
      summary: '全景结果已保留，但部分本地质量检查未完成',
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
