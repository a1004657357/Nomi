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
        label: '来源人像',
        status: 'pass',
        summary: '已保留可比较的原始人像快照',
      }
    : {
        id: 'portrait-source',
        label: '来源人像',
        status: 'fail',
        summary: '缺少可读取的原始人像，无法执行身份与肤质对比',
      }
}

function outputCheck(collection: GenerationResultCollection): GenerationQualityCheck {
  const available = collection.items.filter((item) => item.status === 'success' && usableImage(item.result))
  const missing = collection.items.filter((item) => !available.includes(item))
  return missing.length === 0 && available.length > 0
    ? {
        id: 'portrait-output',
        label: '结果完整性',
        status: 'pass',
        summary: `${available.length} 个结果均可读取`,
        metrics: { successfulImageCount: available.length },
      }
    : {
        id: 'portrait-output',
        label: '结果完整性',
        status: 'fail',
        summary: `仅 ${available.length}/${collection.items.length} 个结果可读取`,
        itemIds: missing.map((item) => item.id),
        details: missing.map((item) => `${item.label}：${item.error || item.status}`),
        metrics: { successfulImageCount: available.length, missingImageCount: missing.length },
      }
}

async function inspectOutputs(
  collection: GenerationResultCollection,
  inspectImage?: EvaluatePortraitIdentityQualityInput['inspectImage'],
): Promise<InspectedOutput[]> {
  return Promise.all(collection.items.map(async (item) => {
    const result = usableImage(item.result) ? item.result : undefined
    if (!result) return { item, error: item.error || '没有可读取的图片结果' }
    if (!inspectImage) return { item, result, error: '当前运行环境未提供像素检测器' }
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
      label: '身份保护',
      status: 'unavailable',
      summary: '缺少来源人像，无法验证身份',
    }
  }
  if (!compareFaces) {
    return {
      id: 'portrait-identity',
      label: '身份保护',
      status: 'unavailable',
      summary: '当前没有人脸身份比较器，像素代理不能证明人物身份一致',
      details: ['结果已保留；需接入本地人脸嵌入或视觉评审后才能给出身份结论。'],
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
      label: '身份保护',
      status: 'fail',
      summary: `${failed.length} 个结果的人脸身份相似度低于安全阈值`,
      itemIds: failed.map(({ entry }) => entry.item.id),
      details: failed.map(({ entry, comparison }) => (
        `${entry.item.label}：身份相似度 ${round(comparison.identitySimilarity)}`
      )),
      metrics: { failedIdentityCount: failed.length },
    }
  }
  if (warnings.length > 0 || unavailable.length > 0) {
    return {
      id: 'portrait-identity',
      label: '身份保护',
      status: 'warning',
      summary: warnings.length > 0
        ? `${warnings.length} 个结果身份相似度偏低，建议人工复核`
        : `${unavailable.length} 个结果未检测到可比较人脸`,
      itemIds: [...warnings, ...unavailable].map(({ entry }) => entry.item.id),
      details: [
        ...warnings.map(({ entry, comparison }) => `${entry.item.label}：${round(comparison.identitySimilarity)}`),
        ...unavailable.map(({ entry, error }) => `${entry.item.label}：${error || '未检测到完整人脸'}`),
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
      label: '身份保护',
      status: 'unavailable',
      summary: '没有可比较的人脸结果，无法验证身份',
    }
  }
  return {
    id: 'portrait-identity',
    label: '身份保护',
    status: 'pass',
    summary: `${comparable.length} 个结果通过人脸身份相似度检查`,
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
      label: '中心人像变化代理',
      status: 'unavailable',
      summary: '中心区域像素不足，无法检测明显漂移',
      details: ['该代理只发现大幅视觉变化，不等同于人脸身份验证。'],
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
        label: '中心人像变化代理',
        status: 'warning',
        summary: `${drifted.length} 个结果中心区域变化幅度过大`,
        itemIds: drifted.map(({ entry }) => entry.item.id),
        details: [
          ...drifted.map(({ entry, perceptualDistance, rgbDistance }) => (
            `${entry.item.label}：像素差 ${round(perceptualDistance)}，色彩差 ${round(rgbDistance)}`
          )),
          '该代理只发现明显漂移，不能证明或否定人物身份。',
        ],
        metrics: { visualDriftCount: drifted.length },
      }
    : {
        id: 'portrait-visual-proxy',
        label: '中心人像变化代理',
        status: 'pass',
        summary: '未发现中心区域的大幅构图或色彩漂移',
        details: ['该代理只发现明显漂移，不能证明人物身份。'],
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
      label: '肤质与细节',
      status: 'unavailable',
      summary: '缺少中心区域纹理数据，无法检测磨皮或过锐风险',
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
    label: '肤质与细节',
    status,
    summary: status === 'pass'
      ? '中心区域纹理变化处于合理范围'
      : severe.length > 0
        ? `${severe.length} 个结果存在严重磨平或过锐风险`
        : `${warnings.length} 个结果纹理变化偏大，建议放大检查皮肤`,
    itemIds: status === 'pass' ? undefined : flagged.map(({ entry }) => entry.item.id),
    details: flagged.map(({ entry, ratio }) => `${entry.item.label}：细节比 ${round(ratio)}`),
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
      label: '伪影与有效性',
      status: 'fail',
      summary: `${failed.length} 个结果为空白、透明或信息量过低`,
      itemIds: failed.map(({ item }) => item.id),
    }
  }
  if (warnings.length > 0) {
    return {
      id: 'portrait-artifacts',
      label: '伪影与有效性',
      status: 'warning',
      summary: `${warnings.length} 个结果像素未完整检测或画幅变化过大`,
      itemIds: warnings.map(({ item }) => item.id),
      details: warnings.map(({ item, error }) => `${item.label}：${error || '画幅与原图差异较大'}`),
    }
  }
  return {
    id: 'portrait-artifacts',
    label: '伪影与有效性',
    status: 'pass',
    summary: '未发现空白、透明或明显画幅异常',
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
      label: '情绪坐标',
      status: 'fail',
      summary: '情绪结果数量、顺序或能量/亲和坐标不完整',
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
    label: '情绪坐标',
    status: 'pass',
    summary: fullMatrix
      ? '25 个情绪坐标按 5×5 行列顺序完整'
      : `${collection.items.length} 个试跑坐标标签完整且不重复`,
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
      label: '表情像素区分代理',
      status: 'unavailable',
      summary: '没有可比较的中心区域像素',
      details: ['像素差异不能证明目标表情语义正确。'],
    }
  }
  if (available.length === 1) {
    const sourceHash = sourceInspection?.centerRegion?.perceptualHash
    const outputHash = available[0]!.inspection!.centerRegion!.perceptualHash
    if (!sourceHash) {
      return {
        id: 'mood-expression-distinction',
        label: '表情像素区分代理',
        status: 'unavailable',
        summary: '缺少原图中心区域，无法判断单个情绪是否产生可见变化',
        details: ['像素差异不能证明目标表情语义正确。'],
      }
    }
    const distance = hashDistance(sourceHash, outputHash)
    return {
      id: 'mood-expression-distinction',
      label: '表情像素区分代理',
      status: distance <= 0.01 ? 'fail' : distance <= 0.04 ? 'warning' : 'pass',
      summary: distance <= 0.01
        ? '情绪结果与原图几乎相同，未检测到可见表演变化'
        : distance <= 0.04
          ? '情绪变化非常轻微，建议放大检查'
          : '情绪结果相对原图具有可见差异',
      itemIds: distance <= 0.04 ? [available[0]!.item.id] : undefined,
      metrics: { sourceDifference: round(distance) },
      details: ['该检查只发现画面是否变化，不能证明目标表情语义正确。'],
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
    label: '表情像素区分代理',
    status,
    summary: status === 'pass'
      ? `${available.length} 个情绪结果未发现重复中心画面`
      : exact.length > 0
        ? `发现 ${exact.length} 组几乎相同的情绪结果`
        : `发现 ${near.length} 组高度相似的情绪结果`,
    itemIds: status === 'pass'
      ? undefined
      : Array.from(new Set(pairs.flatMap(([left, right]) => [left.item.id, right.item.id]))),
    details: [
      ...pairs.slice(0, 8).map(([left, right]) => `${left.item.label} ↔ ${right.item.label}`),
      '该检查只发现重复画面，不能证明目标表情语义正确。',
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
        label: '目标表情语义',
        status: 'unavailable',
        summary: '缺少来源人像，无法验证目标表情',
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
        label: '目标表情语义',
        status: 'unavailable',
        summary: '没有可复核的情绪图片',
      },
    }
  }
  if (!compareMoodExpressions) {
    return {
      check: {
        id: 'mood-expression-semantic',
        label: '目标表情语义',
        status: 'unavailable',
        summary: '当前没有表情语义比较器，像素差异不能证明目标情绪正确',
        details: ['请使用视觉模型复核，或人工逐格确认眉部、眼睑、脸颊、嘴部和下颌表演。'],
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
        label: '目标表情语义',
        status: 'unavailable',
        summary: '表情语义比较器执行失败，目标情绪未验证',
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
      unavailable.push({ output, reason: '比较器未返回该情绪格' })
      continue
    }
    if (!entry.faceDetected) {
      unavailable.push({ output, reason: '未检测到可比较人脸' })
      continue
    }
    if (typeof entry.targetMatches !== 'boolean') {
      unavailable.push({ output, reason: '比较器未返回目标表情结论' })
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
        label: '目标表情语义',
        status: 'fail',
        summary: `${failed.length} 个情绪格未达到目标表情或缺少多区域肌肉证据`,
        itemIds: failed.map(({ output }) => output.itemId),
        details: [
          ...failed.map(({ output, comparison: entry }) => (
            `${output.label}：${entry.detail || '目标表情不匹配，或眉眼脸颊嘴部下颌证据少于 3 个区域'}`
          )),
          ...unavailable.map(({ output, reason }) => `${output.label}：${reason}`),
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
        label: '目标表情语义',
        status: outputs.length === unavailable.length ? 'unavailable' : 'warning',
        summary: `${outputs.length - unavailable.length}/${outputs.length} 个情绪格完成语义验证`,
        itemIds: unavailable.map(({ output }) => output.itemId),
        details: unavailable.map(({ output, reason }) => `${output.label}：${reason}`),
        metrics,
      },
    }
  }
  return {
    evaluator: comparison.evaluator,
    check: {
      id: 'mood-expression-semantic',
      label: '目标表情语义',
      status: 'pass',
      summary: `${outputs.length} 个情绪格均通过目标表情和多区域面部表演检查`,
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
