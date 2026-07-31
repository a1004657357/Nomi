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
  return `${count} 次独立请求${count > 1 ? ' · 最多 2 路并发' : ''}`
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
      title: '需要视频转视频模型',
      description: '连接 KIE 并启用 HappyHorse；它的 video-edit 模式支持源视频和参考图。',
      vendorLabel: 'KIE · HappyHorse',
    }
  }
  if (recipeId === 'image.multiview.reconstruct3d') {
    return {
      title: '需要图生 3D 模型',
      description: '连接 RunningHub Enterprise-Shared API Key，可使用混元3D、HiTem3D 或 Meshy 6。',
      vendorLabel: 'RunningHub · 3D',
    }
  }
  return {
    title: '需要兼容模型',
    description: '请在模型接入中连接并启用一个支持该配方输入和输出的模型。',
    vendorLabel: '模型接入',
  }
}
