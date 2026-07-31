import { describe, expect, it } from 'vitest'
import { normalizeStoreSnapshot } from './canvasSnapshotNormalizer'

// 重启收敛：磁盘里 status 仍 running/queued 的节点（上次退出时正在生成，已无活轮询循环）→
// 有 taskId 收敛成 recoverable（可重新拉取，重启后也能），无 taskId 收敛成 idle。progress 一律清空。
describe('normalizeStoreSnapshot — 重启收敛卡住的 mid-flight 节点', () => {
  function nodeWith(extra: Record<string, unknown>) {
    return { id: 'n1', kind: 'video', title: '镜头1', position: { x: 0, y: 0 }, ...extra }
  }

  it('running + runs[0].taskId → recoverable，progress 清空，run 记录同步 recoverable', () => {
    const snap = normalizeStoreSnapshot({
      nodes: [nodeWith({
        status: 'running',
        progress: { phase: 'generating', message: '正在生成', updatedAt: 1, taskId: 'up-1' },
        runs: [{ id: 'r1', status: 'running', taskId: 'up-1', startedAt: 1, updatedAt: 2 }],
      })],
    })
    expect(snap.nodes).toHaveLength(1)
    expect(snap.nodes[0].status).toBe('recoverable')
    expect(snap.nodes[0].progress).toBeUndefined()
    expect(snap.nodes[0].runs?.[0].status).toBe('recoverable')
    expect(snap.nodes[0].runs?.[0].taskId).toBe('up-1')
  })

  it('queued 但无 taskId（从没真发出去）→ idle，run 记录收敛 cancelled', () => {
    const snap = normalizeStoreSnapshot({
      nodes: [nodeWith({
        status: 'queued',
        progress: { phase: 'queued', message: '准备生成', updatedAt: 1 },
        runs: [{ id: 'r1', status: 'queued', startedAt: 1, updatedAt: 2 }],
      })],
    })
    expect(snap.nodes[0].status).toBe('idle')
    expect(snap.nodes[0].progress).toBeUndefined()
    expect(snap.nodes[0].runs?.[0].status).toBe('cancelled')
  })

  it('终态节点（success / error）不被动到', () => {
    const snap = normalizeStoreSnapshot({
      nodes: [
        nodeWith({ id: 'ok', status: 'success', result: { id: 'res', type: 'video', url: 'x', createdAt: 1 } }),
        nodeWith({ id: 'bad', status: 'error', error: '失败了' }),
      ],
    })
    expect(snap.nodes.find((n) => n.id === 'ok')?.status).toBe('success')
    expect(snap.nodes.find((n) => n.id === 'bad')?.status).toBe('error')
  })
})

describe('normalizeStoreSnapshot — edge id migration', () => {
  it('rekeys legacy edges by mode and removes duplicate semantics', () => {
    const nodes = [
      { id: 'a', kind: 'image', title: 'A', position: { x: 0, y: 0 } },
      { id: 'b', kind: 'video', title: 'B', position: { x: 100, y: 0 } },
    ]
    const snap = normalizeStoreSnapshot({
      nodes,
      edges: [
        { id: 'edge-a-b', source: 'a', target: 'b', mode: 'reference' },
        { id: 'edge-a-b', source: 'a', target: 'b', mode: 'first_frame' },
        { id: 'legacy-duplicate', source: 'a', target: 'b', mode: 'first_frame' },
      ],
    })

    expect(snap.edges).toHaveLength(2)
    expect(snap.edges.map((edge) => edge.id).sort()).toEqual([
      'edge-a-b-first_frame',
      'edge-a-b-reference',
    ])
  })
})

describe('normalizeStoreSnapshot — creative capability backward compatibility', () => {
  it('keeps legacy results, Scene3D data, and Director snapshots without deleting connected nodes', () => {
    const legacyResult = {
      id: 'legacy-result',
      type: 'image',
      url: 'nomi-local://legacy.png',
      createdAt: 10,
    }
    const snapshot = normalizeStoreSnapshot({
      nodes: [
        {
          id: 'legacy-image',
          kind: 'image',
          title: '旧图片节点',
          position: { x: 0, y: 0 },
          result: legacyResult,
          history: [legacyResult],
          status: 'success',
        },
        {
          id: 'legacy-scene3d',
          kind: 'scene3d',
          title: '旧 3D 导演台',
          position: { x: 360, y: 0 },
          meta: {
            scene3dState: {
              objects: [{ id: 'actor-legacy', type: 'mannequin', position: [0, 0, 0] }],
              cameras: [{ id: 'camera-legacy', position: [4, 2, 5] }],
            },
          },
        },
        {
          id: 'director-v1',
          kind: 'vibingDirector',
          title: '早期 VIBING Director',
          position: { x: 720, y: 0 },
          meta: {
            vibingDirectorState: {
              version: 1,
              brief: '旧版导演简述',
              beats: [{ id: 'beat-1', title: '旧镜头', durationSec: 3 }],
            },
          },
        },
      ],
      edges: [
        { id: 'legacy-edge', source: 'legacy-image', target: 'legacy-scene3d', mode: 'reference' },
        { id: 'director-edge', source: 'legacy-scene3d', target: 'director-v1', mode: 'reference' },
      ],
      selectedNodeIds: ['legacy-image'],
      groups: [],
    })

    expect(snapshot.nodes.map((node) => node.id)).toEqual([
      'legacy-image',
      'legacy-scene3d',
      'director-v1',
    ])
    expect(snapshot.nodes[0]?.result).toEqual(legacyResult)
    expect(snapshot.nodes[0]?.history).toEqual([legacyResult])
    expect(snapshot.nodes[1]?.meta?.scene3dState).toEqual({
      objects: [{ id: 'actor-legacy', type: 'mannequin', position: [0, 0, 0] }],
      cameras: [{ id: 'camera-legacy', position: [4, 2, 5] }],
    })
    expect(snapshot.nodes[2]?.meta?.vibingDirectorState).toEqual({
      version: 1,
      brief: '旧版导演简述',
      beats: [{ id: 'beat-1', title: '旧镜头', durationSec: 3 }],
    })
    expect(snapshot.edges).toHaveLength(2)
  })
})
