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
    return { error: '图片结果没有可读取的素材地址' }
  }
  if (!inspectImage) return { error: '当前运行环境未提供像素检测器' }
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
      label: '画面有效性',
      status: 'unavailable',
      summary: '风格化结果已保留，但无法读取像素',
      details: output.error ? [output.error] : undefined,
      ...(itemId ? { itemIds: [itemId] } : {}),
    }
  }
  const inspection = output.inspection
  const blank = inspection.opaqueRatio < 0.65
    || (inspection.lumaStdDev < 0.012 && inspection.edgeEnergy < 0.008)
  return {
    id: 'style-image-content',
    label: '画面有效性',
    status: blank ? 'fail' : 'pass',
    summary: blank
      ? '输出透明、空白或信息量过低'
      : '输出包含有效像素和可见细节',
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
      label: '画幅保留',
      status: 'unavailable',
      summary: '缺少源图或结果图尺寸，无法核对画幅',
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
    label: '画幅保留',
    status,
    summary: status === 'pass'
      ? '结果保持了源图画幅'
      : `结果画幅相对源图偏差 ${Math.round(relativeError * 100)}%`,
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
      label: '内容保留代理',
      status: 'unavailable',
      summary: '缺少可比较的中心区域像素签名',
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
    label: '内容保留代理',
    status,
    summary: status === 'pass'
      ? '中心区域结构与源图保持接近'
      : status === 'warning'
        ? '中心区域结构变化较大，建议确认主体和构图'
        : '中心区域结构严重偏离源图，主体或构图可能已丢失',
    details: ['这是像素结构代理指标，不等同于语义或人物身份验证。'],
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
      label: '风格迁移代理',
      status: 'unavailable',
      summary: '缺少可读取的源图、结果图或风格参考图',
      details: [
        source.error,
        output.error,
        ...references.flatMap((entry) => entry.error ? [entry.error] : []),
        '文字风格约束无法通过本地像素代理验证。',
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
      label: '风格迁移代理',
      status: 'unavailable',
      summary: '风格参考与源图的本地视觉签名过于接近，无法测量迁移方向',
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
    label: '风格迁移代理',
    status,
    summary: status === 'pass'
      ? `结果视觉签名向风格参考靠近约 ${Math.round(best.progress * 100)}%`
      : noVisibleChange
        ? '结果与源图几乎没有可测的视觉变化'
        : '结果没有明显向风格参考靠近，建议人工预览或重新生成',
    details: ['该检查只比较色彩、亮度、局部对比和边缘能量，不能证明语义风格完全符合。'],
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
          label: '风格化结果',
          status: 'pass',
          summary: '已保留可读取的风格化图片结果',
        }
      : {
          id: 'style-output',
          label: '风格化结果',
          status: 'fail',
          summary: item?.error || '没有可读取的风格化图片结果',
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
