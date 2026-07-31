import { describe, expect, it } from 'vitest'
import {
  parseVibingDirectorPlanRequest,
  parseVibingDirectorStructuredPlanResponse,
} from './vibingDirectorStructuredProtocol'
import { applyVibingDirectorPlan, createVibingDirectorState } from './vibingDirectorState'

describe('VIBING Director structured-text compatibility protocol', () => {
  it('parses a Blender plan from ordinary JSON text', () => {
    const raw = parseVibingDirectorStructuredPlanResponse(`\`\`\`json
{
  "directorNodeId": "director-1",
  "summary": "在 Blender 中搭建雨后咖啡店开场。",
  "plan": {
    "mode": "replace",
    "brief": "雨后咖啡店广告",
    "actions": [
      { "op": "set_stage", "preset": "coffee_shop" },
      { "op": "add_marker", "id": "barista", "name": "咖啡师", "position": [-1, 0, 0] },
      { "op": "set_camera", "position": [5, 2.4, 6], "lookAt": [0, 1, 0], "fov": 42 }
    ]
  }
}
\`\`\``)
    const request = parseVibingDirectorPlanRequest(raw)

    expect(request).toEqual(expect.objectContaining({
      directorNodeId: 'director-1',
      summary: '在 Blender 中搭建雨后咖啡店开场。',
    }))
    expect(request?.plan.actions).toHaveLength(3)
  })

  it('unwraps a JSON Director plan returned through a provider answer field', () => {
    const raw = parseVibingDirectorStructuredPlanResponse(JSON.stringify({
      answer: JSON.stringify({
        directorNodeId: 'director-1',
        summary: '修复咖啡店人物摆位。',
        plan: {
          mode: 'amend',
          actions: [
            { op: 'move_object', objectRef: 'actor-A', position: [-1.2, 0, 0] },
          ],
        },
      }),
    }))

    expect(parseVibingDirectorPlanRequest(raw)).toEqual(expect.objectContaining({
      directorNodeId: 'director-1',
      summary: '修复咖啡店人物摆位。',
    }))
  })

  it('accepts a relationship-first coffee conversation layout from the compatibility protocol', () => {
    const request = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '按双人咖啡桌关系重新整理摆位。',
      plan: {
        mode: 'replace',
        actions: [
          {
            op: 'set_blocking_layout',
            template: 'coffee_two_person_conversation',
            actorAName: '角色A',
            actorBName: '角色B',
          },
          {
            op: 'set_relation',
            id: 'chair-follows-actor',
            kind: 'offset',
            subjectRef: 'chair-A',
            targetRef: 'actor-A',
          },
        ],
      },
    })

    expect(request?.plan.actions).toEqual([
      expect.objectContaining({ op: 'set_blocking_layout', template: 'coffee_two_person_conversation' }),
      expect.objectContaining({ op: 'set_relation', kind: 'offset' }),
    ])
  })

  it('rejects raw scripts, URLs and malformed actions before Blender can receive them', () => {
    expect(parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '执行 Blender 脚本',
      plan: { mode: 'replace', actions: [{ op: 'run_python', script: 'import bpy' }] },
    })).toBeNull()
    expect(parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1', summary: '下载模型',
      plan: { mode: 'replace', actions: [{ op: 'place_asset', id: 'bad', assetId: 'https://example.com/model.glb', name: '未知模型' }] },
    })).toBeNull()
  })

  it('migrates the observed action/create/update fallback dialect into a safe Blender plan', () => {
    const request = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '雨后咖啡街景。',
      patches: [
        { action: 'create', type: 'room', name: '咖啡店室内' },
        { action: 'create', type: 'mannequin', name: '咖啡师', position: [0, 0, 0], pose: 'standing' },
        { action: 'update', targetId: 'director-camera', position: [4, 2, 5], lookAt: [0, 1, 0], focalLength: 42 },
      ],
    })

    expect(request?.plan.actions).toEqual([
      { op: 'set_stage', preset: 'interior_room' },
      expect.objectContaining({ op: 'add_marker', name: '咖啡师', role: 'actor_standing' }),
      expect.objectContaining({ op: 'set_camera', cameraRef: 'director-camera', fov: 42 }),
    ])
  })

  it('migrates the persisted patches dialect without losing semantic roles or camera motion', () => {
    const request = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '雨后咖啡街景。',
      patches: [
        { op: 'set_brief', value: '雨后咖啡店递杯场景' },
        { op: 'add_scene', id: 'street', type: 'city_street', name: '雨后街道' },
        {
          op: 'add_object',
          id: 'barista',
          type: 'mannequin',
          name: '咖啡师',
          position: { x: -1, y: 0, z: 0 },
          rotation: { x: 0, y: 90, z: 0 },
          scale: 0.9,
          pose: '右手递物，站立并微微前倾',
        },
        {
          op: 'add_object',
          id: 'customer',
          type: 'mannequin',
          name: '顾客',
          position: { x: 1, y: 0, z: 0 },
          pose: '隔桌对坐并伸手接物',
        },
        {
          op: 'set_camera_track',
          id: 'legacy-camera',
          keyframes: [
            { time: 0, position: { x: 4, y: 2.2, z: 6 } },
            { time: 4, position: { x: 2.2, y: 1.7, z: 3.2 } },
          ],
        },
      ],
    })

    expect(request?.plan.brief).toBe('雨后咖啡店递杯场景')
    expect(request?.plan.actions).toEqual([
      { op: 'set_stage', preset: 'city_street' },
      expect.objectContaining({
        op: 'add_marker',
        id: 'barista',
        role: 'actor_standing',
        position: [-1, 0, 0],
        rotation: [0, 90, 0],
        scale: [0.9, 0.9, 0.9],
      }),
      expect.objectContaining({
        op: 'add_marker',
        id: 'customer',
        role: 'actor_seated',
        position: [1, 0, 0],
      }),
      {
        op: 'set_camera_path',
        points: [[4, 2.2, 6], [2.2, 1.7, 3.2]],
        durationSec: 4,
      },
    ])
  })

  it('maps legacy character and prop markers to Blender semantic proxies', () => {
    const request = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '恢复旧版咖啡桌摆位。',
      plan: {
        mode: 'replace',
        actions: [
          { type: 'addObject', objectId: 'actor-A', kind: 'character_marker', label: '角色A', position: [0, 0, 1], pose: 'seated', scale: 1 },
          { type: 'addObject', objectId: 'table-main', kind: 'prop_marker', label: '咖啡桌', position: [0, 0, 0], scale: 1.25 },
          { type: 'addObject', objectId: 'cup-A', kind: 'prop_marker', label: '咖啡杯A', position: [-0.3, 0.76, 0], scale: 0.8 },
        ],
      },
    })

    expect(request?.plan.actions).toEqual([
      expect.objectContaining({ op: 'add_marker', id: 'actor-A', role: 'actor_seated', scale: [1, 1, 1] }),
      expect.objectContaining({ op: 'add_marker', id: 'table-main', role: 'table', scale: [1.25, 1.25, 1.25] }),
      expect.objectContaining({ op: 'add_marker', id: 'cup-A', role: 'cup', scale: [0.8, 0.8, 0.8] }),
    ])
  })

  it('migrates the legacy director stage actions nested in plan.actions', () => {
    const request = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '咖啡店双人对话的机位和节拍。',
      plan: {
        mode: 'replace',
        actions: [
          { type: 'setStagePreset', preset: 'coffeeShop' },
          {
            type: 'addObject',
            objectId: 'barista',
            label: '咖啡师',
            kind: 'mannequin',
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          {
            type: 'setDirectorCamera',
            objectId: 'director-camera',
            label: '主机位',
            position: [4, 2, 5],
            lookAt: [0, 1, 0],
            fov: 42,
          },
          {
            type: 'addBeat',
            beatId: 'beat-1',
            action: '咖啡师递出咖啡。',
            cameraNote: '中景推近。',
            dialogue: '请慢用。',
            note: '保留杯口热气。',
            duration: 3,
          },
        ],
      },
    })

    expect(request?.plan.actions).toEqual([
      { op: 'set_stage', preset: 'coffee_shop' },
      expect.objectContaining({ op: 'add_marker', id: 'barista', name: '咖啡师', role: 'actor_standing' }),
      expect.objectContaining({ op: 'set_camera', cameraRef: 'director-camera', name: '主机位', fov: 42 }),
      expect.objectContaining({ op: 'set_beat', id: 'beat-1', durationSec: 3, notes: '保留杯口热气。' }),
    ])
  })

  it('uses the one Blender Director camera for legacy virtual camera IDs', () => {
    const request = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '咖啡店双人对话的三组镜头。',
      plan: {
        mode: 'replace',
        actions: [
          { type: 'setStagePreset', preset: 'coffeeShop' },
          { type: 'setDirectorCamera', objectId: 'cam-main', label: '主机位', position: [4, 2, 5], lookAt: [0, 1, 0], fov: 42 },
          { type: 'setDirectorCamera', objectId: 'cam-OTS-A', label: 'A 过肩镜头', position: [3, 2, 4], lookAt: [0, 1, 0], fov: 50 },
          { type: 'setDirectorCamera', objectId: 'cam-OTS-B', label: 'B 过肩镜头', position: [-3, 2, 4], lookAt: [0, 1, 0], fov: 50 },
        ],
      },
    })

    const cameraActions = request?.plan.actions.filter((action) => action.op === 'set_camera') ?? []
    expect(cameraActions).toHaveLength(3)
    expect(cameraActions.every((action) => action.cameraRef === undefined)).toBe(true)

    const applied = request ? applyVibingDirectorPlan(createVibingDirectorState(), request.plan) : null
    expect(applied?.rejected).toEqual([])
  })
})
