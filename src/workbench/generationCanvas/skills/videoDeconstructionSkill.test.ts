import { describe, expect, it } from 'vitest'
import {
  buildVideoDeconstructionAttachments,
  isVideoDeconstructionSkill,
  videoDeconstructionAgentMessage,
} from './videoDeconstructionSkill'

describe('videoDeconstructionSkill', () => {
  const frames = [
    { timeSeconds: 0, url: 'nomi-local://frame-0' },
    { timeSeconds: 2.5, url: 'nomi-local://frame-1' },
  ]

  it('只匹配视频拆解技能', () => {
    expect(isVideoDeconstructionSkill('creative.video-deconstruction')).toBe(true)
    expect(isVideoDeconstructionSkill('creative.multiview')).toBe(false)
  })

  it('把帧按时间顺序构造成视觉附件', () => {
    const attachments = buildVideoDeconstructionAttachments(frames)
    expect(attachments.map((item) => item.url)).toEqual(['nomi-local://frame-0', 'nomi-local://frame-1'])
    expect(attachments[1].fileName).toContain('00-02.50')
  })

  it('消息明确时间映射和只读边界', () => {
    const message = videoDeconstructionAgentMessage({
      skill: { skillKey: 'creative.video-deconstruction', label: '视频拆解与提示词反推' },
      sourceNodeIds: ['video-1'],
      skillNodeId: 'skill-1',
    }, frames)
    expect(message).toContain('附件 2 = 00:02.50')
    expect(message).toContain('本轮默认只分析')
  })
})
