import i18n from './index'
import { zhCapabilityWorkflow } from './locales/capabilityWorkflow'

const displayKeys = new Map<string, keyof typeof zhCapabilityWorkflow>(
  Object.entries(zhCapabilityWorkflow).map(([key, value]) => [value, key as keyof typeof zhCapabilityWorkflow]),
)

/** Translate known recipe display labels without changing stored option values or custom text. */
export function translateCapabilityWorkflowText(source: string): string {
  const key = displayKeys.get(source)
  if (key) return i18n.t(`capabilityWorkflow.${key}`)
  // These exact generated labels are also persisted prompt inputs; translate only their display copy.
  const mood = /^能量 ([0-4]) · 亲和 ([0-4])$/.exec(source)
  if (mood) return i18n.t('capabilityWorkflow.energyAffinity', { v0: mood[1], v1: mood[2] })
  const result = /^结果 ([1-9]\d*)$/.exec(source)
  return result ? i18n.t('capabilityWorkflow.result', { v0: result[1] }) : source
}
