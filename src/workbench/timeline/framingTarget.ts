import { DEFAULT_CLIP_FRAMING, resolveClipFraming, type ClipFraming } from './clipFraming'
import type { TimelineClip, TimelineState } from './timelineTypes'

// 取景控件（显示 / 缩放 / 重置 / 舞台拖拽）作用于**哪个片段**——单一真相源。
//
// 2026-08-03 根治：原先这个目标是 `resolveActiveClipsAtFrame(timeline, playheadFrame)` 推出来的，
// 也就是「跟播放头走」。后果有两层：
//   ① 播放头一动，同一个下拉的作用对象就换人，界面上不写 —— 用户不知道自己在改哪一段；
//   ② 播放头停在片段空隙上时目标为空，而「显示」下拉又没有禁用态 → 点了静默失效。
// 查了三家成熟剪辑器（Final Cut Pro / Adobe Firefly / OpenCut 源码）：片段属性一律**跟选中走**，
// 播放头只负责决定画布此刻渲染哪些片段。DaVinci Resolve 确实有「选中跟随播放头」，
// 但它是 opt-in 且**默认关闭**的加速档。无条件跟播放头是我们的孤例，不是通行做法。
//
// 所以这里把「编辑目标」和「渲染目标」彻底分开：
//   · 渲染 → 仍按播放头取 activeClips，各片段用自己的 framing（TimelinePreview 未变）
//   · 编辑 → 只认用户选中的那一个媒体片段（本文件）
// 把它抽成纯函数是为了能被测试钉死：作用域这种语义此前没有任何一层防线在验，
// 编译得过、五门全绿、单测全绿，只有真人点一遍才发现（见 docs/plan/2026-08-02-control-hierarchy-audit.md）。

/** 取景控件当前的作用对象；null = 无可编辑目标（控件必须禁用并说明原因）。 */
export type FramingTarget = {
  clipId: string
  clip: TimelineClip
  framing: ClipFraming
}

/** 只有图/视频片段能调取景——音频没有画面，文字叠加层走自己的样式控件。 */
function isFramableClip(clip: TimelineClip): boolean {
  return clip.type === 'image' || clip.type === 'video'
}

/**
 * 从「时间轴 + 当前选中」解析取景控件的作用对象。
 *
 * 规则（刻意保守，多选一律不给目标）：
 * - 恰好选中 1 个片段，且它是图/视频 → 目标就是它
 * - 选中 0 个 / 选中多个 / 选中的是音频 → null（控件禁用）
 *
 * 「多选不给目标」是有意的：批量改取景的语义（各片段尺寸不同、缩放该怎么合并）没有定义过，
 * 与其猜一个，不如诚实地不给——用户选单个即可编辑。
 */
export function resolveFramingTarget(
  timeline: Pick<TimelineState, 'tracks'>,
  selectedClipIds: readonly string[],
): FramingTarget | null {
  if (selectedClipIds.length !== 1) return null
  const clipId = String(selectedClipIds[0] || '').trim()
  if (!clipId) return null
  for (const track of timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId)
    if (!clip) continue
    if (!isFramableClip(clip)) return null
    return { clipId: clip.id, clip, framing: resolveClipFraming(clip) }
  }
  return null
}

/** 控件展示用的取景值：没有目标时回落到默认，读数不至于空着。 */
export function framingOfTarget(target: FramingTarget | null): ClipFraming {
  return target?.framing ?? DEFAULT_CLIP_FRAMING
}
