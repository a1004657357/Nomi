import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: vi.fn(async () => []) }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))
const taskApiMocks = vi.hoisted(() => ({
  cancelWorkbenchTask: vi.fn(async () => ({ cancelled: true, remoteCancelled: false })),
}))

vi.mock('../../api/taskApi', () => ({
  mintSpendGrant: vi.fn(async () => 'grant-test'),
  cancelWorkbenchTask: taskApiMocks.cancelWorkbenchTask,
}))

import { applyCanvasToolCall as applyCanonicalCanvasMutation } from './applyCanvasToolCall'
import { routeCinematicDirectorToolCall } from './cinematicDirectorToolHandlers'
import { MODEL_FACING_TOOL_SPECS } from '../../../../electron/shared/agentCapabilities/modelFacingToolRegistry'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { createProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'

let session: ReturnType<typeof createProjectSessionTestHarness>
let project: ProjectExecutionContext
afterEach(() => session.dispose())

async function applyCanvasToolCall(toolName: string, args: unknown): Promise<unknown> {
  const reply = await routeCinematicDirectorToolCall(toolName, args, applyCanonicalCanvasMutation, project)
  if (!reply.handled) throw new Error(`Unsupported helper ${toolName}`)
  return reply.value
}

describe('cinematic document and revision helpers behind the canonical approval bridge', () => {
  beforeEach(async () => {
    session = createProjectSessionTestHarness()
    await session.open('project-1')
    project = withProjectAction(project => project)!
    const canvas = useGenerationCanvasStore.getState()
    for (const node of [...canvas.nodes]) canvas.deleteNode(node.id)
    useWorkbenchStore.getState().hydrateStoryboardDesigns({})
    useWorkbenchStore.getState().hydrateFilmBible(null)
    taskApiMocks.cancelWorkbenchTask.mockClear()
  })

  it('does not advertise retired legacy tool names to the new Agent', () => {
    expect(MODEL_FACING_TOOL_SPECS.some(tool => tool.name === 'apply_film_bible_patch')).toBe(false)
    expect(MODEL_FACING_TOOL_SPECS.some(tool => tool.name === 'select_asset_revision')).toBe(false)
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
      projectId: 'project-1',
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
      projectId: 'project-1',
      projectBinding: project.binding,
      vendor: 'codex',
      runId: 'intent-run-1',
      nodeId: 'node-1',
    })
    expect(result).toEqual({ cancelled: true, remoteCancelled: false })
  })

  it('refuses a stale project before document mutation, including A to B to A', async () => {
    await session.open('project-2')
    await session.open('project-1')
    const before = useWorkbenchStore.getState().filmBible
    await expect(applyCanvasToolCall('apply_film_bible_patch', { patch: { theme: 'must not write' } })).rejects.toThrow()
    expect(useWorkbenchStore.getState().filmBible).toBe(before)
  })

  it('rejects a delegated result returned after project switch', async () => {
    let release!: (value: unknown) => void
    const delegate = vi.fn(() => new Promise(resolve => { release = resolve }))
    const pending = routeCinematicDirectorToolCall('create_asset_records', {}, delegate, project)
    expect(delegate).toHaveBeenCalledOnce()
    await session.open('project-2')
    release({ from: 'project-1' })
    await expect(pending).rejects.toThrow()
  })
})
