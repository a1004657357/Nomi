import { describe, expect, it } from 'vitest'
import { canvasSkillAgentMessage } from './canvasSkillEvents'

describe('canvasSkillAgentMessage', () => {
  it('keeps the originating user request and constrains execution to the selected stage', () => {
    const message = canvasSkillAgentMessage({
      skill: { skillKey: 'brand.promo', label: '品牌宣传片' },
      skillNodeId: 'skill-1',
      sourceNodeIds: ['image-1'],
      userMessage: '做一支 9:16 的咖啡新品短片',
      stage: {
        id: 'plan',
        goal: '先确认镜头结构',
        tools: ['read_canvas_state'],
        pause: true,
        index: 0,
        total: 3,
      },
    })

    expect(message).toContain('用户本次要求：做一支 9:16 的咖啡新品短片')
    expect(message).toContain('当前只执行阶段 1/3「plan」')
    expect(message).toContain('优先使用已连入技能节点的素材：image-1')
  })
})
