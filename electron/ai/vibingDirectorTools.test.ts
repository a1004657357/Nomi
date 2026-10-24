import { describe, expect, it } from 'vitest'
import {
  applyVibingDirectorPlanParamsSchema,
  parseVibingDirectorPlanRequest,
  vibingDirectorToolNames,
} from './vibingDirectorTools'

describe('VIBING Director Agent tools', () => {
  it('keeps canonical beat-title validation after the flat wire is parsed', () => {
    const request = { directorNodeId: 'fixture', summary: 'fixture', plan: { mode: 'amend', actions: [{ op: 'set_beat', id: 'beat' }] } }
    const wire = applyVibingDirectorPlanParamsSchema.parse(request)
    expect(parseVibingDirectorPlanRequest(wire)).toBeNull()
    expect(parseVibingDirectorPlanRequest({ ...request, plan: { ...request.plan, actions: [{ ...request.plan.actions[0], title: '' }] } })).toBeNull()
  })
  it('accepts only declared Blender director plans', () => {
    const parsed = applyVibingDirectorPlanParamsSchema.safeParse({
      directorNodeId: 'director-1',
      summary: '在 Blender 中搭建咖啡店开场并安排推进机位。',
      plan: {
        mode: 'replace',
        actions: [
          { op: 'set_stage', preset: 'coffee_shop' },
          { op: 'add_marker', id: 'barista', name: '咖啡师', position: [-1, 0, 0] },
          { op: 'set_beat', id: 'opening', title: '进入店内', durationSec: 4 },
        ],
      },
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parseVibingDirectorPlanRequest(parsed.data)).toMatchObject({
        plan: { actions: expect.arrayContaining([{ op: 'set_beat', id: 'opening', title: '进入店内', durationSec: 4 }]) },
      })
    }
    expect(vibingDirectorToolNames).toEqual(['read_vibing_director', 'apply_vibing_director_plan'])
  })

  it('rejects raw scripts, URLs and malformed Blender plans', () => {
    const rawScript = applyVibingDirectorPlanParamsSchema.safeParse({
      directorNodeId: 'director-1',
      summary: '执行 Blender 脚本',
      plan: { mode: 'replace', actions: [{ op: 'run_python', script: 'import bpy; bpy.ops.mesh.primitive_cube_add()' }] },
    })
    const malformedPath = applyVibingDirectorPlanParamsSchema.safeParse({
      directorNodeId: 'director-1',
      summary: '导入远程模型',
      plan: { mode: 'replace', actions: [{ op: 'place_asset', id: 'asset-1', assetId: 'https://example.com/model.glb', name: '模型' }] },
    })

    expect(rawScript.success).toBe(false)
    expect(malformedPath.success).toBe(false)
  })

  it('uses a flat wire schema but restores the exact operation contract before confirmation', () => {
    const flatWirePayload = {
      directorNodeId: 'director-1',
      summary: '在 Blender 中设置开场机位。',
      plan: { mode: 'amend', actions: [{ op: 'set_camera_path', cameraRef: 'director-camera' }] },
    }

    // The provider can accept this simple object schema without oneOf. Before
    // it reaches the renderer, the canonical schema still rejects missing path data.
    expect(applyVibingDirectorPlanParamsSchema.safeParse(flatWirePayload).success).toBe(true)
    expect(parseVibingDirectorPlanRequest(flatWirePayload)).toBeNull()

    const canonical = parseVibingDirectorPlanRequest({
      ...flatWirePayload,
      plan: {
        mode: 'amend',
        actions: [{
          op: 'set_camera_path',
          cameraRef: 'director-camera',
          points: [[4, 2, 5], [1, 1.5, 2]],
          durationSec: 3,
        }],
      },
    })
    expect(canonical).toEqual(expect.objectContaining({ directorNodeId: 'director-1' }))
  })

  it('allows the coffee relationship template through the native tool contract', () => {
    const request = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '重建咖啡店双人对话摆位。',
      plan: {
        mode: 'replace',
        actions: [{
          op: 'set_blocking_layout',
          template: 'coffee_two_person_conversation',
          actorAName: '角色A',
          actorBName: '角色B',
        }],
      },
    })

    expect(request?.plan.actions[0]).toEqual(expect.objectContaining({
      op: 'set_blocking_layout',
      template: 'coffee_two_person_conversation',
    }))
  })

  it('requires an existing-target reference shape for target camera framing', () => {
    const missingTarget = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '让相机跟随角色。',
      plan: { mode: 'amend', actions: [{ op: 'set_camera', framing: 'target' }] },
    })
    const target = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '让相机跟随角色。',
      plan: { mode: 'amend', actions: [{ op: 'set_camera', framing: 'target', targetRef: 'actor-A' }] },
    })

    expect(missingTarget).toBeNull()
    expect(target?.plan.actions[0]).toEqual(expect.objectContaining({
      op: 'set_camera',
      framing: 'target',
      targetRef: 'actor-A',
    }))
  })

  it('accepts declared spatial relations and rejects incomplete distance constraints', () => {
    const valid = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '让两位角色保持对视并隔桌而坐。',
      plan: {
        mode: 'amend',
        actions: [
          { op: 'set_relation', id: 'actors-facing', kind: 'facing', subjectRef: 'actor-A', targetRef: 'actor-B', mutual: true },
          { op: 'set_relation', id: 'actors-distance', kind: 'distance', subjectRef: 'actor-A', targetRef: 'actor-B', distance: 2.5 },
          { op: 'set_relation', id: 'chair-follows-actor', kind: 'offset', subjectRef: 'chair-A', targetRef: 'actor-A' },
        ],
      },
    })
    const invalid = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '设置距离。',
      plan: {
        mode: 'amend',
        actions: [{ op: 'set_relation', id: 'actors-distance', kind: 'distance', subjectRef: 'actor-A', targetRef: 'actor-B' }],
      },
    })

    expect(valid?.plan.actions).toHaveLength(3)
    expect(invalid).toBeNull()
  })
})
