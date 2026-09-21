import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { buildDependencyWaves } from './dependencyWaves'
import { generationNodeExecutor, type GenerationNodeExecutor } from './generationNodeExecutor'
import { mintSpendGrant } from '../../api/taskApi'
import {
  cancelAllGenerationRuns,
  cancelGenerationNode,
  confirmAndRunNode,
  runGenerationNode,
  runGenerationNodesBatch,
  runGenerationNodesByPlan,
} from './generationRunController'

vi.mock('./generationNodeExecutor', () => ({ generationNodeExecutor: vi.fn() }))
vi.mock('../../api/taskApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/taskApi')>(),
  mintSpendGrant: vi.fn(async () => 'variant-grant'),
  cancelWorkbenchTask: vi.fn(async () => ({ cancelled: true, remoteCancelled: false })),
}))
vi.mock('../spend/spendConfirm', async (importOriginal) => ({
  ...await importOriginal<typeof import('../spend/spendConfirm')>(),
  confirmGenerationSpend: vi.fn(async () => true),
}))

function node(id: string): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    position: { x: 0, y: 0 },
    prompt: `${id} prompt`,
    meta: { vendor: 'test-provider', modelKey: 'test-image' },
  }
}

function result(id: string): GenerationNodeResult {
  return { id: `result-${id}`, type: 'image', url: `https://x/${id}.png`, createdAt: Date.now() }
}

function edge(source: string, target: string): GenerationCanvasEdge {
  return { id: `${source}->${target}`, source, target, mode: 'reference' }
}

beforeEach(() => {
  vi.clearAllMocks()
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [],
    edges: [],
    groups: [],
    selectedNodeIds: [],
  })
})

describe('generation cancellation', () => {
  it('aborts an active node and records a cancelled run instead of an error', async () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [node('image-1')],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    })
    let started!: () => void
    const didStart = new Promise<void>((resolve) => {
      started = resolve
    })
    const executor = vi.fn<GenerationNodeExecutor>(
      async (_node, context) =>
        new Promise<GenerationNodeResult>((_resolve, reject) => {
          started()
          context?.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), {
            once: true,
          })
        }),
    )

    const running = runGenerationNode('image-1', { executor, retry: { maxAttempts: 1 }, assetUploadConsent: 'not-needed' })
    await didStart
    expect(cancelGenerationNode('image-1')).toBe(true)
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })

    const updated = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'image-1')
    expect(updated?.status).toBe('idle')
    expect(updated?.error).toBeUndefined()
    expect(updated?.runs?.[0]?.status).toBe('cancelled')
  })

  it('stops the active batch without starting nodes that are still waiting', async () => {
    const nodes = [node('image-1'), node('image-2'), node('image-3')]
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges: [], groups: [], selectedNodeIds: [] })
    const plan = buildDependencyWaves(
      nodes.map((entry) => entry.id),
      { nodes, edges: [] },
    )
    let started!: () => void
    const didStart = new Promise<void>((resolve) => {
      started = resolve
    })
    const executor = vi.fn<GenerationNodeExecutor>(
      async (_node, context) =>
        new Promise<GenerationNodeResult>((_resolve, reject) => {
          started()
          context?.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), {
            once: true,
          })
        }),
    )

    const running = runGenerationNodesByPlan(plan, { executor, concurrency: 1, retry: { maxAttempts: 1 }, assetUploadConsent: 'not-needed' })
    await didStart
    expect(cancelAllGenerationRuns()).toBe(1)
    const outcome = await running

    expect(executor).toHaveBeenCalledTimes(1)
    expect(outcome.failures.map((entry) => entry.nodeId)).toEqual(['image-1', 'image-2', 'image-3'])
    expect(useGenerationCanvasStore.getState().nodes.every((entry) => entry.status === 'idle')).toBe(true)
  })
})

describe('dependency ready scheduling', () => {
  it('does not automatically resubmit a Codex Img2 local timeout', async () => {
    const codexNode = {
      ...node('codex-timeout'),
      meta: { vendor: 'codex', modelKey: 'codex-img2' },
    }
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [codexNode],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    })
    const executor = vi.fn(async () => {
      throw new Error('Codex Img2 长时间无进展（300 秒没有输出）')
    })

    await expect(runGenerationNode(codexNode.id, { executor, assetUploadConsent: 'not-needed' })).rejects.toThrow(/长时间无进展/)

    expect(executor).toHaveBeenCalledTimes(1)
    expect(useGenerationCanvasStore.getState().nodes[0]?.runs).toHaveLength(1)
  })

  it('keeps excess Codex Img2 nodes queued without assigning an error', async () => {
    const nodes = ['codex-1', 'codex-2', 'codex-3'].map((id) => ({
      ...node(id),
      meta: { vendor: 'codex', modelKey: 'codex-img2' },
    }))
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges: [], groups: [], selectedNodeIds: [] })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started = 0
    const executor = vi.fn(async (current: GenerationCanvasNode) => {
      started += 1
      if (started <= 1) await gate
      return result(current.id)
    })

    const running = runGenerationNodesBatch(
      nodes.map((entry) => entry.id),
      {
        executor,
        concurrency: 3,
        retry: { maxAttempts: 1 },
        assetUploadConsent: 'not-needed',
      },
    )
    try {
      await vi.waitFor(() => {
        const queued = useGenerationCanvasStore.getState().nodes.find((entry) => entry.id === 'codex-3')
        expect(executor).toHaveBeenCalledTimes(1)
        expect(queued?.status).toBe('queued')
        expect(queued?.progress?.phase).toBe('queued')
        expect(queued?.progress?.message).toContain('等待 codex 空闲名额')
        expect(queued?.error).toBeUndefined()
      })
    } finally {
      release()
      await running
    }
  })

  it('starts a dependent as soon as its own prerequisite succeeds', async () => {
    const nodes = [node('fast-anchor'), node('slow-independent'), node('dependent')]
    const edges = [edge('fast-anchor', 'dependent')]
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges, groups: [], selectedNodeIds: [] })
    const plan = buildDependencyWaves(
      nodes.map((entry) => entry.id),
      { nodes, edges },
    )
    const slowGate = (() => {
      let resolve!: () => void
      const promise = new Promise<void>((done) => {
        resolve = done
      })
      return { promise, resolve }
    })()
    const started: string[] = []
    const executor = vi.fn(async (current: GenerationCanvasNode) => {
      started.push(current.id)
      if (current.id === 'slow-independent') await slowGate.promise
      return result(current.id)
    })

    const running = runGenerationNodesByPlan(plan, { executor, concurrency: 3, retry: { maxAttempts: 1 }, assetUploadConsent: 'not-needed' })
    try {
      await vi.waitFor(() => expect(started).toContain('dependent'), { timeout: 250 })
      expect(started).toContain('slow-independent')
    } finally {
      slowGate.resolve()
      await running
    }
  })
})

describe('non-destructive regeneration', () => {
  it('generates into a new version node without replacing the prior result', async () => {
    const originalResult = result('original')
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{ ...node('image-1'), result: originalResult, history: [originalResult], status: 'success' }],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    })
    vi.mocked(generationNodeExecutor).mockImplementation(async (current) => result(`new-${current.id}`))
    await confirmAndRunNode('image-1', { rerun: true })

    const state = useGenerationCanvasStore.getState()
    const original = state.nodes.find((candidate) => candidate.id === 'image-1')
    const variant = state.nodes.find((candidate) => candidate.regeneratedFrom === 'image-1')
    expect(state.nodes).toHaveLength(2)
    expect(original?.result).toEqual(originalResult)
    expect(original?.history).toEqual([originalResult])
    expect(variant?.result?.id).toBe(`result-new-${variant?.id}`)
    expect(variant?.history).toEqual([variant?.result])
    expect(mintSpendGrant).toHaveBeenCalledWith([variant?.id])
    expect(generationNodeExecutor).toHaveBeenCalledTimes(1)
  })
})
