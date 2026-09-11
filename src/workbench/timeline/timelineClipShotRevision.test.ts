/**
 * Slice 7 测试：Timeline clip 携带 shotId + revisionId（§19.1，向后兼容）。
 *
 * 验收（Gate 1 Slice 7）：
 * - 既有 clip（无 shotId/revisionId）仍合法（向后兼容，旧项目无损打开）。
 * - 新 clip 可携带 shotId + revisionId（目标 §19.1：镜头到 clip 的映射保存二者）。
 * - 字段 optional：不破坏既有构造器与消费者。
 */
import { describe, expect, it } from 'vitest'
import { normalizeTimeline } from './timelineMath'
import type { TimelineClip } from './timelineTypes'

describe('TimelineClip — shotId/revisionId (§19.1, Gate 1 Slice 7)', () => {
  it('legacy clip without shotId/revisionId is still valid (backward compat)', () => {
    const legacy: TimelineClip = {
      id: 'c1',
      type: 'video',
      sourceNodeId: 'node-1',
      label: '镜1',
      startFrame: 0,
      endFrame: 120,
      frameCount: 120,
      offsetStartFrame: 0,
      offsetEndFrame: 120,
    }
    expect(legacy.shotId).toBeUndefined()
    expect(legacy.revisionId).toBeUndefined()
  })

  it('new clip can carry shotId + revisionId for shot↔timeline traceability', () => {
    const clip: TimelineClip = {
      id: 'c2',
      type: 'video',
      sourceNodeId: 'node-7',
      label: '天台对峙',
      startFrame: 120,
      endFrame: 300,
      frameCount: 180,
      offsetStartFrame: 0,
      offsetEndFrame: 180,
      shotId: 'shot-07',
      revisionId: 'rev-vid-1',
    }
    expect(clip.shotId).toBe('shot-07')
    expect(clip.revisionId).toBe('rev-vid-1')
  })

  it('keeps shotId + revisionId when a persisted timeline is normalized', () => {
    const normalized = normalizeTimeline({
      tracks: [{
        id: 'videoTrack',
        type: 'video',
        clips: [{
          id: 'c2',
          type: 'video',
          sourceNodeId: 'node-7',
          label: '天台对峙',
          startFrame: 120,
          endFrame: 300,
          frameCount: 180,
          offsetStartFrame: 0,
          offsetEndFrame: 0,
          shotId: 'shot-07',
          revisionId: 'rev-vid-1',
        }],
      }],
    })
    const clip = normalized.tracks.find((track) => track.type === 'video')?.clips[0]
    expect(clip?.shotId).toBe('shot-07')
    expect(clip?.revisionId).toBe('rev-vid-1')
  })
})
