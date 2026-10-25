import { describe, expect, it } from 'vitest'
import { applyVibingDirectorPlanParamsSchema } from '../ai/vibingDirectorTools'
import { BLENDER_DIRECTOR_STAGE_PRESETS, BLENDER_SPATIAL_CHECK_STATUSES } from './blenderDirectorContract'
import { BLENDER_DIRECTOR_STAGE_PRESETS as rendererPresets } from '../../src/workbench/generationCanvas/nodes/vibingDirector/vibingDirectorTypes'

describe('shared Blender vocabulary', () => {
  it('preserves all five presets in their existing order at both public surfaces', () => {
    expect(BLENDER_DIRECTOR_STAGE_PRESETS).toEqual(['empty', 'studio', 'coffee_shop', 'city_street', 'interior_room'])
    expect(rendererPresets).toBe(BLENDER_DIRECTOR_STAGE_PRESETS)
    expect(BLENDER_SPATIAL_CHECK_STATUSES).toEqual(['passed', 'warning', 'failed'])
    for (const preset of BLENDER_DIRECTOR_STAGE_PRESETS) {
      expect(applyVibingDirectorPlanParamsSchema.safeParse({ directorNodeId: 'fixture', summary: 'fixture', plan: { mode: 'amend', actions: [{ op: 'set_stage', preset }] } }).success).toBe(true)
    }
    expect(applyVibingDirectorPlanParamsSchema.safeParse({ directorNodeId: 'fixture', summary: 'fixture', plan: { mode: 'amend', actions: [{ op: 'set_stage', preset: 'unknown-stage' }] } }).success).toBe(false)
  })
})
