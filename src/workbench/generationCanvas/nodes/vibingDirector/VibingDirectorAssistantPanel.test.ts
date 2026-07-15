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

  it('accepts a relationship-first coffee conversation layout from the compatibility protocol', () => {
    const request = parseVibingDirectorPlanRequest({
      directorNodeId: 'director-1',
      summary: '按双人咖啡桌关系重新整理摆位。',
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

    expect(request?.plan.actions).toEqual([
      expect.objectContaining({ op: 'set_blocking_layout', template: 'coffee_two_person_conversation' }),
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
      expect.objectContaining({ op: 'add_marker', name: '咖啡师' }),
      expect.objectContaining({ op: 'set_camera', cameraRef: 'director-camera', fov: 42 }),
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
      expect.objectContaining({ op: 'add_marker', id: 'barista', name: '咖啡师', role: 'mannequin' }),
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
