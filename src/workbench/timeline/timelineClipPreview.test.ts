import { describe, expect, it } from 'vitest'
import { isLikelyStillImageUrl, resolveTimelineClipPreviewMedia } from './timelineClipPreview'
import type { TimelineClip } from './timelineTypes'

// 视频 clip 的主渲染已是胶片条（useTimelineFilmstrip）；本文件锁静态回退链：
// 图片 clip 用自身图，视频 clip 无胶片时回退 thumbnail 图 → 占位色块，绝不冒充。

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    type: 'video',
    sourceNodeId: 'node-1',
    label: 'clip',
    startFrame: 0,
    endFrame: 120,
    frameCount: 120,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    ...overrides,
  }
}

describe('resolveTimelineClipPreviewMedia', () => {
  it('图片 clip：url 优先、thumbnail 兜底、都缺则 none', () => {
    expect(resolveTimelineClipPreviewMedia(clip({ type: 'image', url: 'a.png' }))).toEqual({ kind: 'image', src: 'a.png' })
    expect(resolveTimelineClipPreviewMedia(clip({ type: 'image', url: '', thumbnailUrl: 'b.webp' }))).toEqual({
      kind: 'image',
      src: 'b.webp',
    })
    expect(resolveTimelineClipPreviewMedia(clip({ type: 'image', url: '', thumbnailUrl: '' }))).toEqual({ kind: 'none' })
  })

  it('视频 clip：静态回退不挂 video——thumbnail 图 → 占位', () => {
    expect(
      resolveTimelineClipPreviewMedia(clip({ url: 'nomi-local://asset/p/v.mp4', thumbnailUrl: 'cover.jpg' })),
    ).toEqual({ kind: 'image', src: 'cover.jpg' })
    expect(resolveTimelineClipPreviewMedia(clip({ url: 'nomi-local://asset/p/v.mp4' }))).toEqual({ kind: 'placeholder' })
    expect(resolveTimelineClipPreviewMedia(clip({ url: '', thumbnailUrl: '' }))).toEqual({ kind: 'none' })
  })

  it('视频 clip 的 url 若本身是静态图（导入图伪装视频轨），直接当图渲', () => {
    expect(resolveTimelineClipPreviewMedia(clip({ url: 'frame.png' }))).toEqual({ kind: 'image', src: 'frame.png' })
  })

  it('音频 clip 不出媒体（保持色块）', () => {
    expect(resolveTimelineClipPreviewMedia(clip({ type: 'audio', url: 'a.mp3' }))).toEqual({ kind: 'none' })
  })
})

describe('isLikelyStillImageUrl', () => {
  it('data:image 与常见扩展名判真，blob/视频判假', () => {
    expect(isLikelyStillImageUrl('data:image/png;base64,xx')).toBe(true)
    expect(isLikelyStillImageUrl('x.webp?sig=1')).toBe(true)
    expect(isLikelyStillImageUrl('blob:abc')).toBe(false)
    expect(isLikelyStillImageUrl('v.mp4')).toBe(false)
  })
})
