import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  buildEvenlySpacedFrameTimes,
  buildVideoKeyframeNodeDrafts,
  formatVideoFrameTime,
  resolveVideoDurationSeconds,
} from './videoKeyframeInspectorModel'

const videoNode = (patch: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode => ({
  id: 'video-1',
  kind: 'video',
  title: '样片',
  position: { x: 100, y: 200 },
  ...patch,
})

describe('videoKeyframeInspectorModel', () => {
  it('优先读取 result 时长，并兼容 meta 时长', () => {
    expect(resolveVideoDurationSeconds(videoNode({
      result: { id: 'r', type: 'video', createdAt: 1, durationSeconds: 8 },
      meta: { videoDuration: 12 },
    }))).toBe(8)
    expect(resolveVideoDurationSeconds(videoNode({ meta: { videoDuration: 12.5 } }))).toBe(12.5)
  })

  it('均匀取样避开精确 EOF，并限制数量', () => {
    expect(buildEvenlySpacedFrameTimes(10, 3)).toEqual([0, 4.875, 9.75])
    expect(buildEvenlySpacedFrameTimes(0, 8)).toEqual([])
    expect(buildEvenlySpacedFrameTimes(5, 100)).toHaveLength(24)
  })

  it('生成关键帧节点草稿并记录来源时间', () => {
    const drafts = buildVideoKeyframeNodeDrafts(videoNode(), [
      { timeSeconds: 0, url: 'nomi-local://frame-0' },
      { timeSeconds: 2.5, url: 'nomi-local://frame-1' },
      { timeSeconds: 5, url: 'nomi-local://frame-2' },
    ], 1000)
    expect(drafts).toHaveLength(3)
    expect(drafts[1].meta).toMatchObject({ sourceVideoNodeId: 'video-1', sourceTimeSeconds: 2.5 })
    expect(drafts[2].position.y).toBeGreaterThan(drafts[0].position.y)
    expect(drafts[0].result.type).toBe('image')
    expect(formatVideoFrameTime(65.25)).toBe('01:05.25')
  })
})
