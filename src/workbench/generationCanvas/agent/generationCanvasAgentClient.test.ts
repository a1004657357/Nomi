import { describe, expect, it } from 'vitest'
import { buildStaticAgentSystemPrompt } from './generationCanvasAgentClient'

describe('buildStaticAgentSystemPrompt creative capability routing', () => {
  it('teaches the canvas Agent to discover and apply recipes without overwriting results', () => {
    const prompt = buildStaticAgentSystemPrompt('agent')

    expect(prompt).toContain('list_capability_recipes')
    expect(prompt).toContain('apply_capability_recipe')
    expect(prompt).toContain('先调用 list_capability_recipes')
    expect(prompt).toContain('只创建新的派生结果')
    expect(prompt).toContain('不得为了省一步而改写或覆盖现有 result')
    expect(prompt).toContain('已有结果的节点会自动新建版本节点')
    expect(prompt).toContain('visionReviewModels')
    expect(prompt).toContain('整批只增加 1 次视觉请求')
    expect(prompt).toContain('失败不得自动重生成')
  })

  it('keeps image, video and model3d workflows distinct', () => {
    const prompt = buildStaticAgentSystemPrompt('agent')

    expect(prompt).toContain('图生视频不是视频转视频')
    expect(prompt).toContain('不要改用 GPT Image 2、Codex Img2 或其他图片模型冒充')
    expect(prompt).toContain('save_creative_resource')
    expect(prompt).toContain('handoff_model3d')
    expect(prompt).toContain('model3d/GLB')
  })

  it('routes staging references directly to full-reference video nodes', () => {
    const prompt = buildStaticAgentSystemPrompt('agent')

    expect(prompt).toContain('叙事镜头处于全能参考模式时')
    expect(prompt).toContain('直接指向支持多图 image_ref 的视频节点')
    expect(prompt).toContain('不要锁成首帧')
    expect(prompt).toContain('只有用户明确选择首帧复刻/接戏模式时')
    expect(prompt).not.toContain('视频模型没有构图槽')
  })
})
