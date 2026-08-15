import { describe, expect, it } from 'vitest'
import {
  compileVideoPromptForReferences,
  VIDEO_PROMPT_COMPILER_MARKER,
} from './videoPromptCompiler'

describe('compileVideoPromptForReferences', () => {
  it('is idempotent when a request is rebuilt before submission', () => {
    const once = compileVideoPromptForReferences({
      prompt: '人物拿起月饼盒走向货架',
      strategy: 'first_frame',
      referenceImageCount: 1,
    })
    const twice = compileVideoPromptForReferences({
      prompt: once,
      strategy: 'first_frame',
      referenceImageCount: 1,
    })

    expect(twice).toBe(once)
    expect(twice.split(VIDEO_PROMPT_COMPILER_MARKER)).toHaveLength(2)
  })

  it('adds the device screen visibility rule when the shot mentions a phone', () => {
    const prompt = compileVideoPromptForReferences({
      prompt: '人物正对镜头，拿起手机查看消息，手机背面朝向镜头。',
      strategy: 'full_reference',
      referenceImageRoles: ['角色身份参考', '分镜构图参考'],
      referenceImageCount: 2,
    })

    expect(prompt).toContain('参考图 1：角色身份参考')
    expect(prompt).toContain('屏幕可见性硬规则')
    expect(prompt).toContain('屏幕不可见')
  })
})
