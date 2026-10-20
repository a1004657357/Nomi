import { describe, expect, it } from 'vitest'
import { capabilityPlanReviewOf, capabilityContractById } from './registry'
import { specsForCapability } from './modelFacingToolRegistry'
import { preflightLaneApproval } from '../agentLane/laneApproval'
import { LANE_DEFERRED_TOOL_CATALOG, LANE_MODEL_TOOL_CATALOG, LANE_TOOL_BUDGET } from '../../agentLane/laneToolCatalog'
import { laneToolCombinations } from '../../../scripts/check-model-schema'
import { evaluateLaneToolBudget, LANE_TOOL_SCHEMA_TOKEN_CEILING } from '../../agentLane/laneToolGroups.mjs'

describe('creative capability admission and unchanged budgets', () => {
  it('requires fresh Host review even when raw tool arguments have no operation field', () => {
    const contract = capabilityContractById('creative.component.write')!
    const review = capabilityPlanReviewOf(contract, { sourceNodeId: 'source', recipeId: 'recipe' })
    expect(review).toEqual({ requiresPlanReview: true, planReviewAllowsReuse: false })
    for (const mode of ['step', 'safe-auto', 'project'] as const) {
      for (const spend of ['confirm', 'within-budget'] as const) {
        expect(preflightLaneApproval({ toolName: 'apply_capability_recipe', capabilityId: contract.id,
          effect: contract.effect, effectClass: contract.effectClass, destructiveHint: false, ...review }, {
          policy: { mode, spend }, workMode: undefined, hasUserInterface: true,
          sessionGrants: new Set([contract.id]),
        })).toMatchObject({ state: 'awaiting-user', grantable: false })
      }
    }
  })

  it('does not expose creative tools as always-on or bypass the existing staging verb', () => {
    const specs = [...specsForCapability('creative.component.read'), ...specsForCapability('creative.component.write')]
    expect(specs).toHaveLength(6)
    for (const spec of specs) {
      expect(LANE_MODEL_TOOL_CATALOG.some(tool => tool.name === spec.name)).toBe(false)
      expect(LANE_DEFERRED_TOOL_CATALOG.some(tool => tool.name === spec.name)).toBe(true)
    }
    expect(specs.some(spec => spec.name === 'create_staging_reference')).toBe(false)
    expect(specsForCapability('canvas.write').some(spec => spec.name === 'stage_shot')).toBe(true)
  })

  it('fits the actual registered model catalog without raising either budget', async () => {
    expect(LANE_TOOL_BUDGET).toBe(12)
    expect(LANE_TOOL_SCHEMA_TOKEN_CEILING).toBe(10_000)
    const combinations = await laneToolCombinations()
    expect(evaluateLaneToolBudget({ alwaysOnCount: combinations[0].toolNames.length, combinations })).toEqual([])
  }, 30_000)
})
