import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectSessionTestHarness, testProjectBinding, type ProjectSessionTestHarness } from '../../src/workbench/project/projectSessionTestHarness'
import { dispatchCustomLocalCanvas } from './customLocalCanvasDispatcher'

const edges = vi.hoisted(() => ({
  mint: vi.fn(async () => 'fixture-batch-grant'),
  quote: vi.fn(async () => ({ quoteId: 'fixture-batch-quote' })),
  execute: vi.fn(async () => ({ totalCount: 1, successes: ['node-1'], failures: [] })),
  log: vi.fn(),
}))

vi.mock('../../src/workbench/api/taskApi', async load => ({
  ...await load<typeof import('../../src/workbench/api/taskApi')>(),
  mintSpendGrant: edges.mint,
}))
vi.mock('../../src/desktop/bridge', async load => ({
  ...await load<typeof import('../../src/desktop/bridge')>(),
  getDesktopBridge: () => ({ tasks: { quoteSpend: edges.quote } }),
}))
vi.mock('../../src/workbench/generationCanvas/runner/generationRunWaves', () => ({
  runGenerationNodesByPlan: edges.execute,
}))
vi.mock('../../src/desktop/rendererLog', () => ({ logRendererError: edges.log }))

import { useGenerationCanvasStore } from '../../src/workbench/generationCanvas/store/generationCanvasStore'
import { useSpendConfirmStore } from '../../src/workbench/generationCanvas/spend/spendConfirm'
import { handleCapabilityApply } from '../../src/workbench/capability/capabilityApplyHandler'

let projectSession: ProjectSessionTestHarness
let unsubscribe: () => void
let confirmations: Set<unknown>
const payload = { projectId: 'project-1', nodeIds: ['node-1', 'node-1'] }
const flushQueueCompletion = () => new Promise<void>(resolve => setImmediate(resolve))

beforeEach(async () => {
  vi.clearAllMocks()
  projectSession = createProjectSessionTestHarness()
  await projectSession.open('project-1')
  await import('../../src/workbench/generationCanvas/components/batchPlanPreview')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{
    id: 'node-1', kind: 'image', title: 'Image', status: 'idle', prompt: '原始 prompt',
    position: { x: 0, y: 0 }, size: { width: 320, height: 240 },
  }], edges: [], groups: [], selectedNodeIds: [] })
  useSpendConfirmStore.setState({ pending: null, queue: [] })
  confirmations = new Set()
  unsubscribe = useSpendConfirmStore.subscribe(state => {
    for (const entry of [state.pending, ...state.queue]) if (entry) confirmations.add(entry.resolve)
  })
})

afterEach(async () => {
  while (useSpendConfirmStore.getState().pending) useSpendConfirmStore.getState().resolvePending(false)
  await flushQueueCompletion()
  unsubscribe()
  projectSession.dispose()
})

async function queueAndWaitForCard() {
  await expect(handleCapabilityApply('generation.batch', payload)).resolves.toEqual({
    awaitingConfirmation: true, nodeIds: ['node-1'],
  })
  await vi.waitFor(() => expect(useSpendConfirmStore.getState().pending).not.toBeNull())
  expect(confirmations.size).toBe(1)
  expect(useSpendConfirmStore.getState().queue).toEqual([])
  expect(edges.mint).not.toHaveBeenCalled()
  expect(edges.execute).not.toHaveBeenCalled()
}

describe('custom batch bridge compatibility through the real confirmation funnel', () => {
  it('rejects semantic bindings before opening the legacy confirmation card', async () => {
    const renderer = vi.fn((projectId: string, nodeIds: string[]) => handleCapabilityApply('generation.batch', { projectId, nodeIds }))
    const verifyLease = vi.fn(async () => { throw new Error('semantic bindings must be rejected before lease resolution') })
    await expect(dispatchCustomLocalCanvas('generation.batch', {
      ...payload, operationId: 'sealed-operation',
    }, { runGenerationBatch: renderer, makeGateway: () => { throw new Error('no gateway expected') } }, verifyLease))
      .rejects.toMatchObject({ code: 'legacy_path_forbidden' })
    expect(renderer).not.toHaveBeenCalled()
    expect(verifyLease).not.toHaveBeenCalled()
    expect(confirmations.size).toBe(0)
    expect(edges.quote).not.toHaveBeenCalled()
    expect(edges.mint).not.toHaveBeenCalled()
    expect(edges.execute).not.toHaveBeenCalled()
  })

  it('asks once and executes once despite duplicate batch requests', async () => {
    const originalGraph = JSON.stringify(useGenerationCanvasStore.getState().nodes)
    await queueAndWaitForCard()
    await expect(handleCapabilityApply('generation.batch', payload)).rejects.toThrow('已有生成确认正在等待处理')
    expect(confirmations.size).toBe(1)
    expect(edges.quote).toHaveBeenCalledOnce()
    useSpendConfirmStore.getState().resolvePending(true)
    await vi.waitFor(() => expect(edges.execute).toHaveBeenCalledOnce())
    // A second decision on an already-resolved card is not a second submission.
    useSpendConfirmStore.getState().resolvePending(true)
    await flushQueueCompletion()
    expect(edges.mint).toHaveBeenCalledExactlyOnceWith(['node-1'], undefined, 'fixture-batch-quote')
    expect(edges.execute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ waves: [['node-1']], blocked: [] }),
      expect.objectContaining({ target: testProjectBinding('project-1'), grantId: 'fixture-batch-grant',
        assetUploadConsent: 'not-needed', assertAuthorCurrent: expect.any(Function), assertApprovedInputs: expect.any(Function) }),
    )
    expect(confirmations.size).toBe(1)
    expect(JSON.stringify(useGenerationCanvasStore.getState().nodes)).toBe(originalGraph)
    expect(edges.log).not.toHaveBeenCalled()
  })

  it.each([false, true])('does not mint or execute an accepted old-project confirmation (A→B→A=%s)', async returnToA => {
    await queueAndWaitForCard()
    await projectSession.open('project-2')
    if (returnToA) await projectSession.open('project-1')
    useSpendConfirmStore.getState().resolvePending(true)
    await vi.waitFor(() => expect(edges.log).toHaveBeenCalledOnce())
    await flushQueueCompletion()
    expect(edges.mint).not.toHaveBeenCalled()
    expect(edges.execute).not.toHaveBeenCalled()
    expect(confirmations.size).toBe(1)
  })

  it('does not mint or execute a declined confirmation', async () => {
    await queueAndWaitForCard()
    useSpendConfirmStore.getState().resolvePending(false)
    await flushQueueCompletion()
    expect(edges.mint).not.toHaveBeenCalled()
    expect(edges.execute).not.toHaveBeenCalled()
    expect(edges.log).not.toHaveBeenCalled()
  })

  it.each(['not-open', 'foreign-project'])('rejects %s before quoting or opening a card', async mode => {
    if (mode === 'not-open') projectSession.close()
    await expect(handleCapabilityApply('generation.batch', {
      ...payload, projectId: mode === 'foreign-project' ? 'project-2' : 'project-1',
    })).rejects.toThrow()
    expect(confirmations.size).toBe(0)
    expect(edges.quote).not.toHaveBeenCalled()
    expect(edges.mint).not.toHaveBeenCalled()
    expect(edges.execute).not.toHaveBeenCalled()
  })
})
