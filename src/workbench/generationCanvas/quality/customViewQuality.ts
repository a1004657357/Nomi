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
    label: '机位槽位',
    status: exact ? 'pass' : 'fail',
    summary: exact
      ? `${plan.outputs.length} 个自定义机位的顺序和参数元数据完整`
      : '输出数量、顺序或机位参数与生成计划不一致',
    details: [
      `计划 ${plan.outputs.length} 个机位，集合 ${collection.items.length} 个机位`,
      '该检查验证任务契约，不宣称已从像素中识别真实方位角。',
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
    label: '图片完整性',
    status: complete ? 'pass' : 'fail',
    summary: complete
      ? `${successful.length} 个机位均有可读取图片`
      : `仅 ${successful.length}/${plan.outputs.length} 个机位有可读取图片`,
    details: missing.map((item) => `${item.label}：${item.error || item.status}`),
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
      label: '画面有效性',
      status: 'unavailable',
      summary: '未能读取像素，无法检测空白或低信息画面',
      details: inspected.flatMap((entry) => entry.error ? [`${entry.item.label}：${entry.error}`] : []),
    }
  }
  const blank = available.filter((entry) => {
    const inspection = entry.inspection!
    return inspection.opaqueRatio < 0.65
      || (inspection.lumaStdDev < 0.012 && inspection.edgeEnergy < 0.008)
  })
  return {
    id: 'custom-view-content',
    label: '画面有效性',
    status: blank.length > 0 ? 'fail' : available.length < inspected.length ? 'warning' : 'pass',
    summary: blank.length > 0
      ? `发现 ${blank.length} 张空白、透明或低信息画面`
      : `${available.length} 张已检测图片均包含有效像素和可见细节`,
    details: [
      ...blank.map((entry) => `${entry.item.label}：画面信息量过低`),
      ...inspected.flatMap((entry) => entry.error ? [`${entry.item.label} 未检测：${entry.error}`] : []),
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
      label: '尺寸一致性',
      status: 'unavailable',
      summary: '未能读取图片尺寸',
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
    label: '尺寸一致性',
    status: dimensions.size === 1
      ? available.length < inspected.length ? 'warning' : 'pass'
      : 'warning',
    summary: dimensions.size === 1
      ? `${available.length} 张已检测图片尺寸一致：${Array.from(dimensions.keys())[0]}`
      : `检测到 ${dimensions.size} 种输出尺寸`,
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
      label: '视角差异',
      status: 'unavailable',
      summary: '可比较图片不足，无法检测重复机位',
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
      const label = `${first.item.label} ↔ ${second.item.label}`
      if (distance <= 0.01) exactPairs.push(label)
      else if (distance <= 0.06) nearPairs.push(label)
    }
  }
  const status = exactPairs.length > 0 ? 'fail' : nearPairs.length > 0 ? 'warning' : 'pass'
  return {
    id: 'custom-view-diversity',
    label: '视角差异',
    status,
    summary: exactPairs.length > 0
      ? `发现 ${exactPairs.length} 组几乎相同的机位画面`
      : nearPairs.length > 0
        ? `发现 ${nearPairs.length} 组高度相似画面`
        : '未发现重复或高度相似的机位画面',
    details: [
      ...exactPairs,
      ...nearPairs,
      '这是像素相似度检查，不替代人工确认实际方位角、景别和机位高度。',
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
    label: '独立单帧封装',
    status: independentlyPackaged ? 'pass' : 'warning',
    summary: independentlyPackaged
      ? '每个机位独立保存为一个图片结果'
      : '部分机位没有独立保存为单帧结果',
    details: ['该结构检查不能完全排除单张图片内部仍包含拼贴，需要人工预览确认。'],
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
