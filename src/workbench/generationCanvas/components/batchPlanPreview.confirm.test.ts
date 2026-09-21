import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintSpendGrant } from '../../api/taskApi'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { runGenerationNodesByPlan } from '../runner/generationRunController'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { confirmAndRunPlan } from './batchPlanPreview'

vi.mock('../../api/taskApi', () => ({
  mintSpendGrant: vi.fn(async () => 'grant-batch-version'),
}))

vi.mock('../runner/generationRunController', () => ({
  spendCostKindForNodes: vi.fn(() => 'image'),
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

beforeEach(() => {
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [],
    edges: [],
    groups: [],
    selectedNodeIds: [],
  })
  useSpendConfirmStore.setState({ pending: null, lightSuppressed: false })
  vi.clearAllMocks()
})

describe('confirmAndRunPlan version protection', () => {
  it('does not fork before confirmation and leaves the canvas unchanged when cancelled', async () => {
    const sourceNodeId = seedGeneratedNode()
    const state = useGenerationCanvasStore.getState()
    const plan = buildDependencyWaves([sourceNodeId], { nodes: state.nodes, edges: state.edges })

    const pending = confirmAndRunPlan(plan)
    await vi.waitFor(() => expect(useSpendConfirmStore.getState().pending).not.toBeNull())
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)

    useSpendConfirmStore.getState().resolvePending(false)
    await pending

    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
    expect(mintSpendGrant).not.toHaveBeenCalled()
    expect(runGenerationNodesByPlan).not.toHaveBeenCalled()
  })

  it('forks after approval, applies settings to V2, and grants only the V2 node', async () => {
    const sourceNodeId = seedGeneratedNode()
    const state = useGenerationCanvasStore.getState()
    const plan = buildDependencyWaves([sourceNodeId], { nodes: state.nodes, edges: state.edges })

    const pending = confirmAndRunPlan(plan, {
      onForked: (sourceToVariant) => {
        const variantNodeId = sourceToVariant.get(sourceNodeId)
        if (!variantNodeId) throw new Error('missing variant')
        useGenerationCanvasStore.getState().updateNode(variantNodeId, {
          meta: { modelKey: 'new-model' },
        })
      },
    })
    await vi.waitFor(() => expect(useSpendConfirmStore.getState().pending).not.toBeNull())
    useSpendConfirmStore.getState().resolvePending(true)
    await pending

    const next = useGenerationCanvasStore.getState()
    const source = next.nodes.find((node) => node.id === sourceNodeId)
    const variant = next.nodes.find((node) => node.regeneratedFrom === sourceNodeId)
    expect(source?.result?.id).toBe('result-v1')
    expect(source?.meta?.modelKey).toBe('old-model')
    expect(variant?.result).toBeUndefined()
    expect(variant?.meta?.modelKey).toBe('new-model')
    expect(mintSpendGrant).toHaveBeenCalledWith([variant?.id], 1, expect.any(Number))
    expect(runGenerationNodesByPlan).toHaveBeenCalledWith(
      expect.objectContaining({ waves: [[variant?.id]] }),
      { grantId: 'grant-batch-version', assetUploadConsent: 'not-needed' },
    )
  })
})
