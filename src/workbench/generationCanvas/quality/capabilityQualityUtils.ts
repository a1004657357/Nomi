import type {
  GenerationNodeResult,
  GenerationQualityCheck,
  GenerationQualityStatus,
} from '../model/generationCanvasTypes'
import type { CapabilityRecipeImageInspection } from '../runner/capabilityRecipePostprocess'

export function roundQualityMetric(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function hasMediaLocator(result: GenerationNodeResult | undefined): boolean {
  const candidates = result?.type === 'image'
    ? [result.url, result.providerUrl, result.thumbnailUrl]
    : [result?.url, result?.providerUrl]
  return Boolean(
    result
    && candidates.some(
      (value) => typeof value === 'string' && value.trim().length > 0,
    ),
  )
}

export function qualityStatusFromChecks(
  checks: readonly GenerationQualityCheck[],
): GenerationQualityStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail'
  if (checks.some((check) => check.status === 'warning')) return 'warning'
  if (checks.some((check) => check.status === 'unavailable')) return 'unavailable'
  return 'pass'
}

export function normalizedPerceptualHashDistance(left: string, right: string): number {
  const length = Math.min(left.length, right.length)
  if (length === 0) return 1
  let different = Math.abs(left.length - right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) different += 1
  }
  return different / Math.max(left.length, right.length)
}

export function normalizedColorDistance(
  left: CapabilityRecipeImageInspection['averageRgb'],
  right: CapabilityRecipeImageInspection['averageRgb'],
): number {
  const squared = left.reduce((sum, channel, index) => sum + (channel - right[index]!) ** 2, 0)
  return Math.sqrt(squared) / Math.sqrt(3)
}
