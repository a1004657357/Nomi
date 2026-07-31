import { beforeEach, describe, expect, it } from 'vitest'
import {
  describeBlockedNotice,
  forkRegenerationNodesInPlan,
  forkRegenerationPlan,
} from './batchPlanPreview'
import type { DependencyWavePlan } from '../runner/dependencyWaves'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

function plan(over: Partial<DependencyWavePlan>): DependencyWavePlan {
  return { waves: [], blocked: [], edgesUsed: [], ...over }
}

function imageNode(id: string, generated = false): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    position: { x: 0, y: 0 },
    prompt: `${id} prompt`,
    ...(generated
      ? { result: { id: `${id}-result`, type: 'image', url: `https://x/${id}.png`, createdAt: 1 } }
      : {}),
  }
}

beforeEach(() => {
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [],
    edges: [],
    groups: [],
    selectedNodeIds: [],
  })
})

describe('describeBlockedNotice — 批量「缺啥提示啥」', () => {
  it('无 blocked → null（不提示）', () => {
    expect(describeBlockedNotice(plan({ waves: [['a', 'b']] }))).toBeNull()
  })

  it('上游参考未生成被拦 → 提示「在等上游参考」', () => {
    const p = plan({
      waves: [['s1']],
      blocked: [{ nodeId: 's2', reason: 'missing-upstream', detail: '上游「创作工位」还没有生成结果' }],
    })
    const msg = describeBlockedNotice(p)
    expect(msg).toContain('1 个在等上游参考')
    expect(msg).toContain('先把它们生成')
  })

  it('循环引用单独计数', () => {
    const p = plan({
      blocked: [
        { nodeId: 'a', reason: 'cycle', detail: '与其他节点构成循环引用' },
        { nodeId: 'b', reason: 'missing-upstream', detail: 'x' },
      ],
    })
    const msg = describeBlockedNotice(p)!
    expect(msg).toContain('1 个在等上游参考')
    expect(msg).toContain('1 个存在循环引用')
  })
})

describe('regeneration dependency plan', () => {
  it('replaces the generated target with a new version after confirmation planning', () => {
    const nodes = [imageNode('pending-ref'), imageNode('shot-v1', true)]
    const edges = [{
      id: 'edge-pending-shot',
      source: 'pending-ref',
      target: 'shot-v1',
      mode: 'reference' as const,
      order: 0,
    }]
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges, groups: [], selectedNodeIds: [] })
    const originalPlan = buildDependencyWaves(['pending-ref', 'shot-v1'], { nodes, edges })

    const forked = forkRegenerationPlan(originalPlan, 'shot-v1')

    expect(forked).toBeTruthy()
    expect(forked?.plan.waves.flat()).toContain('pending-ref')
    expect(forked?.plan.waves.flat()).toContain(forked?.variantNodeId)
    expect(forked?.plan.waves.flat()).not.toContain('shot-v1')
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.find((node) => node.id === 'shot-v1')?.result?.id).toBe('shot-v1-result')
    expect(state.nodes.find((node) => node.id === forked?.variantNodeId)?.regeneratedFrom).toBe('shot-v1')
    expect(state.edges).toContainEqual(expect.objectContaining({
      source: 'pending-ref',
      target: forked?.variantNodeId,
      mode: 'reference',
    }))
  })

  it('forks every completed node and rewires a regenerated dependency chain', () => {
    const nodes = [imageNode('source-v1', true), imageNode('target-v1', true)]
    const edges = [{
      id: 'edge-source-target',
      source: 'source-v1',
      target: 'target-v1',
      mode: 'reference' as const,
      order: 0,
    }]
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges, groups: [], selectedNodeIds: [] })
    const originalPlan = buildDependencyWaves(['source-v1', 'target-v1'], { nodes, edges })

    const forked = forkRegenerationNodesInPlan(originalPlan, ['source-v1', 'target-v1'])

    expect(forked).toBeTruthy()
    const sourceV2 = forked?.sourceToVariant.get('source-v1')
    const targetV2 = forked?.sourceToVariant.get('target-v1')
    expect(sourceV2).toBeTruthy()
    expect(targetV2).toBeTruthy()
    expect(forked?.plan.waves).toEqual([[sourceV2], [targetV2]])
    expect(forked?.plan.waves.flat()).not.toContain('source-v1')
    expect(forked?.plan.waves.flat()).not.toContain('target-v1')

    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.find((node) => node.id === 'source-v1')?.result?.id).toBe('source-v1-result')
    expect(state.nodes.find((node) => node.id === 'target-v1')?.result?.id).toBe('target-v1-result')
    expect(state.edges).toContainEqual(expect.objectContaining({
      source: sourceV2,
      target: targetV2,
      mode: 'reference',
    }))
    expect(state.edges.some((edge) => edge.source === 'source-v1' && edge.target === targetV2)).toBe(false)
  })
})
