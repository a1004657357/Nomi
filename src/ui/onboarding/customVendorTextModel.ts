export type CustomTextModelUpsert = {
  vendorKey: string
  modelKey: string
  kind: 'text'
  enabled: true
  meta?: {
    supportsImageInput: true
  }
}

export function buildCustomTextModelUpsert(
  vendorKey: string,
  input: string,
  options: { supportsImageInput?: boolean } = {},
): CustomTextModelUpsert | null {
  const cleanVendorKey = vendorKey.trim()
  const modelKey = input.trim()
  if (!cleanVendorKey || !modelKey) return null
  return {
    vendorKey: cleanVendorKey,
    modelKey,
    kind: 'text',
    enabled: true,
    ...(options.supportsImageInput ? { meta: { supportsImageInput: true as const } } : {}),
  }
}
