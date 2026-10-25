import { describe, expect, it, vi } from 'vitest'
import {
  buildVibingDirectorStructuredRepairMessage,
  evaluateVibingDirectorToolCall,
  resolveVibingDirectorStructuredPlan,
  resolveVibingDirectorStructuredPlanWithRepair,
} from './vibingDirectorAgentProtocol'
import { createVibingDirectorState } from './vibingDirectorState'

const validPlan = {
  directorNodeId: 'director-1',
  summary: '调整角色位置。',
  plan: {
    mode: 'amend' as const,
    actions: [
      { op: 'move_object' as const, objectRef: 'actor-A', position: [1, 0, 0] as [number, number, number] },
    ],
  },
}

function stateWithActor() {
  const state = createVibingDirectorState()
  state.objects = [{
    id: 'actor-A',
    name: '角色A',
    kind: 'marker',
    role: 'actor_seated',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }]
  return state
}

describe('VIBING Director Agent protocol policy', () => {
  it('explains when a structured provider returned only prose in an answer wrapper', () => {
    const result = resolveVibingDirectorStructuredPlan(
      JSON.stringify({ answer: '# Blender 导演建议\n请手动调整场景。' }),
      'director-1',
      stateWithActor(),
    )

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: 'explanation_only',
    }))
    if (!result.ok) expect(result.message).toContain('只返回了解释文本')
  })

  it('distinguishes a wrong node id from an invalid plan shape', () => {
    const wrongNode = resolveVibingDirectorStructuredPlan(
      JSON.stringify({ ...validPlan, directorNodeId: 'director-2' }),
      'director-1',
      stateWithActor(),
    )
    const invalidPlan = resolveVibingDirectorStructuredPlan(
      JSON.stringify({
        directorNodeId: 'director-1',
        summary: '执行脚本。',
        plan: { mode: 'amend', actions: [{ op: 'run_python', script: 'import bpy' }] },
      }),
      'director-1',
      stateWithActor(),
    )

    expect(wrongNode).toEqual(expect.objectContaining({ ok: false, code: 'wrong_node_id' }))
    expect(invalidPlan).toEqual(expect.objectContaining({ ok: false, code: 'invalid_plan' }))
  })

  it('preflights object references before showing a Blender confirmation', () => {
    const result = resolveVibingDirectorStructuredPlan(
      JSON.stringify({
        ...validPlan,
        plan: {
          mode: 'amend',
          actions: [{ op: 'move_object', objectRef: 'actor-missing', position: [1, 0, 0] }],
        },
      }),
      'director-1',
      stateWithActor(),
    )

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: 'preflight_rejected',
    }))
    if (!result.ok) expect(result.message).toContain('actor-missing')
  })

  it('requires a valid read of the current node before accepting a native apply call', () => {
    const state = stateWithActor()
    const beforeRead = evaluateVibingDirectorToolCall({
      toolName: 'apply_vibing_director_plan',
      args: validPlan,
      directorNodeId: 'director-1',
      state,
      inspected: false,
    })
    const wrongRead = evaluateVibingDirectorToolCall({
      toolName: 'read_vibing_director',
      args: { directorNodeId: 'director-2' },
      directorNodeId: 'director-1',
      state,
      inspected: false,
    })
    const read = evaluateVibingDirectorToolCall({
      toolName: 'read_vibing_director',
      args: { directorNodeId: 'director-1' },
      directorNodeId: 'director-1',
      state,
      inspected: false,
    })
    const afterRead = evaluateVibingDirectorToolCall({
      toolName: 'apply_vibing_director_plan',
      args: validPlan,
      directorNodeId: 'director-1',
      state,
      inspected: read.kind === 'read' && read.inspected,
    })

    expect(beforeRead).toEqual(expect.objectContaining({ kind: 'reject', inspected: false }))
    if (beforeRead.kind === 'reject') expect(beforeRead.message).toContain('先读取')
    expect(wrongRead).toEqual(expect.objectContaining({ kind: 'reject', inspected: false }))
    expect(read).toEqual({ kind: 'read', inspected: true })
    expect(afterRead).toEqual(expect.objectContaining({
      kind: 'apply',
      inspected: true,
      request: expect.objectContaining({ directorNodeId: 'director-1' }),
    }))
  })

  it('builds a bounded repair request with the original intent and exact failure', () => {
    const message = buildVibingDirectorStructuredRepairMessage({
      directorNodeId: 'director-1',
      originalMessage: '把角色A移动到桌子左侧。',
      failure: '计划与当前 Blender 状态不一致：找不到 Blender 对象「actor-missing」',
    })

    expect(message).toContain('director-1')
    expect(message).toContain('把角色A移动到桌子左侧')
    expect(message).toContain('actor-missing')
    expect(message).toContain('只返回一个 JSON 对象')
    expect(message).toContain('不要解释')
  })

  it('repairs one invalid structured response exactly once', async () => {
    const repair = vi.fn<(message: string) => Promise<string>>(async () => JSON.stringify(validPlan))
    const result = await resolveVibingDirectorStructuredPlanWithRepair({
      initialText: JSON.stringify({ answer: '这里只给出说明，没有计划。' }),
      directorNodeId: 'director-1',
      state: stateWithActor(),
      originalMessage: '移动角色A。',
      repair,
    })

    expect(result.resolution).toEqual(expect.objectContaining({ ok: true }))
    expect(result.repaired).toBe(true)
    expect(repair).toHaveBeenCalledTimes(1)
    expect(repair.mock.calls[0]?.[0]).toContain('只返回一个 JSON 对象')
  })

  it('stops after one failed repair instead of entering a retry loop', async () => {
    const repair = vi.fn(async () => JSON.stringify({ answer: '仍然只有说明。' }))
    const result = await resolveVibingDirectorStructuredPlanWithRepair({
      initialText: '不是 JSON',
      directorNodeId: 'director-1',
      state: stateWithActor(),
      originalMessage: '移动角色A。',
      repair,
    })

    expect(result.resolution).toEqual(expect.objectContaining({
      ok: false,
      code: 'explanation_only',
    }))
    expect(result.repaired).toBe(true)
    expect(repair).toHaveBeenCalledTimes(1)
  })
})
