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

function executableVendor(vendor: ModelCatalogVendorDto | undefined): vendor is ModelCatalogVendorDto {
  return Boolean(
    vendor?.enabled
    && (vendor.authType === 'none' || vendor.hasApiKey === true),
  )
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
      || !model.enabled
      || !executableVendor(vendor)
      || !modelSupportsImageInput(model.modelKey, model.modelAlias, model.meta)
    ) {
      return []
    }
    const modelLabel = model.labelZh || model.modelAlias || model.modelKey
    return [{
      id: JSON.stringify([model.vendorKey, model.modelKey]),
      vendorKey: model.vendorKey,
      modelKey: model.modelKey,
      label: `${modelLabel} · ${vendor.name}`,
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
