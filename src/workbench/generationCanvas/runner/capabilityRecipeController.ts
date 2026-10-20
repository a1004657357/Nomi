import { isProjectExecutionContextCurrent, withProjectAction } from '../../project/projectCanvasReadSurface'
import {
  BUILTIN_CAPABILITY_RECIPES,
  type CapabilityRecipeOutputKind,
  type RecipeOutputDescriptor,
  type RecipeRunPlan,
} from '../../../config/capabilityRecipes'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import type {
  GenerationCanvasNode,
  GenerationNodeKind,
  GenerationNodeResult,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  retryFailedRecipeItems,
  runCapabilityRecipePlan,
  type CapabilityRecipeTask,
} from './capabilityRecipeRunner'
import { compileCapabilityRecipePrompt } from './capabilityRecipePrompt'
import {
  createBrowserCapabilityRecipeMediaProcessor,
  nearestCapabilityImageAspectRatio,
  normalizeMultiviewCollectionDimensions,
  postprocessCapabilityRecipeResults,
  type CapabilityRecipeMediaProcessor,
} from './capabilityRecipePostprocess'
import {
  evaluateCapabilityRecipeCollection,
  type CapabilityRecipeVideoInspector,
} from './capabilityRecipeQuality'
import type {
  MoodExpressionComparator,
  PortraitFaceComparator,
} from '../quality/portraitIdentityQuality'
import type { MultiviewSubjectComparator } from '../quality/multiviewSubjectQuality'
import { generationNodeExecutor, type GenerationNodeExecutor } from './generationNodeExecutor'
import { runWithGenerationProviderSlot } from './generationProviderScheduler'
import { narrateProgress } from '../../observability/narrate'
import { getDesktopBridge } from '../../../desktop/bridge'

export type RunCapabilityRecipeOnNodeOptions = {
  executor?: GenerationNodeExecutor
  grantId?: string
  grantFactory?: (nodeId: string, maxAttemptsPerNode: number) => string | Promise<string>
  concurrency?: number
  persist?: () => Promise<void>
  signal?: AbortSignal
  onTargetCreated?: (nodeId: string) => void
  mediaProcessor?: CapabilityRecipeMediaProcessor
  comparePortraitFaces?: PortraitFaceComparator
  compareMoodExpressions?: MoodExpressionComparator
  compareMultiviewSubjects?: MultiviewSubjectComparator
  inspectVideoQuality?: CapabilityRecipeVideoInspector
}

export type RetryCapabilityRecipeOnNodeOptions = RunCapabilityRecipeOnNodeOptions & {
  retryRunId?: string
}

export type CapabilityRecipeRunOutcome = {
  nodeId: string
  collectionId: string
  successCount: number
  failureCount: number
}

function nodeKindForRecipeOutput(outputKind: CapabilityRecipeOutputKind): GenerationNodeKind {
  if (outputKind === 'panorama') return 'panorama'
  if (outputKind === 'model3d') return 'model3d'
  if (outputKind === 'video') return 'video'
  return 'image'
}

function taskNodeForPlan(node: GenerationCanvasNode, plan: RecipeRunPlan, task: CapabilityRecipeTask): GenerationCanvasNode {
  const output = task.outputs.length === 1 ? task.outputs[0] : undefined
  const normalizedParams = {
    ...plan.params,
    ...(typeof plan.params.aspectRatio === 'string' ? { aspect_ratio: plan.params.aspectRatio } : {}),
  }
  const modelMeta: Record<string, unknown> = {
    ...(node.meta ?? {}),
    vendor: plan.model.vendorKey,
    modelVendor: plan.model.vendorKey,
    modelKey: plan.model.modelKey,
    modelAlias: plan.model.modelKey,
    modelAutoSelectDisabled: true,
    archetypeId: plan.model.archetypeId,
    archetype: {
      id: plan.model.archetypeId,
      modeId: plan.model.modeId,
      ...(plan.model.variantId ? { variantId: plan.model.variantId } : {}),
    },
  }
  delete modelMeta.modelLabel
  if (plan.outputKind === 'video') {
    modelMeta.videoModel = plan.model.modelKey
    modelMeta.videoModelVendor = plan.model.vendorKey
    delete modelMeta.imageModel
    delete modelMeta.imageModelVendor
  } else if (plan.outputKind === 'image' || plan.outputKind === 'image_collection' || plan.outputKind === 'panorama') {
    modelMeta.imageModel = plan.model.modelKey
    modelMeta.imageModelVendor = plan.model.vendorKey
    delete modelMeta.videoModel
    delete modelMeta.videoModelVendor
  } else {
    delete modelMeta.imageModel
    delete modelMeta.imageModelVendor
    delete modelMeta.videoModel
    delete modelMeta.videoModelVendor
  }
  return {
    ...node,
    prompt: compileCapabilityRecipePrompt(node.prompt || '', plan, task),
    meta: {
      ...modelMeta,
      ...normalizedParams,
      capabilityRecipe: {
        runId: plan.id,
        recipeId: plan.recipeId,
        taskId: task.id,
        resourceIds: plan.resourceIds,
        plan,
        ...(output ? { output } : { outputs: task.outputs }),
      },
    },
  }
}

function flattenResult(result: GenerationNodeResult): GenerationNodeResult[] {
  const { alternatives = [], ...primary } = result
  return [primary, ...alternatives]
}

function resultWithCollectionCandidates(
  item: GenerationResultCollection['items'][number] | undefined,
): GenerationNodeResult | undefined {
  if (!item?.result) return undefined
  const selected = item.result
  const siblings = (item.candidates ?? []).filter((candidate) => candidate.id !== selected.id)
  return {
    ...selected,
    alternatives: [...(selected.alternatives ?? []), ...siblings],
  }
}

function collectionNodeSize(plan: RecipeRunPlan): { width: number; height: number } | undefined {
  if (plan.outputKind !== 'image_collection') return undefined
  if (plan.outputCount > 6) return { width: 520, height: 520 }
  if (plan.outputCount > 4) return { width: 520, height: 360 }
  return { width: 480, height: 360 }
}

type CapabilityRecipeNodeMeta = {
  runId?: string
  recipeId?: string
  resourceIds?: string[]
  plan?: RecipeRunPlan
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function recipeNodeMeta(node: GenerationCanvasNode): CapabilityRecipeNodeMeta | undefined {
  return recordValue(node.meta?.capabilityRecipe) as CapabilityRecipeNodeMeta | undefined
}

function isRecipeRunPlan(value: unknown): value is RecipeRunPlan {
  const plan = recordValue(value)
  return Boolean(
    plan
    && typeof plan.id === 'string'
    && typeof plan.recipeId === 'string'
    && typeof plan.recipeVersion === 'number'
    && typeof plan.outputKind === 'string'
    && Array.isArray(plan.sourceNodeIds)
    && Array.isArray(plan.resourceIds)
    && recordValue(plan.model)
    && recordValue(plan.params)
    && typeof plan.outputCount === 'number'
    && typeof plan.taskCount === 'number'
    && Array.isArray(plan.outputs)
    && typeof plan.createdAt === 'number',
  )
}

function outputDescriptorFromCollectionItem(
  item: GenerationResultCollection['items'][number],
): RecipeOutputDescriptor {
  return {
    id: item.id,
    label: item.label,
    ...(typeof item.azimuth === 'number' ? { azimuth: item.azimuth } : {}),
    ...(typeof item.elevation === 'number' ? { elevation: item.elevation } : {}),
    ...(item.shotSize ? { shotSize: item.shotSize } : {}),
    ...(typeof item.energy === 'number' ? { energy: item.energy } : {}),
    ...(typeof item.affinity === 'number' ? { affinity: item.affinity } : {}),
  }
}

function failedRecipeCollection(node: GenerationCanvasNode): GenerationResultCollection | undefined {
  const recipeId = recipeNodeMeta(node)?.recipeId
  return [...(node.resultCollections ?? [])].reverse().find((collection) => (
    (!recipeId || collection.recipeId === recipeId)
    && collection.items.some((item) => item.status === 'error')
  ))
}

function legacyRecipePlan(
  node: GenerationCanvasNode,
  collection: GenerationResultCollection,
): RecipeRunPlan | undefined {
  const recipe = BUILTIN_CAPABILITY_RECIPES.find((candidate) => candidate.id === collection.recipeId)
  if (!recipe) return undefined
  const meta = node.meta ?? {}
  const capabilityMeta = recipeNodeMeta(node)
  const archetype = recordValue(meta.archetype)
  const sourceNodeId = collection.source?.nodeId || node.regeneratedFrom
  const vendorKey = typeof meta.vendor === 'string'
    ? meta.vendor
    : typeof meta.modelVendor === 'string'
      ? meta.modelVendor
      : ''
  const modelKey = typeof meta.modelKey === 'string' ? meta.modelKey : ''
  const archetypeId = typeof archetype?.id === 'string' ? archetype.id : modelKey
  const modeId = typeof archetype?.modeId === 'string' ? archetype.modeId : ''
  if (!sourceNodeId || !vendorKey || !modelKey || !archetypeId || !modeId) return undefined

  const params = Object.fromEntries(recipe.controls.flatMap((control) => {
    const rawValue = meta[control.key]
      ?? (control.key === 'aspectRatio' ? meta.aspect_ratio : undefined)
      ?? control.defaultValue
    return typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean'
      ? [[control.key, rawValue] as const]
      : []
  }))
  const outputs = collection.items.map(outputDescriptorFromCollectionItem)
  return {
    id: capabilityMeta?.runId || collection.id,
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    outputKind: recipe.output.kind,
    sourceNodeIds: [sourceNodeId],
    resourceIds: Array.isArray(capabilityMeta?.resourceIds)
      ? capabilityMeta.resourceIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
      : [],
    model: {
      vendorKey,
      modelKey,
      archetypeId,
      ...(typeof archetype?.variantId === 'string' && archetype.variantId
        ? { variantId: archetype.variantId }
        : {}),
      modeId,
      compatibilityTier: 'compatible',
    },
    params,
    outputCount: outputs.length,
    taskCount: recipe.execution.kind === 'grid_split' ? 1 : outputs.length,
    outputs,
    createdAt: collection.createdAt,
  }
}

function retryPlanForNode(
  node: GenerationCanvasNode,
  collection: GenerationResultCollection,
): RecipeRunPlan | undefined {
  const persisted = recipeNodeMeta(node)?.plan
  return isRecipeRunPlan(persisted) ? persisted : legacyRecipePlan(node, collection)
}

async function prepareSourceImagePlan(
  plan: RecipeRunPlan,
  sourceResult: GenerationNodeResult | undefined,
  processor: CapabilityRecipeMediaProcessor,
): Promise<RecipeRunPlan> {
  if (
    !['image.style.transfer', 'image.multiview.grid9', 'image.multiview.custom'].includes(plan.recipeId)
    || sourceResult?.type !== 'image'
    || !processor.inspectImage
  ) return plan
  const existingSourceAspect = Number(plan.params.sourceAspectRatio)
  if (
    Number.isFinite(existingSourceAspect)
    && existingSourceAspect > 0
    && typeof plan.params.aspectRatio === 'string'
  ) return plan

  try {
    const inspection = await processor.inspectImage(sourceResult)
    const sourceWidth = Math.max(1, Math.floor(inspection.width))
    const sourceHeight = Math.max(1, Math.floor(inspection.height))
    return {
      ...plan,
      params: {
        ...plan.params,
        aspectRatio: nearestCapabilityImageAspectRatio(sourceWidth, sourceHeight),
        sourceAspectRatio: sourceWidth / sourceHeight,
        sourceWidth,
        sourceHeight,
      },
    }
  } catch {
    return plan
  }
}

function createRetryRunId(): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `recipe-retry-${suffix}`
}

export function capabilityRecipeRetryInfo(
  node: GenerationCanvasNode,
): { failedCount: number; taskCount: number; recipeId: string } | undefined {
  const collection = failedRecipeCollection(node)
  if (!collection) return undefined
  const plan = retryPlanForNode(node, collection)
  if (!plan) return undefined
  const failedCount = collection.items.filter((item) => item.status === 'error').length
  return {
    failedCount,
    taskCount: plan.taskCount === 1 ? 1 : failedCount,
    recipeId: plan.recipeId,
  }
}

async function evaluateCollectionSafely(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
  processor: CapabilityRecipeMediaProcessor,
  sourceResult?: GenerationNodeResult,
  compareFaces?: PortraitFaceComparator,
  compareMoodExpressions?: MoodExpressionComparator,
  compareMultiviewSubjects?: MultiviewSubjectComparator,
  inspectVideo?: CapabilityRecipeVideoInspector,
  styleReferenceResults: GenerationNodeResult[] = [],
): Promise<GenerationResultCollection> {
  try {
    return await evaluateCapabilityRecipeCollection(
      plan,
      collection,
      processor.inspectImage,
      Date.now(),
      {
        sourceResult,
        compareFaces,
        compareMoodExpressions,
        compareMultiviewSubjects,
        inspectVideo,
        styleReferenceResults,
      },
    )
  } catch (error) {
    const kind = plan.recipeId === 'image.multiview.grid9'
      ? 'grid9'
      : plan.recipeId === 'image.multiview.custom'
        ? 'multiview'
        : plan.recipeId === 'scene.panorama.2to1'
          ? 'panorama'
          : plan.recipeId === 'portrait.refine'
            ? 'portrait'
            : plan.recipeId === 'portrait.mood'
              ? 'mood'
              : plan.recipeId === 'image.style.transfer'
                ? 'style'
                : plan.recipeId === 'image.multiview.reconstruct3d'
                  ? 'model3d'
                  : plan.outputKind === 'video'
                    ? 'video'
                    : undefined
    if (!kind) return collection
    const message = error instanceof Error && error.message ? error.message : String(error)
    return {
      ...collection,
      quality: {
        version: 1,
        kind,
        evaluator: `${kind}-local-v1`,
        status: 'unavailable',
        evaluatedAt: Date.now(),
        checks: [{
          id: 'quality-evaluator',
          label: '本地质量检测',
          status: 'unavailable',
          summary: '生成结果已保留，但本地质量检测未完成',
          details: [message],
        }],
      },
    }
  }
}

export async function runCapabilityRecipeOnNode(
  sourceNodeId: string,
  plan: RecipeRunPlan,
  options: RunCapabilityRecipeOnNodeOptions,
): Promise<CapabilityRecipeRunOutcome> {
  const project = withProjectAction(project => project, () => { throw new Error('project_identity_unavailable') })
  const assertCurrent = () => {
    project.assertCurrent()
    if (options.signal?.aborted) throw new DOMException('生成已取消', 'AbortError')
  }
  let grantId = String(options.grantId || '').trim()
  if (!grantId && !options.grantFactory) throw new Error('缺少付费生成授权')
  assertCurrent()

  const initialStore = useGenerationCanvasStore.getState()
  const source = initialStore.nodes.find((node) => node.id === sourceNodeId)
  if (!source) throw new Error('source node not found')
  const mediaProcessor = options.mediaProcessor ?? createBrowserCapabilityRecipeMediaProcessor(project)
  plan = await prepareSourceImagePlan(plan, source.result, mediaProcessor)
  assertCurrent()
  const target = initialStore.duplicateNodeForRegeneration(sourceNodeId)
  if (!target) throw new Error('无法创建配方结果节点')
  options.onTargetCreated?.(target.id)
  assertCurrent()

  if (!grantId && options.grantFactory) {
    try {
      grantId = String(await options.grantFactory(target.id, plan.taskCount)).trim()
      assertCurrent()
    } catch (error) {
      if (isProjectExecutionContextCurrent(project)) useGenerationCanvasStore.getState().deleteNode(target.id)
      throw error
    }
    if (!grantId) {
      useGenerationCanvasStore.getState().deleteNode(target.id)
      throw new Error('缺少付费生成授权')
    }
  }

  const targetMeta = taskNodeForPlan(target, plan, {
    id: `${plan.id}:setup`, itemIds: [], outputs: [], plan,
  }).meta
  const collectionSize = collectionNodeSize(plan)
  const resources = initialStore.nodes.filter((node) => (
    plan.resourceIds.includes(node.id)
    || Boolean(node.creativeResource && plan.resourceIds.includes(node.creativeResource.id))
  ))
  const resourcePrompt = resources.flatMap((node) => {
    const resource = node.creativeResource
    if (!resource) return []
    const detail = resource.promptTokens.join(', ') || resource.description || ''
    return detail ? [`${resource.label}：${detail}`] : []
  }).join('\n')
  useGenerationCanvasStore.getState().updateNode(target.id, {
    kind: nodeKindForRecipeOutput(plan.outputKind),
    title: `${source.title} · ${plan.recipeId}`,
    ...(resourcePrompt ? { prompt: `${target.prompt || ''}\n创作资源约束：\n${resourcePrompt}`.trim() } : {}),
    ...(collectionSize ? { size: collectionSize } : {}),
    meta: {
      ...targetMeta,
      ...(collectionSize ? { previewHeight: collectionSize.height } : {}),
    },
    resultCollections: [],
  })
  useGenerationCanvasStore.getState().connectNodes(sourceNodeId, target.id, 'reference')
  for (const resourceNode of resources) {
    const kind = resourceNode.creativeResource?.kind
    const mode = kind === 'identity' ? 'character_ref' : kind === 'style' || kind === 'palette' ? 'style_ref' : 'reference'
    useGenerationCanvasStore.getState().connectNodes(resourceNode.id, target.id, mode)
  }
  useGenerationCanvasStore.getState().appendNodeRun(target.id, {
    id: plan.id,
    status: 'queued',
    startedAt: plan.createdAt,
    updatedAt: plan.createdAt,
  })

  const executor = options.executor ?? generationNodeExecutor
  const desktopVideoInspector = getDesktopBridge()?.assets.inspectVideo
  const inspectVideo = options.inspectVideoQuality ?? (desktopVideoInspector
    ? async (result: GenerationNodeResult) => {
        const url = result.url || result.providerUrl || result.thumbnailUrl
        if (!url) throw new Error('视频结果没有可检查的本地地址')
        return desktopVideoInspector({ url })
      }
    : undefined)
  const generatedCollection = await runCapabilityRecipePlan(plan, {
    concurrency: options.concurrency,
    executeTask: async (task) => {
      assertCurrent()
      const state = useGenerationCanvasStore.getState()
      const latestTarget = state.nodes.find((node) => node.id === target.id) ?? target
      const taskNode = taskNodeForPlan(latestTarget, plan, task)
      return runWithGenerationProviderSlot(
        taskNode,
        async () => {
          assertCurrent()
          const result = await executor(taskNode, {
            projectTarget: project.binding,
            nodes: state.nodes.map((node) => node.id === target.id ? taskNode : node),
            edges: state.edges,
            grantId,
            idempotencyKey: task.id,
            ...(options.signal ? { signal: options.signal } : {}),
            onProgress: (progress) => {
              if (!isProjectExecutionContextCurrent(project) || options.signal?.aborted) return
              useGenerationCanvasStore.getState().setNodeProgress(target.id, {
                runId: plan.id,
                phase: progress.phase,
                message: progress.message,
                ...(progress.taskId ? { taskId: progress.taskId } : {}),
              })
            },
          })
          assertCurrent()
          const processed = await postprocessCapabilityRecipeResults(
            plan,
            task,
            flattenResult(result),
            target.id,
            mediaProcessor,
          )
          assertCurrent()
          return processed
        },
        {
          ...(options.signal ? { signal: options.signal } : {}),
          onRateLimitWait: ({ waitMs }) => {
            if (!isProjectExecutionContextCurrent(project) || options.signal?.aborted) return
            useGenerationCanvasStore.getState().setNodeProgress(target.id, {
              runId: plan.id,
              phase: 'rate-limited',
              message: narrateProgress('rate-limited', { waitMs }),
            })
          },
        },
      )
    },
  })
  assertCurrent()
  const normalizedCollection = await normalizeMultiviewCollectionDimensions(
    plan,
    generatedCollection,
    target.id,
    mediaProcessor,
  )
  assertCurrent()
  const collectionWithSource: GenerationResultCollection = source.result
    ? {
        ...normalizedCollection,
        source: {
          nodeId: source.id,
          resultId: source.result.id,
          label: source.title,
          ...(source.result.url ? { url: source.result.url } : {}),
          ...(source.result.thumbnailUrl ? { thumbnailUrl: source.result.thumbnailUrl } : {}),
          ...(source.result.providerUrl ? { providerUrl: source.result.providerUrl } : {}),
        },
      }
    : normalizedCollection
  const collection = await evaluateCollectionSafely(
    plan,
    collectionWithSource,
    mediaProcessor,
    source.result,
    options.comparePortraitFaces,
    options.compareMoodExpressions,
    options.compareMultiviewSubjects,
    inspectVideo,
    resources.flatMap((node) => (
      (node.creativeResource?.kind === 'style' || node.creativeResource?.kind === 'palette')
      && node.result?.type === 'image'
        ? [node.result]
        : []
    )),
  )

  assertCurrent()
  const successfulItems = collection.items.filter((item) => item.status === 'success' && item.result)
  const failedItems = collection.items.filter((item) => item.status === 'error')
  const store = useGenerationCanvasStore.getState()
  const primaryResult = resultWithCollectionCandidates(successfulItems[0])
  if (primaryResult) store.addNodeResult(target.id, primaryResult)
  store.addNodeResultCollection(target.id, collection)
  if (successfulItems.length === 0) {
    store.setNodeStatus(target.id, 'error', failedItems[0]?.error || '配方生成失败')
  }

  assertCurrent()
  await (options.persist ?? persistActiveWorkbenchProjectNow)().catch(() => {})
  assertCurrent()
  return {
    nodeId: target.id,
    collectionId: collection.id,
    successCount: successfulItems.length,
    failureCount: failedItems.length,
  }
}

export async function retryCapabilityRecipeOnNode(
  targetNodeId: string,
  options: RetryCapabilityRecipeOnNodeOptions,
): Promise<CapabilityRecipeRunOutcome> {
  const project = withProjectAction(project => project, () => { throw new Error('project_identity_unavailable') })
  const assertCurrent = () => {
    project.assertCurrent()
    if (options.signal?.aborted) throw new DOMException('生成已取消', 'AbortError')
  }
  assertCurrent()

  const initialStore = useGenerationCanvasStore.getState()
  const target = initialStore.nodes.find((node) => node.id === targetNodeId)
  if (!target) throw new Error('配方结果节点不存在')
  const previousCollection = failedRecipeCollection(target)
  if (!previousCollection) throw new Error('当前配方没有可重试的失败结果')
  const previousPlan = retryPlanForNode(target, previousCollection)
  if (!previousPlan) throw new Error('当前节点缺少可恢复的配方计划，请从原技能节点重新运行')

  const failedCount = previousCollection.items.filter((item) => item.status === 'error').length
  const retryTaskCount = previousPlan.taskCount === 1 ? 1 : failedCount
  let grantId = String(options.grantId || '').trim()
  if (!grantId && options.grantFactory) {
    grantId = String(await options.grantFactory(target.id, retryTaskCount)).trim()
    assertCurrent()
  }
  if (!grantId) throw new Error('缺少付费生成授权')

  const retryPlan: RecipeRunPlan = {
    ...previousPlan,
    id: String(options.retryRunId || '').trim() || createRetryRunId(),
    createdAt: Date.now(),
  }
  const source = initialStore.nodes.find((node) => retryPlan.sourceNodeIds.includes(node.id))
  if (!source) throw new Error('配方源节点不存在')
  const resources = initialStore.nodes.filter((node) => (
    retryPlan.resourceIds.includes(node.id)
    || Boolean(node.creativeResource && retryPlan.resourceIds.includes(node.creativeResource.id))
  ))

  const setupNode = taskNodeForPlan(target, retryPlan, {
    id: `${retryPlan.id}:setup`,
    itemIds: [],
    outputs: [],
    plan: retryPlan,
  })
  useGenerationCanvasStore.getState().updateNode(target.id, { meta: setupNode.meta })
  useGenerationCanvasStore.getState().appendNodeRun(target.id, {
    id: retryPlan.id,
    status: 'queued',
    startedAt: retryPlan.createdAt,
    updatedAt: retryPlan.createdAt,
  })

  const executor = options.executor ?? generationNodeExecutor
  const mediaProcessor = options.mediaProcessor ?? createBrowserCapabilityRecipeMediaProcessor(project)
  const desktopVideoInspector = getDesktopBridge()?.assets.inspectVideo
  const inspectVideo = options.inspectVideoQuality ?? (desktopVideoInspector
    ? async (result: GenerationNodeResult) => {
        const url = result.url || result.providerUrl || result.thumbnailUrl
        if (!url) throw new Error('视频结果没有可检查的本地地址')
        return desktopVideoInspector({ url })
      }
    : undefined)
  const retriedCollection = await retryFailedRecipeItems(retryPlan, previousCollection, {
    concurrency: options.concurrency,
    executeTask: async (task) => {
      assertCurrent()
      const state = useGenerationCanvasStore.getState()
      const latestTarget = state.nodes.find((node) => node.id === target.id) ?? target
      const taskNode = taskNodeForPlan(latestTarget, retryPlan, task)
      return runWithGenerationProviderSlot(
        taskNode,
        async () => {
          assertCurrent()
          const result = await executor(taskNode, {
            projectTarget: project.binding,
            nodes: state.nodes.map((node) => node.id === target.id ? taskNode : node),
            edges: state.edges,
            grantId,
            idempotencyKey: task.id,
            ...(options.signal ? { signal: options.signal } : {}),
            onProgress: (progress) => {
              if (!isProjectExecutionContextCurrent(project) || options.signal?.aborted) return
              useGenerationCanvasStore.getState().setNodeProgress(target.id, {
                runId: retryPlan.id,
                phase: progress.phase,
                message: progress.message,
                ...(progress.taskId ? { taskId: progress.taskId } : {}),
              })
            },
          })
          assertCurrent()
          const processed = await postprocessCapabilityRecipeResults(
            retryPlan,
            task,
            flattenResult(result),
            target.id,
            mediaProcessor,
          )
          assertCurrent()
          return processed
        },
        {
          ...(options.signal ? { signal: options.signal } : {}),
          onRateLimitWait: ({ waitMs }) => {
            if (!isProjectExecutionContextCurrent(project) || options.signal?.aborted) return
            useGenerationCanvasStore.getState().setNodeProgress(target.id, {
              runId: retryPlan.id,
              phase: 'rate-limited',
              message: narrateProgress('rate-limited', { waitMs }),
            })
          },
        },
      )
    },
  })
  assertCurrent()
  const collectionWithSource: GenerationResultCollection = retriedCollection.source || !source.result
    ? retriedCollection
    : {
        ...retriedCollection,
        source: {
          nodeId: source.id,
          resultId: source.result.id,
          label: source.title,
          ...(source.result.url ? { url: source.result.url } : {}),
          ...(source.result.thumbnailUrl ? { thumbnailUrl: source.result.thumbnailUrl } : {}),
          ...(source.result.providerUrl ? { providerUrl: source.result.providerUrl } : {}),
        },
      }
  const collection = await evaluateCollectionSafely(
    retryPlan,
    collectionWithSource,
    mediaProcessor,
    source.result,
    options.comparePortraitFaces,
    options.compareMoodExpressions,
    options.compareMultiviewSubjects,
    inspectVideo,
    resources.flatMap((node) => (
      (node.creativeResource?.kind === 'style' || node.creativeResource?.kind === 'palette')
      && node.result?.type === 'image'
        ? [node.result]
        : []
    )),
  )

  assertCurrent()
  const successfulItems = collection.items.filter((item) => item.status === 'success' && item.result)
  const failedItems = collection.items.filter((item) => item.status === 'error')
  const store = useGenerationCanvasStore.getState()
  const primaryResult = resultWithCollectionCandidates(successfulItems[0])
  if (primaryResult) store.addNodeResult(target.id, primaryResult)
  store.addNodeResultCollection(target.id, collection)
  if (successfulItems.length === 0) {
    store.setNodeStatus(target.id, 'error', failedItems[0]?.error || '配方重试失败')
  }

  assertCurrent()
  await (options.persist ?? persistActiveWorkbenchProjectNow)().catch(() => {})
  assertCurrent()
  return {
    nodeId: target.id,
    collectionId: collection.id,
    successCount: successfulItems.length,
    failureCount: failedItems.length,
  }
}
