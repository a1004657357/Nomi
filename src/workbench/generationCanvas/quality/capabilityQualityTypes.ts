import type {
  GenerationNodeResult,
  GenerationResultCollectionItem,
} from '../model/generationCanvasTypes'
import type { CapabilityRecipeImageInspection } from '../runner/capabilityRecipePostprocess'

export type CapabilityRecipeImageInspector = (
  result: NonNullable<GenerationResultCollectionItem['result']>,
) => Promise<CapabilityRecipeImageInspection>

export type CapabilityRecipeVideoInspection = {
  suspect: boolean
  metadata?: {
    kind: 'image' | 'video' | 'audio' | 'unknown'
    durationSeconds?: number
    width?: number
    height?: number
    fps?: number
    videoCodec?: string
    audioCodec?: string
    hasAudio: boolean
  }
  checks: Array<{
    id: string
    suspect: boolean
    detail: string
    metrics?: Record<string, number>
  }>
}

export type CapabilityRecipeVideoInspector = (
  result: GenerationNodeResult,
) => Promise<CapabilityRecipeVideoInspection>
