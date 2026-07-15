import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { buildDependencyWaves } from './dependencyWaves'
import {
  cancelAllGenerationRuns,
  cancelGenerationNode,
  rerunGenerationNodeAsNewNode,
  runGenerationNode,
  runGenerationNodesByPlan,
} from './generationRunController'

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
    const executor = vi.fn(
      async (_node, context) =>
        new Promise<GenerationNodeResult>((_resolve, reject) => {
          started()
          context?.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), {
            once: true,
          })
        }),
    )

    const running = runGenerationNode('image-1', { executor, retry: { maxAttempts: 1 } })
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
    const executor = vi.fn(
      async (_node, context) =>
        new Promise<GenerationNodeResult>((_resolve, reject) => {
          started()
          context?.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), {
            once: true,
          })
        }),
    )

    const running = runGenerationNodesByPlan(plan, { executor, concurrency: 1, retry: { maxAttempts: 1 } })
    await didStart
    expect(cancelAllGenerationRuns()).toBe(1)
    const outcome = await running

    expect(executor).toHaveBeenCalledTimes(1)
    expect(outcome.failures.map((entry) => entry.nodeId)).toEqual(['image-1', 'image-2', 'image-3'])
    expect(useGenerationCanvasStore.getState().nodes.every((entry) => entry.status === 'idle')).toBe(true)
  })
})

describe('dependency ready scheduling', () => {
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

    const running = runGenerationNodesByPlan(plan, { executor, concurrency: 3, retry: { maxAttempts: 1 } })
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
    const executor = vi.fn(async (current: GenerationCanvasNode) => result(`new-${current.id}`))

    const generated = await rerunGenerationNodeAsNewNode('image-1', {
      executor,
      retry: { maxAttempts: 1 },
    })

    const state = useGenerationCanvasStore.getState()
    const original = state.nodes.find((candidate) => candidate.id === 'image-1')
    const variant = state.nodes.find((candidate) => candidate.regeneratedFrom === 'image-1')
    expect(state.nodes).toHaveLength(2)
    expect(original?.result).toEqual(originalResult)
    expect(original?.history).toEqual([originalResult])
    expect(variant?.result).toEqual(generated)
    expect(variant?.history).toEqual([generated])
  })
})
