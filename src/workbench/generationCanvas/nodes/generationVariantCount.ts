export const GENERATION_VARIANT_COUNTS = [1, 2, 3, 4] as const

export type GenerationVariantCount = (typeof GENERATION_VARIANT_COUNTS)[number]

export function parseGenerationVariantCount(value: string): GenerationVariantCount {
  const parsed = Number(value)
  return GENERATION_VARIANT_COUNTS.find((count) => count === parsed) ?? 1
}
