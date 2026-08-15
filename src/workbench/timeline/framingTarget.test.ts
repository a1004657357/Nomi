import { describe, expect, it } from 'vitest'
import { resolveFramingTarget, framingOfTarget } from './framingTarget'
import { DEFAULT_CLIP_FRAMING } from './clipFraming'
import type { TimelineClip, TimelineState } from './timelineTypes'

// 作用域不变量（2026-08-03）。
// 这条语义此前**没有任何一层防线在验**：clipFraming.test 测的是取景几何、clipFramingEdit.test 测的是
// 「给定 clipId 改哪个 clip」、timelineMath.test 测的是 resolveActiveClipsAtFrame 的半开区间数学——
// 三者全对，恰恰因为纯函数全对，UI 层「作用对象跟播放头漂移 + 空隙时静默失效」才对单测彻底隐形。
// 所以这里钉的不是计算，是**契约**：取景控件作用于谁、什么时候没有目标（→ 控件必须禁用）。

const clip = (id: string, type: TimelineClip['type'], framing?: TimelineClip['framing']): TimelineClip => ({
  id,
  type,
  sourceNodeId: `node-${id}`,
  label: id,
  startFrame: 0,
  endFrame: 30,
  frameCount: 30,
  offsetStartFrame: 0,
  offsetEndFrame: 30,
  ...(framing ? { framing } : {}),
})

const timeline = {
  tracks: [
    { id: 'video', type: 'video' as const, label: '视频轨', clips: [clip('v1', 'video', { fit: 'cover', scale: 1.5, offsetX: 8, offsetY: -4 })] },
    { id: 'image', type: 'image' as const, label: '图片轨', clips: [clip('i1', 'image'), clip('i2', 'image')] },
    { id: 'audio', type: 'audio' as const, label: '音频轨', clips: [clip('a1', 'audio')] },
  ],
} as unknown as Pick<TimelineState, 'tracks'>

describe('取景控件的作用域', () => {
  it('选中单个视频片段 → 目标就是它，且带上它自己的取景值', () => {
    const target = resolveFramingTarget(timeline, ['v1'])
    expect(target?.clipId).toBe('v1')
    expect(target?.framing).toEqual({ fit: 'cover', scale: 1.5, offsetX: 8, offsetY: -4 })
  })

  it('选中单个图片片段（没设过取景）→ 目标是它，取景回落默认值', () => {
    const target = resolveFramingTarget(timeline, ['i1'])
    expect(target?.clipId).toBe('i1')
    expect(target?.framing).toEqual(DEFAULT_CLIP_FRAMING)
  })

  it('什么都没选 → 没有目标（控件该禁用）', () => {
    expect(resolveFramingTarget(timeline, [])).toBeNull()
  })

  it('选了多个 → 没有目标：批量改取景的语义没定义过，宁可不给也不猜', () => {
    expect(resolveFramingTarget(timeline, ['i1', 'i2'])).toBeNull()
  })

  it('选中音频片段 → 没有目标：音频没有画面可取景', () => {
    expect(resolveFramingTarget(timeline, ['a1'])).toBeNull()
  })

  it('选中的 id 已经不存在（片段被删了）→ 没有目标，不炸', () => {
    expect(resolveFramingTarget(timeline, ['gone'])).toBeNull()
    expect(resolveFramingTarget(timeline, [''])).toBeNull()
  })

  it('目标为空时读数回落默认，界面不至于空着', () => {
    expect(framingOfTarget(null)).toEqual(DEFAULT_CLIP_FRAMING)
  })

  // 这条是本次 bug 的核心回归：作用对象**不能**随播放头漂移。
  // 纯函数签名里根本没有 playheadFrame 这个入参——把「跟播放头走」在类型层就堵死。
  it('作用域只由选中决定，与播放头无关（同一选中，播放头怎么动结果都一样）', () => {
    const a = resolveFramingTarget(timeline, ['v1'])
    const b = resolveFramingTarget(timeline, ['v1'])
    expect(a?.clipId).toBe(b?.clipId)
    expect(resolveFramingTarget.length).toBe(2) // (timeline, selectedClipIds) —— 没有第三个 playhead 参数
  })
})
