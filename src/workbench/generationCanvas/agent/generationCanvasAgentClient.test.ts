import { describe, expect, it } from 'vitest'
import { MODEL_FACING_TOOL_SPECS } from '../../../../electron/shared/agentCapabilities/modelFacingToolRegistry'
import { CREATIVE_COMPONENT_EXECUTION_POLICY } from '../../../../electron/shared/agentCapabilities/creativeComponent'
import { renderLanePromptSections } from '../../../../electron/agentLane/lanePromptSections'

describe('canonical Agent creative routing after the legacy prompt retirement', () => {
  const description = (name: string) => {
    const spec = MODEL_FACING_TOOL_SPECS.find(tool => tool.name === name)
    expect(spec, name).toBeDefined()
    return spec!.description
  }

  it('discovers recipes before planning a derived result, never replacing the source', () => {
    expect(description('list_capability_recipes')).toContain('before planning')
    const prompt = description('apply_capability_recipe')
    expect(prompt).toContain('without starting generation or replacing the source')
    expect(prompt).toContain('list_capability_recipes')
    expect(prompt).toContain('separate explicit user confirmation')
  })

  it('keeps GLB handoff distinct from paid generation', () => {
    expect(description('save_creative_resource')).toContain('existing result')
    expect(description('handoff_model3d')).toContain('GLB')
    expect(description('handoff_model3d')).toContain('without generating')
  })

  it('exposes the same no-resubmission policy used by the new lane runtime', () => {
    expect(CREATIVE_COMPONENT_EXECUTION_POLICY).toEqual({
      allowGeneration: false, requirePaidConfirmation: true, autoResubmit: false,
    })
    expect(renderLanePromptSections(MODEL_FACING_TOOL_SPECS.filter(tool => tool.name === 'apply_capability_recipe')))
      .toContain('Do not automatically resend')
    expect(description('apply_vibing_director_plan')).toContain('freshly read scene')
  })
})
