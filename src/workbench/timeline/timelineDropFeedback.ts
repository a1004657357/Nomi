import { frameToPixel, resolveLegalInsertStart, withClipStartFrame } from './timelineEdit'
import type { TimelineClip, TimelineTrack } from './timelineTypes'
import { getTrackTypeForClipType } from './timelineTypes'
import i18n from '../../i18n'

export type TimelineDropPreview = {
  clip: TimelineClip
  canPlace: boolean
  startFrame: number
  endFrame: number
  left: number
  width: number
  timecode: string
  reason?: string
}

function trackTypeLabel(type: TimelineClip['type']): string {
  if (type === 'image') return i18n.t('timelineEditor.track.imageLabel')
  if (type === 'video') return i18n.t('timelineEditor.track.videoLabel')
  if (type === 'audio') return i18n.t('timelineEditor.track.audioLabel')
  return i18n.t('timelineEditor.track.genericLabel')
}

export function formatTimelineDropTimecode(frame: number, fps: number): string {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30
  const totalSeconds = Math.floor(Math.max(0, frame) / safeFps)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function buildTimelineDropPreview(params: {
  track: TimelineTrack
  clip: TimelineClip
  startFrame: number
  scale: number
  fps: number
}): TimelineDropPreview {
  const desiredStart = Math.max(0, Math.floor(Number(params.startFrame) || 0))
  // v0.7.1: audio clip 落到 video 轨；getTrackTypeForClipType 做映射
  const typeMatches = params.track.type === getTrackTypeForClipType(params.clip.type)
  // 同型落轨永不拒收：期望位被占则滑入最近合法空位（与移动同一碰撞模型），预览即真实落点
  const placed = withClipStartFrame(
    params.clip,
    typeMatches ? resolveLegalInsertStart(params.track, params.clip, desiredStart) : desiredStart,
  )
  const canPlace = typeMatches
  const reason = canPlace ? undefined : i18n.t('timelineEditor.track.wrongType', { track: trackTypeLabel(placed.type) })

  return {
    clip: placed,
    canPlace,
    startFrame: placed.startFrame,
    endFrame: placed.endFrame,
    left: frameToPixel(placed.startFrame, params.scale),
    width: Math.max(36, frameToPixel(placed.endFrame - placed.startFrame, params.scale)),
    timecode: formatTimelineDropTimecode(placed.startFrame, params.fps),
    ...(reason ? { reason } : {}),
  }
}
