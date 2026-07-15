export type CustomTextModelUpsert = {
  vendorKey: string
  modelKey: string
  kind: 'text'
  enabled: true
}

export function buildCustomTextModelUpsert(vendorKey: string, input: string): CustomTextModelUpsert | null {
  const cleanVendorKey = vendorKey.trim()
  const modelKey = input.trim()
  if (!cleanVendorKey || !modelKey) return null
  return { vendorKey: cleanVendorKey, modelKey, kind: 'text', enabled: true }
}
