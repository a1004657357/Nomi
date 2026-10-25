import i18n from "../../../i18n"
export type MoodGenerationMode = 'single' | 'sample5' | 'matrix5x5'

export type MoodCoordinate = {
  energy: number
  affinity: number
}

export type CapabilityRecipeConnectionGuidance = {
  title: string
  description: string
  vendorLabel: string
}

const SAMPLE_COORDINATES: readonly MoodCoordinate[] = [
  { energy: 0, affinity: 0 },
  { energy: 0, affinity: 4 },
  { energy: 2, affinity: 2 },
  { energy: 4, affinity: 0 },
  { energy: 4, affinity: 4 },
]

function moodScale(value: unknown, fallback = 2): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(4, Math.round(numeric))) : fallback
}

export function normalizeMoodGenerationMode(value: unknown): MoodGenerationMode {
  if (value === 'sample5' || value === 'matrix5x5') return value
  return 'single'
}

export function moodOutputCountForMode(mode: MoodGenerationMode): number {
  if (mode === 'matrix5x5') return 25
  if (mode === 'sample5') return 5
  return 1
}

export function moodRequestSummary(mode: MoodGenerationMode): string {
  const count = moodOutputCountForMode(mode)
  return count === 1
    ? i18n.t('customWorkflow.singleRequest')
    : i18n.t('customWorkflow.separateRequestsUpTo2Concurrent', { v0: count })
}

export function moodCoordinatesForMode(
  mode: MoodGenerationMode,
  energy: unknown,
  affinity: unknown,
): MoodCoordinate[] {
  if (mode === 'matrix5x5') {
    return Array.from({ length: 25 }, (_, index) => ({
      energy: Math.floor(index / 5),
      affinity: index % 5,
    }))
  }
  if (mode === 'sample5') return SAMPLE_COORDINATES.map((coordinate) => ({ ...coordinate }))
  return [{ energy: moodScale(energy), affinity: moodScale(affinity) }]
}

export function capabilityRecipeConnectionGuidance(
  recipeId: string,
): CapabilityRecipeConnectionGuidance {
  if (recipeId === 'video.edit.look' || recipeId === 'video.edit.effect') {
    return {
      title: i18n.t("customWorkflow.videoToVideoModelRequired"),
      description: i18n.t("customWorkflow.connectKieAndEnableHappyhorseItsVideoEdit"),
      vendorLabel: 'KIE · HappyHorse',
    }
  }
  if (recipeId === 'image.multiview.reconstruct3d') {
    return {
      title: i18n.t("customWorkflow.imageTo3dModelRequired"),
      description: i18n.t("customWorkflow.connectARunninghubEnterpriseSharedApiKeyTo"),
      vendorLabel: 'RunningHub · 3D',
    }
  }
  return {
    title: i18n.t("customWorkflow.compatibleModelRequired"),
    description: i18n.t("customWorkflow.connectAndEnableAModelSupportingThisRecipe"),
    vendorLabel: i18n.t("customWorkflow.modelConnections"),
  }
}
