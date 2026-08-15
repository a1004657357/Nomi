import { describe, expect, it } from 'vitest'
import { buildWorkbenchAiPayload } from './workbenchAiClient'

describe('workbench AI payload', () => {
  it('keeps the structured-text compatibility flag through the renderer transport', () => {
    const payload = buildWorkbenchAiPayload({
      prompt: '搭建导演台',
      displayPrompt: '搭建导演台',
      sessionKey: 'nomi:workbench:project-1:director:node-1',
      skillKey: 'workbench.vibing-director',
      skillName: 'VIBING Director',
      disableTools: true,
    })

    expect(payload).toMatchObject({
      disableTools: true,
      chatContext: { skill: { key: 'workbench.vibing-director', name: 'VIBING Director' } },
    })
  })

  it('sends the explicitly confirmed playbook stage to the backend', () => {
    const payload = buildWorkbenchAiPayload({
      prompt: '继续落画布',
      displayPrompt: '继续落画布',
      sessionKey: 'nomi:workbench:project-1:generation',
      skillKey: 'brand.promo',
      skillName: '品牌宣传片',
      playbookStageId: 'build',
    })

    expect(payload.playbookStageId).toBe('build')
  })
})
