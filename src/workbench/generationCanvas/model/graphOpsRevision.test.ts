/**
 * Slice 3 测试：AssetRevision 操作（§17 单一 selected 指针 + 不覆盖原则）。
 *
 * 验收（Gate 1 Slice 3）：
 * - select 不删旧 revision，旧 selected 降级为 candidate（§17.1 不覆盖）。
 * - archive 不物理删；归档当前选中时 result 回落到最近 candidate。
 * - reject 不删，只标 rejected。
 * - 迁移期：revisionStatus 缺省按 candidate（既有条目无此字段）。
 * - 生成→生成→生成 后 history 有 3 条，selected 指针可切换。
 */
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from './generationCanvasTypes'
import { archiveRevision, rejectRevision, rollbackNodeHistory, selectRevision } from './graphOps'

function makeResult(id: string, overrides: Partial<GenerationNodeResult> = {}): GenerationNodeResult {
  return {
    id,
    type: 'video',
    url: `nomi-local://${id}.mp4`,
    createdAt: 1_000_000,
    ...overrides,
  }
}

function makeNode(overrides: Partial<GenerationCanvasNode> & { id: string }): GenerationCanvasNode {
  return {
    kind: 'video',
    title: 'shot',
    position: { x: 0, y: 0 },
    ...overrides,
  }
}

function nodeWithHistory(nodeId: string, history: GenerationNodeResult[], selectedId?: string): GenerationCanvasNode {
  const selected = history.find((h) => h.id === selectedId) ?? history[0]
  return makeNode({ id: nodeId, history, result: selected, status: 'success' })
}

describe('selectRevision — §17.1 不覆盖：旧 selected 降级为 candidate', () => {
  it('marks target selected, demotes previous selected to candidate, keeps history length', () => {
    const r1 = makeResult('r1', { revisionStatus: 'selected' })
    const r2 = makeResult('r2', { revisionStatus: 'candidate' })
    const r3 = makeResult('r3', { revisionStatus: 'candidate' })
    const nodes = [nodeWithHistory('n1', [r1, r2, r3], 'r1')]

    const next = selectRevision(nodes, 'n1', 'r2')
    const node = next[0]
    expect(node.history).toHaveLength(3) // 不删
    expect(node.history?.find((h) => h.id === 'r1')?.revisionStatus).toBe('candidate') // 旧 selected 降级
    expect(node.history?.find((h) => h.id === 'r2')?.revisionStatus).toBe('selected') // 目标升 selected
    expect(node.result?.id).toBe('r2') // result 指针切换
    expect(node.status).toBe('success')
  })

  it('selecting non-existent revision is a no-op', () => {
    const r1 = makeResult('r1', { revisionStatus: 'selected' })
    const nodes = [nodeWithHistory('n1', [r1], 'r1')]
    const next = selectRevision(nodes, 'n1', 'ghost')
    expect(next[0].result?.id).toBe('r1') // 不变
  })

  it('migration-era: revisionStatus undefined treated as candidate (old entries)', () => {
    const r1 = makeResult('r1') // 无 revisionStatus → 视为 candidate
    const r2 = makeResult('r2') // 无 revisionStatus → 视为 candidate
    const nodes = [nodeWithHistory('n1', [r1, r2], 'r1')]
    const next = selectRevision(nodes, 'n1', 'r2')
    // r1 即使无 revisionStatus 字段，selectRevision 也不会误判它为 selected（缺省=candidate）
    expect(next[0].result?.id).toBe('r2')
    expect(next[0].history).toHaveLength(2)
  })
})

describe('archiveRevision — §17.3 默认归档不物理删', () => {
  it('marks target archived, keeps history length', () => {
    const r1 = makeResult('r1', { revisionStatus: 'selected' })
    const r2 = makeResult('r2', { revisionStatus: 'candidate' })
    const nodes = [nodeWithHistory('n1', [r1, r2], 'r1')]

    const next = archiveRevision(nodes, 'n1', 'r2')
    expect(next[0].history).toHaveLength(2) // 不删
    expect(next[0].history?.find((h) => h.id === 'r2')?.revisionStatus).toBe('archived')
    expect(next[0].result?.id).toBe('r1') // 当前选中未动
  })

  it('archiving the currently-selected revision falls back to latest candidate', () => {
    const r1 = makeResult('r1', { revisionStatus: 'candidate' })
    const r2 = makeResult('r2', { revisionStatus: 'selected' })
    const nodes = [nodeWithHistory('n1', [r1, r2], 'r2')]

    const next = archiveRevision(nodes, 'n1', 'r2')
    expect(next[0].result?.id).toBe('r1') // 回落到 r1
    expect(next[0].status).toBe('success')
  })

  it('archiving the only revision leaves node idle with no result', () => {
    const r1 = makeResult('r1', { revisionStatus: 'selected' })
    const nodes = [nodeWithHistory('n1', [r1], 'r1')]
    const next = archiveRevision(nodes, 'n1', 'r1')
    expect(next[0].result).toBeUndefined()
    expect(next[0].status).toBe('idle')
    expect(next[0].history).toHaveLength(1) // 仍不删
  })
})

describe('rejectRevision — §17 rejected 不删', () => {
  it('marks target rejected, keeps history length, does not touch result', () => {
    const r1 = makeResult('r1', { revisionStatus: 'selected' })
    const r2 = makeResult('r2', { revisionStatus: 'candidate' })
    const nodes = [nodeWithHistory('n1', [r1, r2], 'r1')]

    const next = rejectRevision(nodes, 'n1', 'r2')
    expect(next[0].history).toHaveLength(2)
    expect(next[0].history?.find((h) => h.id === 'r2')?.revisionStatus).toBe('rejected')
    expect(next[0].result?.id).toBe('r1') // result 不动
  })
})

describe('rollbackNodeHistory — 既有行为不回归', () => {
  it('still restores result + success status (unchanged by Slice 3)', () => {
    const r1 = makeResult('r1')
    const r2 = makeResult('r2')
    const nodes = [nodeWithHistory('n1', [r1, r2], 'r1')]
    const next = rollbackNodeHistory(nodes, 'n1', 'r2')
    expect(next[0].result?.id).toBe('r2')
    expect(next[0].status).toBe('success')
  })
})

describe('revision lifecycle: 生成→生成→生成 后 selected 可切换（§17.1）', () => {
  it('three generations → 3 history entries → switch selected without data loss', () => {
    const r1 = makeResult('r1', { revisionStatus: 'selected' })
    const r2 = makeResult('r2', { revisionStatus: 'candidate' })
    const r3 = makeResult('r3', { revisionStatus: 'candidate' })
    let nodes = [nodeWithHistory('n1', [r1, r2, r3], 'r1')]

    // 切到 r3
    nodes = selectRevision(nodes, 'n1', 'r3')
    expect(nodes[0].result?.id).toBe('r3')
    expect(nodes[0].history?.find((h) => h.id === 'r1')?.revisionStatus).toBe('candidate')

    // 切回 r1（回滚能力，§17.2）
    nodes = selectRevision(nodes, 'n1', 'r1')
    expect(nodes[0].result?.id).toBe('r1')

    // 全程 history 不丢
    expect(nodes[0].history).toHaveLength(3)
    const ids = nodes[0].history?.map((h) => h.id)
    expect(ids).toEqual(['r1', 'r2', 'r3'])
  })
})
