import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
} from './generationRunController'
import { runGenerationNodesByPlan } from './generationRunWaves'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { LocalTaskCancelledError } from './localTaskControl'
import { useGenerationQueueStore } from './generationQueueStore'
import { narrateProgress } from '../../observability/narrate'
import { withProjectAction } from '../../project/projectCanvasReadSurface'

let projectSession: ProjectSessionTestHarness
let target: Awaited<ReturnType<ProjectSessionTestHarness['open']>>

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
    status: 'idle',
    meta: { vendor: 'test-provider', modelKey: 'test-image' },
  }
}

function result(id: string): GenerationNodeResult {
  return { id: `result-${id}`, type: 'image', url: `https://x/${id}.png`, createdAt: Date.now() }
}

function edge(source: string, target: string): GenerationCanvasEdge {
  return { id: `${source}->${target}`, source, target, mode: 'reference' }
}

beforeEach(async () => {
  vi.clearAllMocks()
  projectSession = createProjectSessionTestHarness()
  target = await projectSession.open('project-test')
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [],
    edges: [],
    groups: [],
    selectedNodeIds: [],
  })
})

afterEach(() => { projectSession.dispose() })

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

    const running = runGenerationNode('image-1', { target, executor, retry: { maxAttempts: 1 }, assetUploadConsent: 'not-needed' })
    await didStart
    expect(withProjectAction((project) => cancelGenerationNode('image-1', project))).toBe(true)
    await expect(running).rejects.toBeInstanceOf(LocalTaskCancelledError)
    expect(executor.mock.calls[0]?.[1].projectTarget).toEqual(target)

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

    const running = runGenerationNodesByPlan(plan, { target, executor, concurrency: 1, retry: { maxAttempts: 1 }, assetUploadConsent: 'not-needed' })
    await didStart
    expect(cancelAllGenerationRuns()).toBe(1)
    const outcome = await running

    expect(executor).toHaveBeenCalledTimes(1)
    expect(outcome.totalCount).toBe(3)
    expect(outcome.successes).toEqual([])
    expect(outcome.failures.map((entry) => entry.nodeId)).toEqual(['image-1'])
    for (const queuedId of ['image-2', 'image-3']) {
      expect(useGenerationCanvasStore.getState().nodes.find((entry) => entry.id === queuedId)?.runs).toBeUndefined()
    }
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

    await expect(runGenerationNode(codexNode.id, { target, executor, assetUploadConsent: 'not-needed' })).rejects.toThrow(/长时间无进展/)

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
        target,
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
        expect(queued?.runs?.[0]?.status).toBe('queued')
        expect(queued?.progress?.phase).toBe('queued')
        expect(queued?.progress?.message).toBe(narrateProgress('queued'))
        expect(queued?.error).toBeUndefined()
      })
    } finally {
      release()
      await running
    }
    expect(executor).toHaveBeenCalledTimes(3)
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

    const running = runGenerationNodesByPlan(plan, { target, executor, concurrency: 3, retry: { maxAttempts: 1 }, assetUploadConsent: 'not-needed' })
    try {
      await vi.waitFor(() => expect(started).toContain('dependent'), { timeout: 250 })
      expect(started).toContain('slow-independent')
    } finally {
      slowGate.resolve()
      await running
    }
  })

  it('bounds ready work, waits for every prerequisite, and preserves target and authorization', async () => {
    const nodes = ['a', 'b', 'c', 'joined'].map(node)
    const edges = [edge('a', 'joined'), edge('b', 'joined')]
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges, groups: [], selectedNodeIds: [] })
    const release = new Map<string, () => void>()
    const executor = vi.fn<GenerationNodeExecutor>(async (current, context) => {
      expect(context.projectTarget).toEqual(target)
      expect(context.grantId).toBe('approved-grant')
      await new Promise<void>((resolve) => release.set(current.id, resolve))
      return result(current.id)
    })
    const assertAuthorCurrent = vi.fn(async () => undefined)
    const assertApprovedInputs = vi.fn()
    const running = runGenerationNodesByPlan(buildDependencyWaves(nodes.map((n) => n.id), { nodes, edges }), {
      target, executor, concurrency: 2, grantId: 'approved-grant', assertAuthorCurrent, assertApprovedInputs,
      retry: { maxAttempts: 1 }, assetUploadConsent: 'not-needed',
    })
    try {
      await vi.waitFor(() => expect(release.size).toBe(2))
      expect([...release.keys()]).toEqual(['a', 'b'])
      release.get('a')!()
      await vi.waitFor(() => expect(release.has('c')).toBe(true))
      expect(release.has('joined')).toBe(false)
      release.get('b')!()
      await vi.waitFor(() => expect(release.has('joined')).toBe(true))
      release.get('c')!()
      release.get('joined')!()
      expect((await running).successes).toHaveLength(4)
      expect(assertAuthorCurrent).toHaveBeenCalledTimes(4)
      expect(assertApprovedInputs).toHaveBeenCalledTimes(4)
    } finally {
      for (const done of release.values()) done()
      cancelAllGenerationRuns()
      await running
    }
  })

  it('does not run descendants of a failed prerequisite or retry the paid executor', async () => {
    const nodes = ['failed', 'independent', 'child', 'grandchild'].map(node)
    const edges = [edge('failed', 'child'), edge('child', 'grandchild')]
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges, groups: [], selectedNodeIds: [] })
    const executor = vi.fn<GenerationNodeExecutor>(async (current) => {
      if (current.id === 'failed') throw new Error('provider rejected input')
      return result(current.id)
    })
    const outcome = await runGenerationNodesByPlan(buildDependencyWaves(nodes.map((n) => n.id), { nodes, edges }), {
      target, executor, concurrency: 2, retry: { maxAttempts: 1 }, assetUploadConsent: 'not-needed',
    })
    expect(executor.mock.calls.map(([n]) => n.id)).toEqual(['failed', 'independent'])
    expect(outcome.successes.map((n) => n.nodeId)).toEqual(['independent'])
    expect(outcome.failures.map((n) => n.nodeId)).toEqual(['failed', 'child', 'grandchild'])
  })

  it('refuses a stale author before a ready node reaches the executor', async () => {
    const nodes = [node('protected')]
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges: [], groups: [], selectedNodeIds: [] })
    const executor = vi.fn<GenerationNodeExecutor>()
    const outcome = await runGenerationNodesByPlan(buildDependencyWaves(['protected'], { nodes, edges: [] }), {
      target, executor, assertAuthorCurrent: async () => { throw new Error('author no longer current') },
      retry: { maxAttempts: 1 }, assetUploadConsent: 'not-needed',
    })
    expect(executor).not.toHaveBeenCalled()
    expect(outcome.failures[0]?.error.message).toBe('author no longer current')
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
    await confirmAndRunNode('image-1', { rerun: true, initiator: 'user' })

    const state = useGenerationCanvasStore.getState()
    const original = state.nodes.find((candidate) => candidate.id === 'image-1')
    const variant = state.nodes.find((candidate) => candidate.regeneratedFrom === 'image-1')
    expect(state.nodes).toHaveLength(2)
    expect(variant).toBeDefined()
    expect(variant?.derivedFrom).toBeUndefined()
    expect(original?.result).toEqual(originalResult)
    expect(original?.history).toEqual([originalResult])
    expect(variant?.result?.id).toBe(`result-new-${variant?.id}`)
    expect(variant?.history).toEqual([variant?.result])
    expect(mintSpendGrant).toHaveBeenCalledExactlyOnceWith([variant?.id], undefined, undefined)
    expect(generationNodeExecutor).toHaveBeenCalledTimes(1)
  })
})
