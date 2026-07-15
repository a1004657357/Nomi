import { describe, expect, it } from 'vitest'
import {
  applyVibingDirectorPlan,
  createCoffeeConversationLayoutPlan,
  createVibingDirectorState,
  materializeVibingDirectorPlan,
  normalizeVibingDirectorState,
} from './vibingDirectorState'

describe('VIBING Director state', () => {
  it('creates a Blender-return document instead of a Three.js scene document', () => {
    const state = createVibingDirectorState() as unknown as {
      version: number
      backend?: string
      assets?: unknown[]
      output?: unknown
      scene?: unknown
    }

    expect(state.version).toBe(2)
    expect(state.backend).toBe('blender')
    expect(state.assets).toEqual([])
    expect(state.output).toBeUndefined()
    expect(state.scene).toBeUndefined()
  })

  it('keeps the creative brief when migrating a legacy Three.js director document', () => {
    const state = normalizeVibingDirectorState({
      brief: '雨后咖啡店广告',
      scene: { objects: [{ id: 'legacy-actor', name: '咖啡师' }] },
    }) as unknown as { version: number; backend?: string; brief: string; assets?: unknown[] }

    expect(state.version).toBe(2)
    expect(state.backend).toBe('blender')
    expect(state.brief).toBe('雨后咖啡店广告')
    expect(state.assets).toEqual([])
  })

  it('resets the Director camera when a replace plan rebuilds the Blender scene', () => {
    const state = createVibingDirectorState()
    state.camera = { ...state.camera, position: [90, 30, 10], lookAt: [1, 2, 3] }

    const result = applyVibingDirectorPlan(state, {
      mode: 'replace',
      actions: [{ op: 'set_stage', preset: 'coffee_shop' }],
    })

    expect(result.rejected).toEqual([])
    expect(result.state.camera.position).toEqual([5, 2.4, 6])
    expect(result.state.camera.lookAt).toEqual([0, 1, 0])
  })

  it('expands a coffee conversation layout into correctly related semantic blockout objects', () => {
    const plan = materializeVibingDirectorPlan({
      mode: 'replace',
      actions: [{
        op: 'set_blocking_layout',
        template: 'coffee_two_person_conversation',
        actorAName: '角色A',
        actorBName: '角色B',
      }],
    })

    expect(plan.actions).toEqual(expect.arrayContaining([
      { op: 'set_stage', preset: 'coffee_shop' },
      expect.objectContaining({ op: 'add_marker', id: 'table-main', role: 'table', position: [0, 0, 0] }),
      expect.objectContaining({ op: 'add_marker', id: 'chair-A', role: 'chair', position: [0, 0, 1.25], rotation: [0, 180, 0] }),
      expect.objectContaining({ op: 'add_marker', id: 'chair-B', role: 'chair', position: [0, 0, -1.25], rotation: [0, 0, 0] }),
      expect.objectContaining({ op: 'add_marker', id: 'actor-A', role: 'actor_seated', position: [0, 0, 1.25], rotation: [0, 180, 0] }),
      expect.objectContaining({ op: 'add_marker', id: 'actor-B', role: 'actor_seated', position: [0, 0, -1.25], rotation: [0, 0, 0] }),
      expect.objectContaining({ op: 'add_marker', id: 'cup-A', role: 'cup', position: [-0.38, 0.76, 0.22] }),
      expect.objectContaining({ op: 'add_marker', id: 'laptop', role: 'laptop', position: [0.54, 0.76, 0.08] }),
      expect.objectContaining({ op: 'set_camera', position: [8, 5, 8], lookAt: [0, 0.9, 0], fov: 45 }),
    ]))
  })

  it('keeps a marker role so Blender can render the correct proxy shape', () => {
    const result = applyVibingDirectorPlan(createVibingDirectorState(), {
      mode: 'replace',
      actions: [{ op: 'add_marker', id: 'cup-A', name: '咖啡杯A', role: 'cup', position: [0, 0.76, 0] }],
    })

    expect(result.state.objects).toEqual([
      expect.objectContaining({ id: 'cup-A', role: 'cup' }),
    ])
  })

  it('rebuilds a coffee conversation using the names already assigned to its two actors', () => {
    const state = createVibingDirectorState()
    state.brief = '咖啡店里两人对坐聊天。'
    state.stagePreset = 'coffee_shop'
    state.objects = [
      { id: 'actor-alice', name: 'Alice', kind: 'marker', role: 'actor_seated', position: [0, 0, 1], rotation: [0, 180, 0], scale: [1, 1, 1] },
      { id: 'actor-bob', name: 'Bob', kind: 'marker', role: 'actor_seated', position: [0, 0, -1], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ]

    expect(createCoffeeConversationLayoutPlan(state)).toEqual({
      mode: 'replace',
      brief: '咖啡店里两人对坐聊天。',
      actions: [{
        op: 'set_blocking_layout',
        template: 'coffee_two_person_conversation',
        actorAName: 'Alice',
        actorBName: 'Bob',
      }],
    })
  })
})
