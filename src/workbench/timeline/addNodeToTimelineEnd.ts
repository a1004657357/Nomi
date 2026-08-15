import { useWorkbenchStore } from '../workbenchStore'
import { getTrackTypeForClipType } from './timelineTypes'
import { buildGenerationNodeTimelineClip } from './buildGenerationNodeTimelineClip'
import { findAppendFrame } from './timelineMath'
import { toast } from '../../ui/toast'
import i18n from '../../i18n'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

/**
 * 节点素材「点击加入时间轴」的整动作：贴尾追加（免思考串片）+ 展开时间轴让结果立刻可见 + 成功反馈。
 * 拖拽路径（自选位置）不走这里，见 TimelineTrack 的 drop 语义。
 */
export async function addGenerationNodeToTimelineEnd(node: GenerationCanvasNode): Promise<void> {
  const timeline = useWorkbenchStore.getState().timeline
  const clip = await buildGenerationNodeTimelineClip(node, { fps: timeline.fps, startFrame: 0 })
  if (!clip) {
    toast(i18n.t('generationCommon.node.generateFirst'), 'info')
    return
  }
  const store = useWorkbenchStore.getState()
  const trackType = getTrackTypeForClipType(clip.type)
  const track = store.timeline.tracks.find((candidate) => candidate.type === trackType)
  store.addTimelineClipAtFrame(clip, trackType, track ? findAppendFrame(track) : 0)
  store.setTimelinePanelCollapsed(false)
  toast(i18n.t('timelineEditor.addedToEnd'), 'success')
}
