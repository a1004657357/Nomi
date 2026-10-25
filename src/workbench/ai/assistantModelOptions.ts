import type { ModelCatalogModelDto } from '../api/modelCatalogApi'
import type { AssistantModelPref } from './assistantModelPref'

export function assistantModelOptionValue(model: Pick<ModelCatalogModelDto, 'vendorKey' | 'modelKey'>): string {
  return `${encodeURIComponent(model.vendorKey)}:${encodeURIComponent(model.modelKey)}`
}

export function resolveAssistantModelSelection(
  models: Array<Pick<ModelCatalogModelDto, 'vendorKey' | 'modelKey'>>,
  pref: AssistantModelPref,
): string {
  if (!pref?.modelKey) return ''
  const exact = models.find((m) => m.vendorKey === pref.vendorKey && m.modelKey === pref.modelKey)
  if (exact) return assistantModelOptionValue(exact)
  const legacy = models.find((m) => m.modelKey === pref.modelKey)
  return legacy ? assistantModelOptionValue(legacy) : ''
}

export function assistantModelOptionLabel(
  model: Pick<ModelCatalogModelDto, 'vendorKey' | 'modelKey' | 'labelZh'>,
  allModels: Array<Pick<ModelCatalogModelDto, 'modelKey'>>,
): string {
  const base = model.labelZh || model.modelKey
  const duplicated = allModels.filter((m) => m.modelKey === model.modelKey).length > 1
  return duplicated ? `${base} · ${model.vendorKey}` : base
}
