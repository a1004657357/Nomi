import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  projectId: 'project-1',
  requestConfirm: vi.fn<() => Promise<boolean>>(),
  applyTool: vi.fn(async () => ({ accepted: true })),
}))

vi.mock('../../src/workbench/project/workbenchProjectSession', () => ({
  getActiveWorkbenchProjectId: () => harness.projectId,
}))
vi.mock('../../src/workbench/generationCanvas/spend/spendConfirm', () => ({
  useSpendConfirmStore: { getState: () => ({ pending: null, requestConfirm: harness.requestConfirm }) },
  describeGenerationCost: () => 'generation cost',
}))
vi.mock('../../src/workbench/generationCanvas/runner/generationRunController', () => ({
  spendCostKindForNodes: () => 'image',
  runGenerationNode: vi.fn(),
  resolveAutonomousUploadConsent: vi.fn(),
}))
vi.mock('../../src/workbench/generationCanvas/agent/applyCanvasToolCall', () => ({
  applyCanvasToolCall: harness.applyTool,
  resolveCanvasToolNodeId: (id: string) => id,
}))

import { useGenerationCanvasStore } from '../../src/workbench/generationCanvas/store/generationCanvasStore'
import { handleCapabilityApply } from '../../src/workbench/capability/capabilityApplyHandler'

beforeEach(() => {
  harness.projectId = 'project-1'
  harness.requestConfirm.mockReset()
  harness.applyTool.mockClear()
  useGenerationCanvasStore.setState({ nodes: [{
    id: 'node-1', kind: 'image', title: 'Image', status: 'idle',
    position: { x: 0, y: 0 }, size: { width: 320, height: 240 },
  }] })
})

describe('custom batch bridge compatibility', () => {
  it('rejects semantic bindings before opening the legacy confirmation card', async () => {
    await expect(handleCapabilityApply('generation.batch', {
      projectId: 'project-1', nodeIds: ['node-1'], operationId: 'sealed-operation',
    })).rejects.toMatchObject({ code: 'legacy_path_forbidden' })
    expect(harness.requestConfirm).not.toHaveBeenCalled()
    expect(harness.applyTool).not.toHaveBeenCalled()
  })

  it('asks once and executes once despite duplicate batch requests', async () => {
    let decide!: (confirmed: boolean) => void
    harness.requestConfirm.mockImplementation(() => new Promise((resolve) => { decide = resolve }))
    const payload = { projectId: 'project-1', nodeIds: ['node-1', 'node-1'] }
    await expect(handleCapabilityApply('generation.batch', payload)).resolves.toMatchObject({
      awaitingConfirmation: true, nodeIds: ['node-1'],
    })
    await vi.waitFor(() => expect(harness.requestConfirm).toHaveBeenCalledTimes(1))
    expect(harness.applyTool).not.toHaveBeenCalled()
    await expect(handleCapabilityApply('generation.batch', payload)).rejects.toThrow()
    decide(true)
    await vi.waitFor(() => expect(harness.applyTool).toHaveBeenCalledExactlyOnceWith('run_generation_batch', { nodeIds: ['node-1'] }))
  })

  it('does not apply an accepted old-project confirmation to the newly active project', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      harness.requestConfirm.mockImplementation(async () => {
        harness.projectId = 'project-2'
        return true
      })
      await handleCapabilityApply('generation.batch', { projectId: 'project-1', nodeIds: ['node-1'] })
      await vi.waitFor(() => expect(log).toHaveBeenCalled())
      expect(harness.applyTool).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
})
