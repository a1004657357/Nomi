import { modelSupportsImageInput } from '../../../config/textModelCapabilities'
import {
  listWorkbenchModelCatalogModels,
  listWorkbenchModelCatalogVendors,
  type ModelCatalogModelDto,
  type ModelCatalogVendorDto,
} from '../../api/modelCatalogApi'

export type VisionReviewModelOption = {
  id: string
  vendorKey: string
  modelKey: string
  label: string
}

export function visionReviewModelOptions(
  models: readonly ModelCatalogModelDto[],
  vendors: readonly ModelCatalogVendorDto[],
): VisionReviewModelOption[] {
  const vendorByKey = new Map(vendors.map((vendor) => [vendor.key, vendor]))
  return models.flatMap((model): VisionReviewModelOption[] => {
    const vendor = vendorByKey.get(model.vendorKey)
    if (
      model.kind !== 'text'
      || model.availability?.usable !== true
      || !modelSupportsImageInput(model.modelKey, model.modelAlias, model.meta)
    ) {
      return []
    }
    const modelLabel = model.labelZh || model.modelAlias || model.modelKey
    return [{
      id: JSON.stringify([model.vendorKey, model.modelKey]),
      vendorKey: model.vendorKey,
      modelKey: model.modelKey,
      label: `${modelLabel} · ${vendor?.name || model.vendorKey}`,
    }]
  }).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

export async function listVisionReviewModelOptions(): Promise<VisionReviewModelOption[]> {
  const [models, vendors] = await Promise.all([
    listWorkbenchModelCatalogModels({ kind: 'text', enabled: true }),
    listWorkbenchModelCatalogVendors(),
  ])
  return visionReviewModelOptions(models, vendors)
}
