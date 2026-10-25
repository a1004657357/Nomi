import type {
  CapabilityRecipe,
  CapabilityRecipeInputKind,
  CapabilityRecipeInputSlot,
  CreativeResource,
} from '../../../config/capabilityRecipes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

export type SaveCreativeResourceInput = {
  kind: CreativeResource['kind']
  label: string
  description?: string
  promptTokens: string[]
  license: NonNullable<CreativeResource['license']>
}

export type AgentCreativeResourceSummary = {
  id: string
  kind: CreativeResource['kind']
  label: string
  description?: string
  promptTokens: string[]
  commercialUse: NonNullable<CreativeResource['license']>['commercialUse']
  hasAsset: boolean
}

type RecipeResourceInputKind = Extract<CapabilityRecipeInputKind, 'style' | 'identity' | 'effect'>
type RecipeResourceInputSlot = CapabilityRecipeInputSlot & { kind: RecipeResourceInputKind }

const RESOURCE_INPUT_KINDS = new Set<CapabilityRecipeInputKind>(['style', 'identity', 'effect'])

function isRecipeResourceInputKind(kind: CapabilityRecipeInputKind): kind is RecipeResourceInputKind {
  return RESOURCE_INPUT_KINDS.has(kind)
}

function acceptedResourceKinds(kind: RecipeResourceInputKind): readonly CreativeResource['kind'][] {
  if (kind === 'style') return ['style', 'palette']
  return [kind]
}

export function listCreativeResourcesForAgent(
  nodes: readonly GenerationCanvasNode[],
): AgentCreativeResourceSummary[] {
  return nodes.flatMap((node) => {
    const resource = node.creativeResource
    if (!resource) return []
    return [{
      id: resource.id,
      kind: resource.kind,
      label: resource.label,
      ...(resource.description ? { description: resource.description } : {}),
      promptTokens: [...resource.promptTokens],
      commercialUse: resource.license?.commercialUse ?? 'unknown',
      hasAsset: resource.assetIds.length > 0 || Boolean(node.result?.url),
    }]
  }).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}

/** Resolve and validate resource ids before any model selection or paid task is created. */
export function validateRecipeResourceSelection(
  recipe: CapabilityRecipe,
  nodes: readonly GenerationCanvasNode[],
  requestedIds: readonly string[],
): string[] {
  const resourceSlots = recipe.inputSlots.filter(
    (slot): slot is RecipeResourceInputSlot => isRecipeResourceInputKind(slot.kind),
  )
  const ids = Array.from(new Set(requestedIds.map((id) => id.trim()).filter(Boolean)))

  if (ids.length > 0 && resourceSlots.length === 0) {
    throw new Error(`配方「${recipe.label}」不接受创作资源`)
  }

  const resolved: Array<{ nodeId: string; resource: CreativeResource }> = []
  const resolvedNodeIds = new Set<string>()
  for (const id of ids) {
    const node = nodes.find((candidate) => candidate.id === id || candidate.creativeResource?.id === id)
    if (!node?.creativeResource) throw new Error(`创作资源不存在：${id}`)
    if (resolvedNodeIds.has(node.id)) continue
    resolvedNodeIds.add(node.id)
    resolved.push({ nodeId: node.id, resource: node.creativeResource })
  }

  for (const entry of resolved) {
    const accepted = resourceSlots.some((slot) => acceptedResourceKinds(slot.kind).includes(entry.resource.kind))
    if (accepted) continue
    const expected = Array.from(new Set(resourceSlots.flatMap((slot) => acceptedResourceKinds(slot.kind)))).join('/')
    throw new Error(`配方「${recipe.label}」仅接受 ${expected} 资源，收到 ${entry.resource.kind}`)
  }

  const slotTotals = new Map<RecipeResourceInputKind, { min: number; max: number }>()
  for (const slot of resourceSlots) {
    const current = slotTotals.get(slot.kind) ?? { min: 0, max: 0 }
    slotTotals.set(slot.kind, { min: current.min + slot.min, max: current.max + slot.max })
  }
  for (const [kind, limits] of slotTotals) {
    const acceptedKinds = acceptedResourceKinds(kind)
    const count = resolved.filter((entry) => acceptedKinds.includes(entry.resource.kind)).length
    const label = acceptedKinds.join('/')
    if (count < limits.min) {
      throw new Error(`配方「${recipe.label}」至少需要 ${limits.min} 个 ${label} 资源`)
    }
    if (count > limits.max) {
      throw new Error(`配方「${recipe.label}」最多接受 ${limits.max} 个 ${label} 资源`)
    }
  }

  return resolved.map((entry) => entry.resource.id)
}

export function saveNodeAsCreativeResource(
  sourceNodeId: string,
  input: SaveCreativeResourceInput,
  now = Date.now(),
): { nodeId: string; resource: CreativeResource } {
  const store = useGenerationCanvasStore.getState()
  const source = store.nodes.find((node) => node.id === sourceNodeId)
  if (!source) throw new Error('源节点不存在')
  if (!source.result?.url) throw new Error('请先生成或导入一个可用素材，再保存为创作资源')
  const label = input.label.trim()
  if (!label) throw new Error('资源名称不能为空')

  const created = store.addNode({
    kind: 'resource',
    title: label,
    prompt: input.promptTokens.join(', '),
    categoryId: 'scene',
    position: { x: source.position.x + 380, y: source.position.y },
    select: true,
    meta: { resourceSourceNodeId: source.id },
  })
  const assetId = source.result.assetId || source.result.assetRefId || source.result.id
  const resource: CreativeResource = {
    id: created.id,
    kind: input.kind,
    label,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    promptTokens: Array.from(new Set(input.promptTokens.map((token) => token.trim()).filter(Boolean))),
    assetIds: assetId ? [assetId] : [],
    license: { ...input.license },
    createdAt: now,
    updatedAt: now,
  }
  useGenerationCanvasStore.getState().updateNode(created.id, {
    creativeResource: resource,
    result: { ...source.result },
    history: [{ ...source.result }],
    status: 'success',
  })
  return { nodeId: created.id, resource }
}
