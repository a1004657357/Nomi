import { getGenerationNodeDefaultSize, getNodeSize } from '../model/generationNodeKinds'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

export type ExtractedVideoKeyframe = {
  timeSeconds: number
  url: string
}

export type VideoKeyframeNodeDraft = {
  title: string
  position: { x: number; y: number }
  meta: Record<string, unknown>
  result: NonNullable<GenerationCanvasNode['result']>
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function resolveVideoDurationSeconds(node: GenerationCanvasNode): number | null {
  return readPositiveNumber(node.result?.durationSeconds)
    ?? readPositiveNumber(node.meta?.videoDuration)
    ?? readPositiveNumber(node.meta?.durationSeconds)
}

export function buildEvenlySpacedFrameTimes(durationSeconds: number, count: number): number[] {
  const duration = readPositiveNumber(durationSeconds)
  if (!duration) return []
  const frameCount = Math.max(2, Math.min(24, Math.round(count)))
  // 容器时长常由音频流决定，可能比最后一帧视频多约 0.1 秒。留 0.25 秒余量，
  // 避免最后一个采样点落在“还有音频、已经没有视频帧”的尾端。
  const end = Math.max(0, duration - Math.min(0.25, duration / 10))
  return Array.from({ length: frameCount }, (_, index) => {
    const value = frameCount === 1 ? 0 : (end * index) / (frameCount - 1)
    return Math.round(value * 1000) / 1000
  })
}

export function formatVideoFrameTime(timeSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0)
  const minutes = Math.floor(safe / 60)
  const seconds = safe - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`
}

export function buildVideoKeyframeNodeDrafts(
  source: GenerationCanvasNode,
  frames: readonly ExtractedVideoKeyframe[],
  createdAt = Date.now(),
): VideoKeyframeNodeDraft[] {
  const sourceSize = getNodeSize(source)
  const keyframeSize = getGenerationNodeDefaultSize('keyframe')
  const columns = 2
  const gap = 32
  const startX = source.position.x + sourceSize.width + 64
  const startY = source.position.y

  return frames.map((frame, index) => ({
    title: `${(source.title || '视频').trim()} · ${formatVideoFrameTime(frame.timeSeconds)}`,
    position: {
      x: startX + (index % columns) * (keyframeSize.width + gap),
      y: startY + Math.floor(index / columns) * (keyframeSize.height + gap),
    },
    meta: {
      sourceVideoNodeId: source.id,
      sourceTimeSeconds: frame.timeSeconds,
      extractedKeyframe: true,
    },
    result: {
      id: `video-keyframe-${source.id}-${Math.round(frame.timeSeconds * 1000)}-${createdAt}`,
      type: 'image',
      url: frame.url,
      createdAt,
    },
  }))
}
