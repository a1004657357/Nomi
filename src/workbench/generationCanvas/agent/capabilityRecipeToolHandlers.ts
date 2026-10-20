import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type { ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { buildRecipeRunPlan, type RecipeOutputDescriptor } from '../../../config/capabilityRecipes'
import { isCapabilityRecipesEnabled } from '../../../config/featureFlags'
import { mintSpendGrant } from '../../api/taskApi'
import type { CanvasGestureContext } from '../events/canvasGestureContext'
import { runCapabilityRecipeOnNode } from '../runner/capabilityRecipeController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  findCapabilityRecipe,
  listCapabilityRecipesForAgent,
  selectCapabilityRecipeTarget,
} from './capabilityRecipeAgent'
import { resolveCanvasToolNodeId } from './clientIdRegistry'
import {
  listCreativeResourcesForAgent,
  saveNodeAsCreativeResource,
  validateRecipeResourceSelection,
} from './creativeResourceActions'
import { readGenerationCanvasSnapshot } from './generationCanvasTools'
import { handoffModel3dNode } from './model3dHandoff'
import { listAvailableModelsForAgent } from './availableModels'
import { createWorkbenchMultiviewSubjectComparator } from '../quality/multiviewSubjectVisionReviewService'
import {
  listVisionReviewModelOptions,
  type VisionReviewModelOption,
} from '../quality/visionReviewModels'

type CapabilityToolContext = {
  toolName: string
  record: Record<string, unknown>
  gesture?: CanvasGestureContext
  mutate: <T>(fn: () => T) => T
  project: ProjectExecutionContext
  planOnly?: boolean
  confirmRecipe?: (plan: RecipeRunPlan) => Promise<boolean>
}

export type CapabilityToolResult =
  | { handled: false }
  | { handled: true; value: unknown }

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function recipeParams(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string | number | boolean] => {
      const item = entry[1]
      return typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
    }),
  )
}

function recipeOutputs(value: unknown): RecipeOutputDescriptor[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const id = trimmed(item.id) || `output-${index + 1}`
    const label = trimmed(item.label) || `结果 ${index + 1}`
    return [{
      id,
      label,
      ...(typeof item.azimuth === 'number' && Number.isFinite(item.azimuth) ? { azimuth: item.azimuth } : {}),
      ...(typeof item.elevation === 'number' && Number.isFinite(item.elevation) ? { elevation: item.elevation } : {}),
      ...(trimmed(item.shotSize) ? { shotSize: trimmed(item.shotSize) } : {}),
    }]
  })
}

async function requestedVisionReview(
  value: unknown,
  recipeId: string,
): Promise<VisionReviewModelOption | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!['image.multiview.grid9', 'image.multiview.custom'].includes(recipeId)) {
    throw new Error('自动视觉复核只支持九宫格或自定义机位配方')
  }
  const requested = value as Record<string, unknown>
  const vendorKey = trimmed(requested.vendorKey)
  const modelKey = trimmed(requested.modelKey)
  if (!vendorKey || !modelKey) throw new Error('自动视觉复核缺少视觉模型')
  const options = await listVisionReviewModelOptions()
  const selected = options.find((model) => model.vendorKey === vendorKey && model.modelKey === modelKey)
  if (!selected) throw new Error('自动视觉复核模型未连接或不支持图片输入')
  return selected
}

function runId(): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `recipe-run-${suffix}`
}

function assertRecipeSource(recipe: ReturnType<typeof findCapabilityRecipe>, sourceNodeId: string): void {
  const source = readGenerationCanvasSnapshot().nodes.find((node) => node.id === sourceNodeId)
  if (!source) throw new Error('node_not_found:配方源节点不存在')
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_image' && slot.min > 0) && source.result?.type !== 'image') {
    throw new Error(`配方「${recipe.label}」需要源节点先生成一张图片`)
  }
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_video' && slot.min > 0) && source.result?.type !== 'video') {
    throw new Error(`配方「${recipe.label}」需要源节点先生成一个视频`)
  }
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_model3d' && slot.min > 0) && source.result?.type !== 'model3d') {
    throw new Error(`配方「${recipe.label}」需要源节点先生成一个 3D 模型`)
  }
  if (recipe.inputSlots.some((slot) => slot.kind === 'text' && slot.min > 0) && !trimmed(source.prompt)) {
    throw new Error(`配方「${recipe.label}」需要源节点有文字提示词`)
  }
}

async function applyRecipe(
  record: Record<string, unknown>,
  context: Pick<CapabilityToolContext, 'project' | 'confirmRecipe' | 'planOnly'>,
  gesture?: CanvasGestureContext,
): Promise<unknown> {
  context.project.assertCurrent()
  const sourceNodeId = resolveCanvasToolNodeId(trimmed(record.sourceNodeId))
  if (!sourceNodeId) throw new Error('sourceNodeId is required')
  const canvas = readGenerationCanvasSnapshot()
  const source = canvas.nodes.find((node) => node.id === sourceNodeId)
  if (!source) throw new Error('node_not_found:配方源节点不存在')

  const recipe = findCapabilityRecipe(trimmed(record.recipeId))
  const requestedResourceIds = Array.isArray(record.resourceIds)
    ? record.resourceIds.map(trimmed).filter(Boolean)
    : []
  const resourceIds = validateRecipeResourceSelection(recipe, canvas.nodes, requestedResourceIds)
  assertRecipeSource(recipe, sourceNodeId)

  const models = await listAvailableModelsForAgent()
  context.project.assertCurrent()
  const sourceMeta = source.meta ?? {}
  const sourceArchetype = sourceMeta.archetype && typeof sourceMeta.archetype === 'object'
    ? sourceMeta.archetype as Record<string, unknown>
    : {}
  const target = selectCapabilityRecipeTarget(recipe, models, {
    modelKey: trimmed(record.modelKey) || undefined,
    variantId: trimmed(record.variantId) || undefined,
    modeId: trimmed(record.modeId) || undefined,
    sourceModelKey: trimmed(sourceMeta.modelKey) || undefined,
    sourceVariantId: trimmed(sourceArchetype.variantId) || undefined,
    sourceModeId: trimmed(sourceArchetype.modeId) || undefined,
  })
  const outputs = recipeOutputs(record.outputs)
  const requestedOutputs = typeof record.requestedOutputs === 'number' && Number.isFinite(record.requestedOutputs)
    ? Math.max(1, Math.floor(record.requestedOutputs))
    : outputs.length || undefined
  const defaults = Object.fromEntries(
    recipe.controls
      .filter((control) => control.defaultValue !== undefined)
      .map((control) => [control.key, control.defaultValue]),
  ) as Record<string, string | number | boolean>
  const plan = buildRecipeRunPlan({
    id: runId(),
    recipe,
    archetype: target.archetype,
    modeId: target.modeId,
    vendorKey: target.vendorKey,
    modelKey: target.modelKey,
    variantId: target.variantId,
    sourceNodeIds: [sourceNodeId],
    resourceIds,
    params: { ...defaults, ...recipeParams(record.params) },
    ...(requestedOutputs ? { requestedOutputs } : {}),
    ...(outputs.length ? { outputs } : {}),
    createdAt: Date.now(),
    ...(gesture?.proposalId || gesture?.txnId ? { agentRunId: gesture?.proposalId ?? gesture?.txnId } : {}),
  })
  if (context.planOnly) return { planned: true, plan }
  const visionReview = await requestedVisionReview(record.visionReview, plan.recipeId)
  context.project.assertCurrent()
  if (context.confirmRecipe) {
    const confirmed = await context.confirmRecipe(plan)
    context.project.assertCurrent()
    if (!confirmed) return { accepted: false, declined: true }
  }

  let targetNodeId = ''
  const run = runCapabilityRecipeOnNode(sourceNodeId, plan, {
    grantFactory: (nodeId, maxAttemptsPerNode) => {
      context.project.assertCurrent()
      return mintSpendGrant([nodeId], maxAttemptsPerNode)
    },
    signal: context.project.signal,
    concurrency: Math.min(2, plan.taskCount),
    onTargetCreated: (nodeId) => { targetNodeId = nodeId },
    ...(visionReview ? {
      compareMultiviewSubjects: createWorkbenchMultiviewSubjectComparator({
        model: visionReview,
        sessionId: plan.id,
        projectId: context.project.binding.projectId,
      }),
    } : {}),
  })
  void run.catch((error) => {
    if (!targetNodeId || context.project.signal.aborted) return
    context.project.assertCurrent()
    const message = error instanceof Error ? error.message : String(error)
    const store = useGenerationCanvasStore.getState()
    if (store.nodes.some((node) => node.id === targetNodeId)) store.setNodeStatus(targetNodeId, 'error', message)
  })
  return {
    accepted: true,
    planId: plan.id,
    recipeId: plan.recipeId,
    targetNodeId,
    outputCount: plan.outputCount,
    taskCount: plan.taskCount,
    model: plan.model,
    ...(visionReview ? {
      visionReview: {
        vendorKey: visionReview.vendorKey,
        modelKey: visionReview.modelKey,
        calls: 1,
      },
    } : {}),
  }
}

export async function tryApplyCapabilityToolCall({
  toolName,
  record,
  gesture,
  mutate,
  project,
  planOnly,
  confirmRecipe,
}: CapabilityToolContext): Promise<CapabilityToolResult> {
  if (!['list_capability_recipes', 'apply_capability_recipe', 'save_creative_resource', 'handoff_model3d'].includes(toolName)) {
    return { handled: false }
  }
  if (!isCapabilityRecipesEnabled()) throw new Error('创作能力配方实验功能尚未在本机启用')
  project.assertCurrent()

  if (toolName === 'list_capability_recipes') {
    const [models, visionReviewModels] = await Promise.all([
      listAvailableModelsForAgent(),
      listVisionReviewModelOptions(),
    ])
    project.assertCurrent()
    const nodes = readGenerationCanvasSnapshot().nodes
    return {
      handled: true,
      value: {
        recipes: listCapabilityRecipesForAgent(models),
        resources: listCreativeResourcesForAgent(nodes),
        visionReviewModels,
      },
    }
  }
  if (toolName === 'apply_capability_recipe') {
    return { handled: true, value: await applyRecipe(record, { project, planOnly, confirmRecipe }, gesture) }
  }
  if (toolName === 'save_creative_resource') {
    const sourceNodeId = resolveCanvasToolNodeId(trimmed(record.sourceNodeId))
    const kind = record.kind === 'effect' || record.kind === 'identity' || record.kind === 'palette'
      ? record.kind
      : 'style'
    const rawLicense = record.license && typeof record.license === 'object'
      ? record.license as Record<string, unknown>
      : {}
    const commercialUse = rawLicense.commercialUse === 'allowed' || rawLicense.commercialUse === 'restricted'
      ? rawLicense.commercialUse
      : 'unknown'
    return {
      handled: true,
      value: mutate(() => saveNodeAsCreativeResource(sourceNodeId, {
        kind,
        label: trimmed(record.label),
        description: trimmed(record.description) || undefined,
        promptTokens: Array.isArray(record.promptTokens) ? record.promptTokens.map(trimmed).filter(Boolean) : [],
        license: {
          commercialUse,
          ...(trimmed(rawLicense.source) ? { source: trimmed(rawLicense.source) } : {}),
          ...(trimmed(rawLicense.license) ? { license: trimmed(rawLicense.license) } : {}),
          ...(trimmed(rawLicense.attribution) ? { attribution: trimmed(rawLicense.attribution) } : {}),
        },
      })),
    }
  }

  const sourceNodeId = resolveCanvasToolNodeId(trimmed(record.sourceNodeId))
  if (!sourceNodeId) throw new Error('sourceNodeId is required')
  const requestedTargetNodeId = trimmed(record.targetNodeId)
  const targetNodeId = requestedTargetNodeId ? resolveCanvasToolNodeId(requestedTargetNodeId) : undefined
  return {
    handled: true,
    value: handoffModel3dNode({
      project,
      sourceNodeId,
      target: record.target === 'vibingDirector' ? 'vibingDirector' : 'scene3d',
      ...(targetNodeId ? { targetNodeId } : {}),
      ...(trimmed(record.license) ? { license: trimmed(record.license) } : {}),
      mutate,
      persist: async () => {
        project.assertCurrent()
        await persistActiveWorkbenchProjectNow()
        project.assertCurrent()
      },
    }),
  }
}
