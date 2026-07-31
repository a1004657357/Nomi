import type { CapabilityRecipeInputKind, CapabilityRecipeInputSlot, CreativeResource } from '../../../config/capabilityRecipes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

type ResourceInputKind = Extract<CapabilityRecipeInputKind, 'style' | 'identity' | 'effect'>
type RecipeInputContract = { inputSlots: readonly CapabilityRecipeInputSlot[] }

function isResourceInputKind(kind: CapabilityRecipeInputKind): kind is ResourceInputKind {
  return kind === 'style' || kind === 'identity' || kind === 'effect'
}

function acceptedKinds(kind: ResourceInputKind): readonly CreativeResource['kind'][] {
  return kind === 'style' ? ['style', 'palette'] : [kind]
}

function resourceLabel(kind: ResourceInputKind): string {
  if (kind === 'style') return '风格或色板'
  if (kind === 'identity') return '身份'
  return '效果'
}

export function isCreativeResourceCandidate(
  recipe: RecipeInputContract,
  node: GenerationCanvasNode,
): boolean {
  const resource = node.creativeResource
  if (!resource) return false
  return recipe.inputSlots.some((slot) => (
    isResourceInputKind(slot.kind) && acceptedKinds(slot.kind).includes(resource.kind)
  ))
}

export function capabilityRecipeInputReadiness(
  recipe: RecipeInputContract,
  source: GenerationCanvasNode | null,
  selectedResources: readonly GenerationCanvasNode[],
): { ready: true } | { ready: false; message: string } {
  if (!source) return { ready: false, message: '请先选择一个源节点' }
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_image' && slot.min > 0) && source.result?.type !== 'image') {
    return { ready: false, message: '源节点需要一张已生成或导入的图片' }
  }
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_video' && slot.min > 0) && source.result?.type !== 'video') {
    return { ready: false, message: '源节点需要一个已生成或导入的视频' }
  }
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_model3d' && slot.min > 0) && source.result?.type !== 'model3d') {
    return { ready: false, message: '源节点需要一个已生成或导入的 3D 模型' }
  }
  if (recipe.inputSlots.some((slot) => slot.kind === 'text' && slot.min > 0) && !source.prompt?.trim()) {
    return { ready: false, message: '源节点需要文字提示词' }
  }

  const totals = new Map<ResourceInputKind, { min: number; max: number }>()
  for (const slot of recipe.inputSlots) {
    if (!isResourceInputKind(slot.kind)) continue
    const current = totals.get(slot.kind) ?? { min: 0, max: 0 }
    totals.set(slot.kind, { min: current.min + slot.min, max: current.max + slot.max })
  }
  for (const [kind, limits] of totals) {
    const kinds = acceptedKinds(kind)
    const count = selectedResources.filter((node) => (
      node.creativeResource && kinds.includes(node.creativeResource.kind)
    )).length
    if (count < limits.min) return { ready: false, message: `至少选择 ${limits.min} 个${resourceLabel(kind)}资源` }
    if (count > limits.max) return { ready: false, message: `最多选择 ${limits.max} 个${resourceLabel(kind)}资源` }
  }

  return { ready: true }
}
