import i18n from "../../../i18n"
import type {
  GenerationQualityCheck,
  GenerationQualityStatus,
} from '../model/generationCanvasTypes'

export function qualityLabel(status: GenerationQualityStatus): string {
  if (status === 'pass') return i18n.t("customWorkflow.passed")
  if (status === 'warning') return i18n.t("customWorkflow.needsReview")
  if (status === 'fail') return i18n.t("customWorkflow.failed")
  return i18n.t("customWorkflow.incomplete")
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
