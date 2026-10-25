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

  it('persists verified catalog provenance with a Kenney Director asset', () => {
    const base = createVibingDirectorState(1)
    const state = normalizeVibingDirectorState({
      ...base,
      assets: [{
        id: 'asset-coffee-machine',
        name: 'Kitchen Coffee Machine',
        fileName: 'kitchenCoffeeMachine.glb',
        format: 'glb',
        source: 'kenney',
        license: 'CC0 1.0',
        importedAt: 1,
        provenance: {
          provider: 'kenney',
          catalogAssetId: 'kenney:furniture-kit:kitchenCoffeeMachine',
          packId: 'kenney-furniture-kit-1.0',
          sourcePageUrl: 'https://kenney.nl/assets/furniture-kit',
          downloadUrl: 'https://kenney.nl/furniture.zip',
          licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
          archiveSha256: 'a'.repeat(64),
          fileSha256: 'b'.repeat(64),
        },
      }],
    })

    expect(state.assets[0]).toMatchObject({
      source: 'kenney',
      license: 'CC0 1.0',
      provenance: {
        provider: 'kenney',
        catalogAssetId: 'kenney:furniture-kit:kitchenCoffeeMachine',
        archiveSha256: 'a'.repeat(64),
        fileSha256: 'b'.repeat(64),
      },
    })
  })

  it('normalizes legacy marker roles already persisted in Blender Director state', () => {
    const base = createVibingDirectorState(1)
    const state = normalizeVibingDirectorState({
      ...base,
      objects: [
        { id: 'barista', name: '咖啡师', kind: 'marker', role: 'mannequin', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        { id: 'actor-A', name: '角色A', kind: 'marker', role: 'character_marker', position: [0, 0, 1], rotation: [0, 180, 0], scale: [1, 1, 1] },
        { id: 'table-main', name: '咖啡桌', kind: 'marker', role: 'prop_marker', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        { id: 'cup-A', name: '咖啡杯A', kind: 'marker', role: 'prop_marker', position: [0, 0.76, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      ],
    })

    expect(state.objects.map((object) => object.role)).toEqual([
      'actor_standing',
      'actor_seated',
      'table',
      'cup',
    ])
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
    expect(result.state.camera.framing).toBe('all')
  })

  it('validates camera targets and synchronizes the actual Blender preview camera', () => {
    const state = createVibingDirectorState()
    state.objects = [
      { id: 'actor-A', name: '角色A', kind: 'marker', role: 'actor_seated', position: [0, 0, 1], rotation: [0, 180, 0], scale: [1, 1, 1] },
    ]

    const missing = applyVibingDirectorPlan(state, {
      mode: 'amend',
      actions: [{ op: 'set_camera', framing: 'target', targetRef: 'actor-missing' }],
    })
    expect(missing.rejected).toEqual(['当前没有相机目标「actor-missing」'])

    const applied = applyVibingDirectorPlan(state, {
      mode: 'amend',
      actions: [{ op: 'set_camera', framing: 'target', targetRef: 'actor-A' }],
    }, {
      jobId: 'job-camera-sync',
      previewUrl: 'nomi://preview.png',
      blendUrl: 'nomi://scene.blend',
      modelUrl: 'nomi://scene.glb',
      blendRelativePath: '.nomi/vibing-director/node/scene.blend',
      previewCamera: {
        id: 'director-camera',
        name: '角色A 跟拍',
        position: [3, 2, 4],
        lookAt: [0, 0.9, 1],
        fov: 50,
        aspectRatio: '16:9',
        framing: 'target',
        targetRef: 'actor-A',
      },
      createdAt: 1,
    })

    expect(applied.rejected).toEqual([])
    expect(applied.state.camera).toEqual(expect.objectContaining({
      name: '角色A 跟拍',
      position: [3, 2, 4],
      lookAt: [0, 0.9, 1],
      framing: 'target',
      targetRef: 'actor-A',
    }))
  })

  it('keeps facing, distance and support relations stable in the Director document', () => {
    const state = createVibingDirectorState()
    state.objects = [
      { id: 'table-main', name: '咖啡桌', kind: 'marker', role: 'table', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: 'cup-A', name: '咖啡杯A', kind: 'marker', role: 'cup', position: [-0.3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: 'actor-A', name: '角色A', kind: 'marker', role: 'actor_seated', position: [0, 0, 1.25], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: 'actor-B', name: '角色B', kind: 'marker', role: 'actor_seated', position: [0, 0, -1.25], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ]

    const result = applyVibingDirectorPlan(state, {
      mode: 'amend',
      actions: [
        { op: 'set_relation', id: 'cup-on-table', kind: 'support', subjectRef: 'cup-A', targetRef: 'table-main' },
        { op: 'set_relation', id: 'actors-distance', kind: 'distance', subjectRef: 'actor-A', targetRef: 'actor-B', distance: 2.5 },
        { op: 'set_relation', id: 'actors-facing', kind: 'facing', subjectRef: 'actor-A', targetRef: 'actor-B', mutual: true },
      ] as never,
    })
    const related = result.state as unknown as {
      relations: Array<{ id: string }>
      objects: typeof state.objects
    }

    expect(result.rejected).toEqual([])
    expect(related.relations.map((relation) => relation.id)).toEqual([
      'cup-on-table',
      'actors-distance',
      'actors-facing',
    ])
    expect(related.objects.find((object) => object.id === 'cup-A')?.position[1]).toBeCloseTo(0.85, 4)
    expect(related.objects.find((object) => object.id === 'actor-A')?.position[2]).toBeCloseTo(1.25, 4)
    expect(related.objects.find((object) => object.id === 'actor-A')?.rotation[1]).toBeCloseTo(180, 4)
    expect(related.objects.find((object) => object.id === 'actor-B')?.rotation[1]).toBeCloseTo(0, 4)

    const moved = applyVibingDirectorPlan(result.state, {
      mode: 'amend',
      actions: [{ op: 'move_object', objectRef: 'table-main', position: [1, 0, 0] }],
    })
    expect(moved.state.objects.find((object) => object.id === 'cup-A')?.position).toEqual([-0.3 + 1, 0.85, 0])

    const synced = applyVibingDirectorPlan(result.state, {
      mode: 'amend',
      actions: [{ op: 'move_object', objectRef: 'table-main', position: [1, 0, 0] }],
    }, {
      jobId: 'job-object-sync',
      previewUrl: 'nomi://preview.png',
      blendUrl: 'nomi://scene.blend',
      modelUrl: 'nomi://scene.glb',
      blendRelativePath: '.nomi/vibing-director/node/scene.blend',
      objectTransforms: [{
        id: 'cup-A',
        name: '咖啡杯A',
        position: [0.7, 0.85, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }],
      createdAt: 1,
    } as never)
    expect(synced.state.objects.find((object) => object.id === 'cup-A')?.position).toEqual([0.7, 0.85, 0])
  })

  it('keeps a grouped object at its relative offset after the target moves', () => {
    const state = createVibingDirectorState()
    state.objects = [
      { id: 'actor-A', name: '角色A', kind: 'marker', role: 'actor_seated', position: [0, 0, 1.25], rotation: [0, 180, 0], scale: [1, 1, 1] },
      { id: 'chair-A', name: '椅子A', kind: 'marker', role: 'chair', position: [0, 0, 1.25], rotation: [0, 180, 0], scale: [1, 1, 1] },
    ]

    const related = applyVibingDirectorPlan(state, {
      mode: 'amend',
      actions: [{
        op: 'set_relation',
        id: 'chair-follows-actor',
        kind: 'offset',
        subjectRef: 'chair-A',
        targetRef: 'actor-A',
      }] as never,
    })
    const moved = applyVibingDirectorPlan(related.state, {
      mode: 'amend',
      actions: [{ op: 'move_object', objectRef: 'actor-A', position: [2, 0, -1] }],
    })

    expect(related.rejected).toEqual([])
    expect(moved.rejected).toEqual([])
    expect(moved.state.objects.find((object) => object.id === 'chair-A')?.position).toEqual([2, 0, -1])
  })

  it('keeps a grouped object at its relative rotation after the target turns', () => {
    const state = createVibingDirectorState()
    state.objects = [
      { id: 'actor-A', name: '角色A', kind: 'marker', role: 'actor_seated', position: [0, 0, 1.25], rotation: [0, 180, 0], scale: [1, 1, 1] },
      { id: 'chair-A', name: '椅子A', kind: 'marker', role: 'chair', position: [0, 0, 1.25], rotation: [0, 135, 0], scale: [1, 1, 1] },
      { id: 'actor-B', name: '角色B', kind: 'marker', role: 'actor_seated', position: [2, 0, -1.25], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ]

    const related = applyVibingDirectorPlan(state, {
      mode: 'amend',
      actions: [
        {
          op: 'set_relation',
          id: 'chair-follows-actor',
          kind: 'offset',
          subjectRef: 'chair-A',
          targetRef: 'actor-A',
        },
        {
          op: 'set_relation',
          id: 'actors-facing',
          kind: 'facing',
          subjectRef: 'actor-A',
          targetRef: 'actor-B',
        },
      ] as never,
    })

    const actor = related.state.objects.find((object) => object.id === 'actor-A')
    const chair = related.state.objects.find((object) => object.id === 'chair-A')
    const yawDelta = (((chair?.rotation[1] ?? 0) - (actor?.rotation[1] ?? 0) + 540) % 360) - 180
    const turnedAgain = applyVibingDirectorPlan(related.state, {
      mode: 'amend',
      actions: [{ op: 'move_object', objectRef: 'actor-B', position: [-2, 0, -1.25] }],
    })
    const nextActor = turnedAgain.state.objects.find((object) => object.id === 'actor-A')
    const nextChair = turnedAgain.state.objects.find((object) => object.id === 'chair-A')
    const nextYawDelta = (((nextChair?.rotation[1] ?? 0) - (nextActor?.rotation[1] ?? 0) + 540) % 360) - 180

    expect(related.rejected).toEqual([])
    expect(related.state.relations.find((relation) => relation.id === 'chair-follows-actor')).toMatchObject({
      relativeRotation: [0, -45, 0],
    })
    expect(yawDelta).toBeCloseTo(-45, 4)
    expect(turnedAgain.rejected).toEqual([])
    expect(nextYawDelta).toBeCloseTo(-45, 4)
  })

  it('reports the exact unresolved id before a spatial relation reaches Blender', () => {
    const result = applyVibingDirectorPlan(createVibingDirectorState(), {
      mode: 'amend',
      actions: [{
        op: 'set_relation',
        id: 'missing-facing',
        kind: 'line_of_sight',
        subjectRef: 'actor-A',
        targetRef: 'actor-B',
      }] as never,
    })

    expect(result.rejected).toEqual([
      '空间关系「missing-facing」找不到对象「actor-A」',
      '空间关系「missing-facing」找不到对象「actor-B」',
    ])
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
      expect.objectContaining({ op: 'set_relation', id: 'chair-A-follows-actor-A', kind: 'offset', subjectRef: 'chair-A', targetRef: 'actor-A' }),
      expect.objectContaining({ op: 'set_relation', id: 'chair-B-follows-actor-B', kind: 'offset', subjectRef: 'chair-B', targetRef: 'actor-B' }),
      expect.objectContaining({ op: 'set_relation', id: 'cup-A-on-table', kind: 'support', subjectRef: 'cup-A', targetRef: 'table-main' }),
      expect.objectContaining({ op: 'set_relation', id: 'actors-distance', kind: 'distance', distance: 2.5 }),
      expect.objectContaining({ op: 'set_relation', id: 'actors-facing', kind: 'facing', mutual: true }),
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
