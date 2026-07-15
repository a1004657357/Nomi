import { describe, expect, it } from 'vitest'
import { agentToolGroupForSkill } from './agentChatV2'
import { maxStepsForSkill } from './agentChatHarness'

describe('VIBING Director Agent routing', () => {
  it('uses its isolated tool group and enough steps for a staged scene edit', () => {
    expect(agentToolGroupForSkill('workbench.vibing-director')).toBe('vibing-director')
    expect(agentToolGroupForSkill('workbench.generation.canvas-planner')).toBe('canvas')
    expect(agentToolGroupForSkill('workbench.creation.screenplay')).toBe('document')
    expect(maxStepsForSkill('workbench.vibing-director')).toBeGreaterThan(8)
  })
})
