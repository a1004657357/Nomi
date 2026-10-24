import i18n from "../../../i18n"
import type {
  CapabilityRecipe,
  CapabilityRecipeInputKind,
  CreativeResource,
} from '../../../config/capabilityRecipes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isCreativeResourceCandidate } from '../components/capabilityRecipeReadiness'

type SourceInputKind = Extract<
  CapabilityRecipeInputKind,
  'text' | 'source_image' | 'source_video' | 'source_model3d' | 'mask'
>
type ResourceInputKind = Extract<CapabilityRecipeInputKind, 'style' | 'identity' | 'effect'>

export type CanvasSkillRecipeBinding = {
  source: GenerationCanvasNode | null
  resources: GenerationCanvasNode[]
  ready: boolean
  statusLabel: string
}

const SOURCE_LABELS: Record<SourceInputKind, string> = {
  text: '文字',
  get source_image() { return i18n.t("customWorkflow.image") },
  source_video: '视频',
  source_model3d: '3D',
  mask: '蒙版',
}

const RESOURCE_LABELS: Record<ResourceInputKind, string> = {
  get style() { return i18n.t("customWorkflow.styleOrPalette") },
  get identity() { return i18n.t("customWorkflow.identity") },
  get effect() { return i18n.t("customWorkflow.effect") },
}

function isSourceInputKind(kind: CapabilityRecipeInputKind): kind is SourceInputKind {
  return ['text', 'source_image', 'source_video', 'source_model3d', 'mask'].includes(kind)
}

function sourceMatches(kind: SourceInputKind, node: GenerationCanvasNode): boolean {
  if (node.creativeResource) return false
  if (kind === 'text') return Boolean(node.prompt?.trim() || node.result?.text?.trim())
  if (kind === 'source_image' || kind === 'mask') return node.result?.type === 'image'
  if (kind === 'source_video') return node.result?.type === 'video'
  return node.result?.type === 'model3d'
}

function acceptedResourceKinds(kind: ResourceInputKind): readonly CreativeResource['kind'][] {
  return kind === 'style' ? ['style', 'palette'] : [kind]
}

function uniqueKinds(kinds: readonly SourceInputKind[]): SourceInputKind[] {
  return Array.from(new Set(kinds))
}

function sourceBinding(
  recipe: CapabilityRecipe,
  candidates: readonly GenerationCanvasNode[],
): { source: GenerationCanvasNode | null; missing: string[] } {
  const sourceSlots = recipe.inputSlots.filter(
    (slot): slot is typeof slot & { kind: SourceInputKind } => isSourceInputKind(slot.kind),
  )
  const requiredKinds = uniqueKinds(sourceSlots.filter((slot) => slot.min > 0).map((slot) => slot.kind))
  if (requiredKinds.length) {
    const source = candidates.find((node) => requiredKinds.every((kind) => sourceMatches(kind, node))) ?? null
    return {
      source,
      missing: source ? [] : requiredKinds.map((kind) => SOURCE_LABELS[kind]),
    }
  }

  const optionalKinds = uniqueKinds(sourceSlots.map((slot) => slot.kind))
  const source = candidates.find((node) => optionalKinds.some((kind) => sourceMatches(kind, node))) ?? null
  if (source) return { source, missing: [] }
  const label = optionalKinds.length
    ? optionalKinds.map((kind) => SOURCE_LABELS[kind]).join('或')
    : '源节点'
  return { source: null, missing: [label] }
}

export function resolveCanvasSkillRecipeBinding(
  recipe: CapabilityRecipe,
  connectedNodes: readonly GenerationCanvasNode[],
): CanvasSkillRecipeBinding {
  const sourceResult = sourceBinding(recipe, connectedNodes)
  const resourceCandidates = connectedNodes.filter((node) => isCreativeResourceCandidate(recipe, node))
  const resources: GenerationCanvasNode[] = []
  const missing = [...sourceResult.missing]
  const invalid: string[] = []

  for (const kind of ['style', 'identity', 'effect'] as const) {
    const slots = recipe.inputSlots.filter((slot) => slot.kind === kind)
    if (!slots.length) continue
    const min = slots.reduce((sum, slot) => sum + slot.min, 0)
    const max = slots.reduce((sum, slot) => sum + slot.max, 0)
    const acceptedKinds = acceptedResourceKinds(kind)
    const matches = resourceCandidates.filter(
      (node) => node.creativeResource && acceptedKinds.includes(node.creativeResource.kind),
    )
    for (const node of matches) if (!resources.some((item) => item.id === node.id)) resources.push(node)
    if (matches.length < min) missing.push(RESOURCE_LABELS[kind])
    if (matches.length > max) invalid.push(`${RESOURCE_LABELS[kind]}最多 ${max} 个`)
  }

  const ready = Boolean(sourceResult.source) && missing.length === 0 && invalid.length === 0
  return {
    source: sourceResult.source,
    resources,
    ready,
    statusLabel: ready
      ? i18n.t("customWorkflow.ready")
      : invalid.length
        ? invalid.join(' / ')
        : i18n.t("customWorkflow.missing", { v0: missing.join(' / ') }),
  }
}
