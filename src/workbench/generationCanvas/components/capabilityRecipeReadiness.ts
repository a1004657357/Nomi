import i18n from "../../../i18n"
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
  if (kind === 'style') return i18n.t("customWorkflow.styleOrPalette")
  if (kind === 'identity') return i18n.t("customWorkflow.identity")
  return i18n.t("customWorkflow.effect")
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
  if (!source) return { ready: false, message: i18n.t("customWorkflow.selectASourceNodeFirst") }
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_image' && slot.min > 0) && source.result?.type !== 'image') {
    return { ready: false, message: i18n.t("customWorkflow.theSourceNodeNeedsAGeneratedOrImported13") }
  }
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_video' && slot.min > 0) && source.result?.type !== 'video') {
    return { ready: false, message: i18n.t("customWorkflow.theSourceNodeNeedsAGeneratedOrImported12") }
  }
  if (recipe.inputSlots.some((slot) => slot.kind === 'source_model3d' && slot.min > 0) && source.result?.type !== 'model3d') {
    return { ready: false, message: i18n.t("customWorkflow.theSourceNodeNeedsAGeneratedOrImported") }
  }
  if (recipe.inputSlots.some((slot) => slot.kind === 'text' && slot.min > 0) && !source.prompt?.trim()) {
    return { ready: false, message: i18n.t("customWorkflow.theSourceNodeNeedsATextPrompt") }
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
    if (count < limits.min) return { ready: false, message: i18n.t("customWorkflow.selectAtLeastResources", { v0: limits.min, v1: resourceLabel(kind) }) }
    if (count > limits.max) return { ready: false, message: i18n.t("customWorkflow.selectAtMostResources", { v0: limits.max, v1: resourceLabel(kind) }) }
  }

  return { ready: true }
}
