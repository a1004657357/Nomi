import type {
  GenerationQualityCheck,
  GenerationQualityStatus,
} from '../model/generationCanvasTypes'

export function qualityLabel(status: GenerationQualityStatus): string {
  if (status === 'pass') return '通过'
  if (status === 'warning') return '需检查'
  if (status === 'fail') return '未通过'
  return '未完成'
}

export function qualityStatusForItem(
  itemId: string,
  checks: readonly GenerationQualityCheck[],
): GenerationQualityStatus | undefined {
  const statuses = checks
    .filter((check) => check.itemIds?.includes(itemId))
    .map((check) => check.status)
  if (statuses.includes('fail')) return 'fail'
  if (statuses.includes('warning')) return 'warning'
  if (statuses.includes('unavailable')) return 'unavailable'
  return undefined
}
