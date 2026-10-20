import {
  BUILTIN_CAPABILITY_RECIPES,
  resolveRecipeCompatibility,
  type CapabilityRecipe,
  type RecipeCompatibility,
} from '../../../config/capabilityRecipes'
import {
  resolveArchetypeForModel,
  specializeArchetypeForVariant,
  type ModelArchetype,
} from '../../../../electron/shared/modelArchetypes'
import type { ModelCapabilityTier } from '../../../../electron/shared/modelArchetypes/types'
import type { AgentModelEntry } from './availableModels'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'

export type AgentRecipeCompatibleModel = {
  vendorKey: string
  modelKey: string
  modelLabel: string
  archetypeId: string
  variantId?: string
  modeId: string
  modeLabel: string
  tier: ModelCapabilityTier
  maxOutputs?: number
  params: ModelParameterControl[]
}

export type AgentCapabilityRecipe = Pick<
  CapabilityRecipe,
  'id' | 'version' | 'label' | 'category' | 'inputSlots' | 'output' | 'controls' | 'execution'
> & {
  compatibleModels: AgentRecipeCompatibleModel[]
}

export type CapabilityRecipeTarget = AgentRecipeCompatibleModel & {
  archetype: ModelArchetype
}

export type CapabilityRecipeTargetPreference = {
  modelKey?: string
  variantId?: string
  modeId?: string
  sourceModelKey?: string
  sourceVariantId?: string
  sourceModeId?: string
}

const TIER_ORDER: Record<ModelCapabilityTier, number> = {
  native: 0,
  compatible: 1,
  experimental: 2,
}

function compatibleTargets(
  recipe: CapabilityRecipe,
  entries: readonly AgentModelEntry[],
): CapabilityRecipeTarget[] {
  const targets: CapabilityRecipeTarget[] = []
  for (const entry of entries) {
    const vendorKey = entry.vendor?.trim()
    if (!vendorKey) continue
    const archetype = resolveArchetypeForModel({
      modelKey: entry.modelId,
      modelAlias: entry.modelAlias,
      vendorKey,
      meta: { archetypeId: entry.archetypeId },
    })
    if (!archetype) continue
    const variants = entry.variants ?? []
    const candidates = variants.length
      ? variants.map((variant) => ({
          variantId: variant.id,
          variantLabel: variant.label,
          archetype: specializeArchetypeForVariant(archetype, variant.id),
          modes: specializeArchetypeForVariant(archetype, variant.id).modes.filter((mode) => {
            const allowed = archetype.variants?.find((item) => item.id === variant.id)?.supportedModeIds
            return !allowed || allowed.includes(mode.id)
          }).map((mode) => ({ modeId: mode.id, vendorTerm: mode.vendorTerm, params: mode.params })),
        }))
      : [{ variantId: undefined, variantLabel: undefined, archetype, modes: entry.modes }]
    for (const candidate of candidates) {
      for (const mode of candidate.modes) {
        const compatibility: RecipeCompatibility = resolveRecipeCompatibility(
          recipe,
          candidate.archetype,
          mode.modeId,
        )
        if (!compatibility.supported) continue
        targets.push({
          vendorKey,
          modelKey: entry.modelId,
          modelLabel: candidate.variantLabel ? `${entry.label} · ${candidate.variantLabel}` : entry.label,
          archetypeId: archetype.id,
          ...(candidate.variantId ? { variantId: candidate.variantId } : {}),
          modeId: mode.modeId,
          modeLabel: mode.vendorTerm,
          tier: compatibility.tier,
          ...(typeof compatibility.maxOutputs === 'number' ? { maxOutputs: compatibility.maxOutputs } : {}),
          params: mode.params.map((control) => ({ ...control })),
          archetype: candidate.archetype,
        })
      }
    }
  }
  return targets.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
}

export function listCapabilityRecipesForAgent(
  entries: readonly AgentModelEntry[],
): AgentCapabilityRecipe[] {
  return BUILTIN_CAPABILITY_RECIPES.map((recipe) => ({
    id: recipe.id,
    version: recipe.version,
    label: recipe.label,
    category: recipe.category,
    inputSlots: recipe.inputSlots.map((slot) => ({ ...slot })),
    output: { ...recipe.output },
    controls: recipe.controls.map((control) => ({ ...control })),
    execution: { ...recipe.execution },
    compatibleModels: compatibleTargets(recipe, entries).map(({ archetype: _archetype, ...target }) => target),
  }))
}

export function selectCapabilityRecipeTarget(
  recipe: CapabilityRecipe,
  entries: readonly AgentModelEntry[],
  preference: CapabilityRecipeTargetPreference = {},
): CapabilityRecipeTarget {
  const targets = compatibleTargets(recipe, entries)
  const modelKey = preference.modelKey?.trim()
  const variantId = preference.variantId?.trim()
  const modeId = preference.modeId?.trim()

  if ((variantId || modeId) && !modelKey) {
    throw new Error('指定 variantId 或 modeId 时必须同时指定 modelKey')
  }
  if (modelKey) {
    const matchingModel = targets.filter((target) => (
      target.modelKey === modelKey && (!variantId || target.variantId === variantId)
    ))
    if (matchingModel.length === 0) {
      const suffix = variantId ? `的型号「${variantId}」` : ''
      throw new Error(`模型「${modelKey}」${suffix}与配方「${recipe.label}」不兼容，或供应商未连接`)
    }
    if (modeId) {
      const exact = matchingModel.find((target) => target.modeId === modeId)
      if (!exact) throw new Error(`模型「${modelKey}」的模式「${modeId}」与配方「${recipe.label}」不兼容`)
      return exact
    }
    return matchingModel[0]
  }

  const sourceModelKey = preference.sourceModelKey?.trim()
  const sourceVariantId = preference.sourceVariantId?.trim()
  const sourceModeId = preference.sourceModeId?.trim()
  if (sourceModelKey) {
    const sameModel = targets.filter((target) => (
      target.modelKey === sourceModelKey && (!sourceVariantId || target.variantId === sourceVariantId)
    ))
    const exactSource = sourceModeId
      ? sameModel.find((target) => target.modeId === sourceModeId)
      : undefined
    if (exactSource) return exactSource
    if (sameModel[0]) return sameModel[0]
  }

  const automatic = targets[0]
  if (!automatic) throw new Error(`当前没有已连接且兼容「${recipe.label}」的模型`)
  return automatic
}

export function findCapabilityRecipe(recipeId: string): CapabilityRecipe {
  const recipe = BUILTIN_CAPABILITY_RECIPES.find((candidate) => candidate.id === recipeId)
  if (!recipe) throw new Error(`未知创作能力配方：${recipeId}`)
  return recipe
}
