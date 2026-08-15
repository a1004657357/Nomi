import type { TimelineClip } from './timelineTypes'

/**
 * 时间轴 clip 的静态回退媒体（图片 clip 主渲染；视频 clip 在胶片条未就绪/失败时的回退）。
 * 视频 clip 的主渲染是胶片条（useTimelineFilmstrip），不再按选中态挂 <video>——
 * 旧「仅单选加载真帧」机制已被全员真帧胶片取代（P1 删旧）。
 */
export type TimelineClipPreviewMedia =
  | { kind: 'image'; src: string }
  | { kind: 'placeholder' }
  | { kind: 'none' }

const IMAGE_URL_RE = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i

function cleanMediaUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isLikelyStillImageUrl(value: unknown): boolean {
  const url = cleanMediaUrl(value)
  if (!url) return false
  if (/^data:image\//i.test(url)) return true
  if (/^blob:/i.test(url)) return false
  return IMAGE_URL_RE.test(url)
}

export function resolveTimelineClipPreviewMedia(clip: TimelineClip): TimelineClipPreviewMedia {
  const url = cleanMediaUrl(clip.url)
  const thumbnailUrl = cleanMediaUrl(clip.thumbnailUrl)

  if (clip.type === 'image') {
    const src = url || thumbnailUrl
    return src ? { kind: 'image', src } : { kind: 'none' }
  }

  if (clip.type !== 'video') return { kind: 'none' }

  if (isLikelyStillImageUrl(thumbnailUrl)) {
    return { kind: 'image', src: thumbnailUrl }
  }

  if (isLikelyStillImageUrl(url)) {
    return { kind: 'image', src: url }
  }

  return url || thumbnailUrl ? { kind: 'placeholder' } : { kind: 'none' }
}
