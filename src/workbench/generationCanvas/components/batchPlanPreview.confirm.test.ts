import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mintSpendGrant } from '../../api/taskApi'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { runGenerationNodesByPlan } from '../runner/generationRunWaves'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { confirmAndRunPlan, forkRegenerationNodesInPlan } from './batchPlanPreview'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'

let projectSession: ProjectSessionTestHarness

function confirmationGuards() {
  const project = withProjectAction((issued) => issued)!
  return {
    initiator: 'agent' as const,
    assertCurrent: async () => { project.assertCurrent() },
    assertAuthorCurrent: async () => { project.assertCurrent() },
  }
}

vi.mock('../../api/taskApi', () => ({
  mintSpendGrant: vi.fn(async () => 'grant-batch-version'),
}))

vi.mock('../runner/generationRunController', () => ({
  spendCostKindForNodes: vi.fn(() => 'image'),
}))

vi.mock('../runner/generationRunWaves', () => ({
  runGenerationNodesByPlan: vi.fn(async (plan: { waves: string[][] }) => ({
    totalCount: plan.waves.flat().length,
    successes: [],
    failures: [],
  })),
}))

function seedGeneratedNode(): string {
  const node = useGenerationCanvasStore.getState().addNode({
    kind: 'image',
    title: '镜头 V1',
    prompt: '原提示词',
    meta: { modelKey: 'old-model' },
  })
  useGenerationCanvasStore.getState().addNodeResult(node.id, {
    id: 'result-v1',
    type: 'image',
    url: 'https://example.com/v1.png',
    createdAt: 1,
  })
  return node.id
}

beforeEach(async () => {
  projectSession = createProjectSessionTestHarness()
  await projectSession.open('project-a')
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [],
    edges: [],
    groups: [],
    selectedNodeIds: [],
  })
  useSpendConfirmStore.setState({ pending: null, queue: [] })
  vi.clearAllMocks()
})

afterEach(() => { projectSession.dispose() })

describe('confirmAndRunPlan version protection', () => {
  it('does not fork before confirmation and leaves the canvas unchanged when cancelled', async () => {
    const sourceNodeId = seedGeneratedNode()
    const state = useGenerationCanvasStore.getState()
    const plan = buildDependencyWaves([sourceNodeId], { nodes: state.nodes, edges: state.edges })

    const pending = confirmAndRunPlan(plan, confirmationGuards())
    await vi.waitFor(() => expect(useSpendConfirmStore.getState().pending).not.toBeNull())
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)

    useSpendConfirmStore.getState().resolvePending(false)
    await pending

    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
    expect(mintSpendGrant).not.toHaveBeenCalled()
    expect(runGenerationNodesByPlan).not.toHaveBeenCalled()
  })

  it('runs an explicitly prepared V2 plan only after approval and grants only the V2 node', async () => {
    const sourceNodeId = seedGeneratedNode()
    const state = useGenerationCanvasStore.getState()
    const plan = buildDependencyWaves([sourceNodeId], { nodes: state.nodes, edges: state.edges })

    const forked = forkRegenerationNodesInPlan(plan, [sourceNodeId])
    const variantNodeId = forked?.sourceToVariant.get(sourceNodeId)
    if (!forked || !variantNodeId) throw new Error('missing variant')
    useGenerationCanvasStore.getState().updateNode(variantNodeId, { meta: { modelKey: 'new-model' } })
    const guards = confirmationGuards()
    const pending = confirmAndRunPlan(forked.plan, guards)
    await vi.waitFor(() => expect(useSpendConfirmStore.getState().pending).not.toBeNull())
    expect(mintSpendGrant).not.toHaveBeenCalled()
    expect(runGenerationNodesByPlan).not.toHaveBeenCalled()
    useSpendConfirmStore.getState().resolvePending(true)
    await pending

    const next = useGenerationCanvasStore.getState()
    const source = next.nodes.find((node) => node.id === sourceNodeId)
    const variant = next.nodes.find((node) => node.id === variantNodeId)
    expect(variant?.derivedFrom).toBe(sourceNodeId)
    expect(source?.result?.id).toBe('result-v1')
    expect(source?.meta?.modelKey).toBe('old-model')
    expect(variant?.result).toBeUndefined()
    expect(variant?.meta?.modelKey).toBe('new-model')
    expect(mintSpendGrant).toHaveBeenCalledExactlyOnceWith([variant?.id], undefined, undefined)
    expect(runGenerationNodesByPlan).toHaveBeenCalledWith(
      expect.objectContaining({ waves: [[variant?.id]] }),
      {
        target: withProjectAction((project) => project.binding),
        assertAuthorCurrent: guards.assertAuthorCurrent,
        assertApprovedInputs: expect.any(Function),
        grantId: 'grant-batch-version', assetUploadConsent: 'not-needed',
      },
    )
  })

  it('does not mint or submit when the issued project changes while confirmation is pending', async () => {
    const id = seedGeneratedNode()
    const state = useGenerationCanvasStore.getState()
    const plan = buildDependencyWaves([id], { nodes: state.nodes, edges: state.edges })
    const pending = confirmAndRunPlan(plan, confirmationGuards())
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(useSpendConfirmStore.getState().pending).not.toBeNull())
    await projectSession.open('project-b')
    useSpendConfirmStore.getState().resolvePending(true)
    await rejected
    expect(mintSpendGrant).not.toHaveBeenCalled()
    expect(runGenerationNodesByPlan).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
  })
})
