import type { ComposerAttachment } from '../../ai/composer/composerAttachmentTypes'
import type { RunCanvasSkillAgentEventDetail } from './canvasSkillEvents'
import { formatVideoFrameTime, type ExtractedVideoKeyframe } from '../nodes/videoKeyframeInspectorModel'

export const VIDEO_DECONSTRUCTION_SKILL_KEY = 'creative.video-deconstruction'

export function isVideoDeconstructionSkill(skillKey: string): boolean {
  return skillKey === VIDEO_DECONSTRUCTION_SKILL_KEY
}

export function buildVideoDeconstructionAttachments(
  frames: readonly ExtractedVideoKeyframe[],
): ComposerAttachment[] {
  return frames.map((frame, index) => ({
    id: `video-analysis-${index}-${Math.round(frame.timeSeconds * 1000)}`,
    fileName: `frame-${String(index + 1).padStart(2, '0')}-${formatVideoFrameTime(frame.timeSeconds).replace(':', '-')}.png`,
    contentType: 'image/png',
    sizeBytes: 0,
    kind: 'image',
    status: 'ready',
    url: frame.url,
  }))
}

export function videoDeconstructionAgentMessage(
  input: RunCanvasSkillAgentEventDetail,
  frames: readonly ExtractedVideoKeyframe[],
): string {
  const orderedTimes = frames.map((frame, index) => (
    `附件 ${index + 1} = ${formatVideoFrameTime(frame.timeSeconds)}`
  )).join('；')
  return [
    `请按「${input.skill.label}」技能拆解已连接的视频。`,
    `视频来源节点：${input.sourceNodeIds.join('、')}；技能节点：${input.skillNodeId}。`,
    `关键帧严格按时间排列：${orderedTimes}。`,
    '先读取画布，再输出：① 时序拆解表；② 可见事实与推断边界；③ 可直接使用的视频生成提示词；④ 负面约束。',
    '本轮默认只分析，不修改画布，也不调用图片或视频生成；只有我明确要求保存或替换时才提出写操作。',
  ].join('\n')
}
