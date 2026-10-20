import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeCreativeTool } from './creativeToolExecute'

const mocks = vi.hoisted(() => ({
  capability: vi.fn(), cinematic: vi.fn(), confirm: vi.fn(), spend: vi.fn(),
  issue: vi.fn(), assertCurrent: vi.fn(), persist: vi.fn(), readDirector: vi.fn(),
  evaluate: vi.fn(), applyDirector: vi.fn(), updateNode: vi.fn(), nodes: [] as unknown[],
}))
vi.mock('../generationCanvas/agent/capabilityRecipeToolHandlers', () => ({ tryApplyCapabilityToolCall: mocks.capability }))
vi.mock('../generationCanvas/agent/cinematicDirectorToolHandlers', () => ({ tryApplyCinematicDirectorToolCall: mocks.cinematic }))
vi.mock('../../design', () => ({ confirmDialog: mocks.confirm }))
vi.mock('../generationCanvas/spend/spendConfirm', () => ({
  describeGenerationCost: (count: number) => `${count} requests`,
  useSpendConfirmStore: { getState: () => ({ requestConfirm: mocks.spend }) },
}))
vi.mock('../project/projectCanvasReadSurface', () => ({ withProjectAction: mocks.issue }))
vi.mock('../project/workbenchProjectSession', () => ({ persistActiveWorkbenchProjectNow: mocks.persist }))
vi.mock('../generationCanvas/nodes/VibingDirectorEditor', () => ({ readVibingDirectorState: mocks.readDirector }))
vi.mock('../generationCanvas/nodes/vibingDirector/vibingDirectorAgentProtocol', () => ({ evaluateVibingDirectorToolCall: mocks.evaluate }))
vi.mock('../generationCanvas/nodes/vibingDirector/vibingDirectorState', () => ({ applyVibingDirectorPlan: mocks.applyDirector }))
vi.mock('../generationCanvas/store/generationCanvasStore', () => ({
  useGenerationCanvasStore: { getState: () => ({ nodes: mocks.nodes, updateNode: mocks.updateNode }) },
}))

const binding = { projectId: 'a', immutableProjectUuid: 'd7e7c52e-d433-4d1a-aef7-d17f4a642915', projectGeneration: 1 }
const defaults: Record<string, unknown> = {
  save_creative_resource: { sourceNodeId: 'source', kind: 'style', label: 'Style', license: { commercialUse: 'unknown' } },
  handoff_model3d: { sourceNodeId: 'source', target: 'scene3d' },
  apply_capability_recipe: { sourceNodeId: 'source', recipeId: 'image.multiview.grid9' },
}
const payload = (toolName: string, args: unknown = defaults[toolName] ?? {}) => ({
  binding, call: { toolCallId: 'call-a', toolName, args,
    policy: { allowGeneration: false, requirePaidConfirmation: true, autoResubmit: false } },
})

describe('creative tool renderer bridge', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.nodes = []
    mocks.issue.mockImplementation((run) => run({ binding, assertCurrent: mocks.assertCurrent, signal: new AbortController().signal }))
    mocks.capability.mockResolvedValue({ handled: false })
    mocks.cinematic.mockReturnValue({ handled: true, value: { read: true } })
    mocks.confirm.mockResolvedValue(true)
    mocks.persist.mockResolvedValue(undefined)
  })

  it('forwards a read without approval or media generation', async () => {
    expect(await executeCreativeTool(payload('read_film_bible'))).toMatchObject({ status: 'read', data: { read: true }, generationStarted: false, autoResubmit: false })
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.spend).not.toHaveBeenCalled()
  })

  it.each([
    { ...binding, projectId: 'b' },
    { ...binding, projectGeneration: 2 },
    { ...binding, immutableProjectUuid: '7c093274-1d2b-4838-bc7c-633d0a358917' },
  ])('rejects a different project lifetime before dispatch', async (otherBinding) => {
    await expect(executeCreativeTool({ ...payload('read_storyboard'), binding: otherBinding })).rejects.toThrow('project_binding_stale')
    expect(mocks.capability).not.toHaveBeenCalled()
    expect(mocks.cinematic).not.toHaveBeenCalled()
  })

  it('rejects absent or malformed binding and tool call id', async () => {
    await expect(executeCreativeTool({ call: { toolName: 'read_storyboard' } })).rejects.toThrow('capability_input_invalid')
    await expect(executeCreativeTool({ binding, call: { toolName: 'read_storyboard' } })).rejects.toThrow('capability_input_invalid')
  })

  it('does not dispatch unregistered or legacy paid aliases', async () => {
    await expect(executeCreativeTool(payload('run_generation_batch'))).rejects.toThrow('capability_input_invalid')
    expect(mocks.capability).not.toHaveBeenCalled()
  })

  it('a declined local write never reaches a mutation handler', async () => {
    mocks.confirm.mockResolvedValue(false)
    expect(await executeCreativeTool(payload('save_creative_resource'))).toMatchObject({ status: 'cancelled', data: { applied: false, declined: true } })
    expect(mocks.capability).not.toHaveBeenCalled()
    expect(mocks.cinematic).not.toHaveBeenCalled()
  })

  it('stops when a project switches during write confirmation', async () => {
    mocks.confirm.mockImplementation(async () => {
      mocks.assertCurrent.mockImplementation(() => { throw new Error('project switched') })
      return true
    })
    await expect(executeCreativeTool(payload('handoff_model3d'))).rejects.toThrow('project switched')
    expect(mocks.capability).not.toHaveBeenCalled()
  })

  it('passes plan-only policy and never starts paid execution through the lane bridge', async () => {
    mocks.capability.mockResolvedValue({ handled: true, value: { planned: true, plan: {} } })
    expect(await executeCreativeTool(payload('apply_capability_recipe'))).toMatchObject({
      status: 'planned', generationStarted: false, autoResubmit: false,
    })
    expect(mocks.spend).not.toHaveBeenCalled()
    expect(mocks.capability.mock.calls[0][0]).toMatchObject({ project: { binding }, planOnly: true, mutate: expect.any(Function) })
  })
  it('rejects a main request that permits generation or automatic resubmission', async () => {
    const request = payload('list_capability_recipes')
    await expect(executeCreativeTool({ ...request, call: { ...request.call, policy: { allowGeneration: true, requirePaidConfirmation: true, autoResubmit: false } } })).rejects.toThrow('capability_input_invalid')
    expect(mocks.capability).not.toHaveBeenCalled()
  })

  it('does not publish late results from an asynchronous handoff after a switch', async () => {
    mocks.capability.mockResolvedValue({ handled: true, value: Promise.resolve().then(() => {
      mocks.assertCurrent.mockImplementation(() => { throw new Error('project switched') })
      return { targetNodeId: 'late' }
    }) })
    await expect(executeCreativeTool(payload('handoff_model3d'))).rejects.toThrow('project switched')
  })

  it('declining a VIBING plan does not edit the document or invoke Blender', async () => {
    mocks.nodes = [{ id: 'director-a', kind: 'vibingDirector', meta: {} }]
    mocks.evaluate.mockReturnValue({ kind: 'apply', request: { summary: 'plan', plan: {} } })
    mocks.confirm.mockResolvedValue(false)
    expect(await executeCreativeTool(payload('apply_vibing_director_plan', { directorNodeId: 'director-a', summary: 'plan', plan: { mode: 'amend', actions: [{ op: 'set_stage', preset: 'empty' }] } }))).toMatchObject({ status: 'cancelled', data: { applied: false, declined: true } })
    expect(mocks.applyDirector).not.toHaveBeenCalled()
    expect(mocks.updateNode).not.toHaveBeenCalled()
  })
})
