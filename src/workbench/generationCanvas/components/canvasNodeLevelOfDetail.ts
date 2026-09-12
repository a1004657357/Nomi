import type { GenerationNodeResult } from '../model/generationCanvasTypes'

export const LIGHTWEIGHT_NODE_RENDER_THRESHOLD = 80
export const LIGHTWEIGHT_NODE_ZOOM_THRESHOLD = 0.55
export const DENSE_EDGE_PAN_THRESHOLD = 24
export const MEDIA_HEAVY_NODE_THRESHOLD = 16
export const VIDEO_HEAVY_NODE_THRESHOLD = 4

export type CanvasPerformancePreference = 'auto' | 'smooth'

export type CanvasPerformanceProfile = {
  lightweightNodes: boolean
  reduceEffects: boolean
  suspendMediaWhileMoving: boolean
  deferEdgesWhileMoving: boolean
}

export type LightweightNodePreview = {
  kind: 'image' | 'video'
  src: string
}

export function resolveLightweightNodePreview(input: {
  result?: Pick<GenerationNodeResult, 'type' | 'url' | 'thumbnailUrl'>
}): LightweightNodePreview | null {
  const result = input.result
  if (!result) return null
  const thumbnailUrl = typeof result.thumbnailUrl === 'string' ? result.thumbnailUrl.trim() : ''
  const url = typeof result.url === 'string' ? result.url.trim() : ''
  if (result.type === 'image') {
    const src = thumbnailUrl || url
    return src ? { kind: 'image', src } : null
  }
  if (result.type === 'video') {
    if (thumbnailUrl) return { kind: 'image', src: thumbnailUrl }
    return url ? { kind: 'video', src: url } : null
  }
  return null
}

export function shouldUseLightweightNodeRendering(nodeCount: number, zoom: number): boolean {
  return nodeCount > LIGHTWEIGHT_NODE_RENDER_THRESHOLD && zoom < LIGHTWEIGHT_NODE_ZOOM_THRESHOLD
}

export function shouldRenderFullNodeContent(input: {
  lightweightMode: boolean
  selected: boolean
  focusFlash: boolean
}): boolean {
  if (!input.lightweightMode) return true
  return input.selected || input.focusFlash
}

export function shouldDeferCanvasEdgesWhilePanning(edgeCount: number): boolean {
  return edgeCount >= DENSE_EDGE_PAN_THRESHOLD
}

export function resolveCanvasPerformanceProfile(input: {
  preference: CanvasPerformancePreference
  nodeCount: number
  edgeCount: number
  mediaNodeCount: number
  videoNodeCount: number
  zoom: number
}): CanvasPerformanceProfile {
  const automaticLightweight = shouldUseLightweightNodeRendering(input.nodeCount, input.zoom)
  const mediaHeavy = input.mediaNodeCount >= MEDIA_HEAVY_NODE_THRESHOLD
  const videoHeavy = input.videoNodeCount >= VIDEO_HEAVY_NODE_THRESHOLD
  const reduceEffects =
    input.preference === 'smooth'
    || input.nodeCount > 50
    || input.edgeCount >= 40
    || mediaHeavy
    || videoHeavy
  const lightweightNodes =
    automaticLightweight
    || (
      input.preference === 'smooth'
      && input.nodeCount > 24
      && input.zoom < 0.85
    )
    || (
      mediaHeavy
      && input.nodeCount > 40
      && input.zoom < 0.7
    )

  return {
    lightweightNodes,
    reduceEffects,
    suspendMediaWhileMoving:
      input.preference === 'smooth'
      || input.mediaNodeCount >= 8
      || input.videoNodeCount >= 2,
    deferEdgesWhileMoving:
      input.preference === 'smooth'
      || shouldDeferCanvasEdgesWhilePanning(input.edgeCount),
  }
}
