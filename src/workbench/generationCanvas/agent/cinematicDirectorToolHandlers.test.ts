import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: vi.fn(async () => []) }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))
const taskApiMocks = vi.hoisted(() => ({
  cancelWorkbenchTask: vi.fn(async () => ({ cancelled: true, remoteCancelled: false })),
}))

vi.mock('../../api/taskApi', () => ({
  mintSpendGrant: vi.fn(async () => 'grant-test'),
  cancelWorkbenchTask: taskApiMocks.cancelWorkbenchTask,
}))

import { applyCanvasToolCall } from './applyCanvasToolCall'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'

describe('cinematic director runtime tools', () => {
  beforeEach(() => {
    const canvas = useGenerationCanvasStore.getState()
    for (const node of [...canvas.nodes]) canvas.deleteNode(node.id)
    useWorkbenchStore.getState().hydrateStoryboardPlan(null, false)
    useWorkbenchStore.getState().hydrateFilmBible(null)
    taskApiMocks.cancelWorkbenchTask.mockClear()
  })

  it('propose_film_bible_patch returns a proposal without mutating project state', async () => {
    const beforeRevision = useWorkbenchStore.getState().persistRevision
    const result = await applyCanvasToolCall('propose_film_bible_patch', {
      summary: '统一画幅',
      patch: { aspectRatio: '9:16' },
    })

    expect(result).toEqual({ proposal: true, summary: '统一画幅', patch: { aspectRatio: '9:16' } })
    expect(useWorkbenchStore.getState().filmBible).toBeNull()
    expect(useWorkbenchStore.getState().persistRevision).toBe(beforeRevision)
  })

  it('apply_film_bible_patch validates, strips credentials, and persists the canonical object', async () => {
    await applyCanvasToolCall('apply_film_bible_patch', {
      patch: { theme: '选择与代价', aspectRatio: '9:16', apiKey: 'must-not-persist' },
    })

    expect(useWorkbenchStore.getState().filmBible).toEqual({
      version: 1,
      projectId: 'local',
      theme: '选择与代价',
      aspectRatio: '9:16',
    })
  })

  it('select/archive revision changes only the current pointer and keeps history', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: '角色定妆' })
    const first = { id: 'rev-1', type: 'image' as const, createdAt: 1, revisionStatus: 'selected' as const }
    const second = { id: 'rev-2', type: 'image' as const, createdAt: 2, revisionStatus: 'candidate' as const }
    useGenerationCanvasStore.getState().updateNode(node.id, { result: first, history: [first, second] })

    await applyCanvasToolCall('select_asset_revision', { nodeId: node.id, revisionId: 'rev-2' })
    let current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)!
    expect(current.result?.id).toBe('rev-2')
    expect(current.history).toHaveLength(2)
    expect(current.history?.find((revision) => revision.id === 'rev-1')?.revisionStatus).toBe('candidate')

    await applyCanvasToolCall('archive_asset_revision', { nodeId: node.id, revisionId: 'rev-2' })
    current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)!
    expect(current.history).toHaveLength(2)
    expect(current.history?.find((revision) => revision.id === 'rev-2')?.revisionStatus).toBe('archived')
    expect(current.result?.id).toBe('rev-1')
  })

  it('create_asset_records delegates to the existing canvas mutation path', async () => {
    const result = await applyCanvasToolCall('create_asset_records', {
      summary: '建立角色资产',
      nodes: [{ clientId: 'hero', kind: 'character', title: '林夏', prompt: '角色身份参考' }],
    }) as { clientIdToNodeId: Record<string, string> }

    const created = useGenerationCanvasStore.getState().nodes.find((node) => node.id === result.clientIdToNodeId.hero)
    expect(created).toMatchObject({ kind: 'character', title: '林夏', categoryId: 'cast' })
  })

  it('cancel_provider_task delegates to the query-safe desktop cancellation runtime', async () => {
    const result = await applyCanvasToolCall('cancel_provider_task', {
      vendor: 'codex',
      runId: 'intent-run-1',
      nodeId: 'node-1',
    })

    expect(taskApiMocks.cancelWorkbenchTask).toHaveBeenCalledWith({
      vendor: 'codex',
      runId: 'intent-run-1',
      nodeId: 'node-1',
    })
    expect(result).toEqual({ cancelled: true, remoteCancelled: false })
  })
})
