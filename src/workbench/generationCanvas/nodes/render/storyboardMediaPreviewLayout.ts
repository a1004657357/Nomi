import type { CSSProperties } from 'react'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { readNodeAspectRatio } from '../aspectRatio'

const DEFAULT_MEDIA_ASPECT_RATIO = 16 / 9

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function readStoryboardMediaAspectRatio(node: GenerationCanvasNode): number {
  const meta = node.meta || {}
  const isVideo = node.result?.type === 'video'
  const storedRatio = positiveNumber(isVideo ? meta.videoAspectRatio : meta.imageAspectRatio)
  if (storedRatio) return storedRatio

  const width = positiveNumber(isVideo ? meta.videoWidth : meta.imageWidth)
  const height = positiveNumber(isVideo ? meta.videoHeight : meta.imageHeight)
  if (width && height) return width / height

  return readNodeAspectRatio(node) || DEFAULT_MEDIA_ASPECT_RATIO
}

function roundPreviewEdge(value: number): number {
  return Math.round(value * 100) / 100
}

export function fitStoryboardMediaPreview(
  aspectRatio: number,
  maxEdge: number,
): Pick<CSSProperties, 'width' | 'height'> {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0
    ? aspectRatio
    : DEFAULT_MEDIA_ASPECT_RATIO
  if (ratio >= 1) {
    return { width: maxEdge, height: roundPreviewEdge(maxEdge / ratio) }
  }
  return { width: roundPreviewEdge(maxEdge * ratio), height: maxEdge }
}
