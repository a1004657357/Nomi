import { selectActiveStoryboardDesign } from '../../workbenchDocumentSlice'
import { filmBibleSchema } from '../../domain/cinematicSchema'
import { cancelWorkbenchTask } from '../../api/taskApi'
import {
  readFilmBibleView,
  readProjectSummary,
  readShotSpec,
  readStoryboardAsShotSpecs,
} from '../../domain/shotSpecReaders'
import type { ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { useWorkbenchStore } from '../../workbenchStore'
import { archiveRevision, selectRevision } from '../model/graphOps'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

type DelegateCall = { toolName: string; args: unknown }
type HandledResult = { handled: false } | { handled: true; value: unknown }
type DelegateExecutor = (toolName: string, args: unknown) => Promise<unknown>

const DELEGATES: Readonly<Record<string, string>> = {
  read_provider_capabilities: 'list_capability_recipes',
  apply_storyboard_patch: 'batch_update_storyboard_shots',
  create_asset_records: 'create_canvas_nodes',
  place_assets_on_timeline: 'arrange_storyboard_to_timeline',
  submit_generation_intent: 'run_generation_batch',
}

export function resolveCinematicDirectorDelegate(toolName: string, args: unknown): DelegateCall | null {
  const delegated = DELEGATES[toolName]
  return delegated ? { toolName: delegated, args } : null
}

export async function routeCinematicDirectorToolCall(
  toolName: string,
  args: unknown,
  executeDelegate: DelegateExecutor,
  project: ProjectExecutionContext,
): Promise<HandledResult> {
  project.assertCurrent()
  const delegate = resolveCinematicDirectorDelegate(toolName, args)
  if (delegate) {
    const value = await executeDelegate(delegate.toolName, delegate.args)
    project.assertCurrent()
    return { handled: true, value }
  }
  return tryApplyCinematicDirectorToolCall(toolName, args, project)
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function revisionSummary(node: GenerationCanvasNode): Record<string, unknown> {
  const history = node.history ?? []
  return {
    nodeId: node.id,
    kind: node.kind,
    categoryId: node.categoryId || 'shots',
    title: node.title,
    selectedRevisionId: node.result?.id,
    revisions: history.map((revision) => ({
      id: revision.id,
      type: revision.type,
      status: revision.revisionStatus ?? (revision.id === node.result?.id ? 'selected' : 'candidate'),
      createdAt: revision.createdAt,
      model: revision.model,
      providerTaskId: revision.taskId,
    })),
  }
}

function updateRevisionNode(nodeId: string, revisionId: string, operation: 'select' | 'archive'): unknown {
  const store = useGenerationCanvasStore.getState()
  const before = store.nodes.find((node) => node.id === nodeId)
  if (!before) throw new Error(`asset_not_found:${nodeId}`)
  if (!(before.history ?? []).some((revision) => revision.id === revisionId)) {
    throw new Error(`revision_not_found:${revisionId}`)
  }
  const nextNodes = operation === 'select'
    ? selectRevision(store.nodes, nodeId, revisionId)
    : archiveRevision(store.nodes, nodeId, revisionId)
  const after = nextNodes.find((node) => node.id === nodeId)
  if (!after) throw new Error(`asset_not_found:${nodeId}`)
  store.updateNode(nodeId, {
    result: after.result,
    history: after.history,
    status: after.status,
    error: after.error,
  })
  return {
    nodeId,
    revisionId,
    operation,
    selectedRevisionId: after.result?.id,
  }
}

export function tryApplyCinematicDirectorToolCall(toolName: string, args: unknown, project: ProjectExecutionContext): HandledResult {
  project.assertCurrent()
  const record = recordValue(args)
  const workbench = useWorkbenchStore.getState()
  const canvas = useGenerationCanvasStore.getState()
  const projectId = project.binding.projectId

  if (toolName === 'read_project_summary') {
    return {
      handled: true,
      value: {
        projectId,
        ...readProjectSummary((selectActiveStoryboardDesign(workbench)?.plan ?? null), canvas.nodes),
        hasPersistedFilmBible: Boolean(workbench.filmBible),
      },
    }
  }
  if (toolName === 'read_film_bible') {
    return {
      handled: true,
      value: workbench.filmBible ?? readFilmBibleView((selectActiveStoryboardDesign(workbench)?.plan ?? null), projectId, {
        aspectRatio: workbench.previewAspectRatio,
        fps: workbench.timeline.fps,
      }),
    }
  }
  if (toolName === 'read_storyboard') {
    return {
      handled: true,
      value: readStoryboardAsShotSpecs((selectActiveStoryboardDesign(workbench)?.plan ?? null), canvas.nodes, projectId),
    }
  }
  if (toolName === 'read_shot_spec') {
    const shotId = typeof record.shotId === 'number' || typeof record.shotId === 'string'
      ? record.shotId
      : ''
    const shot = readShotSpec(shotId, (selectActiveStoryboardDesign(workbench)?.plan ?? null), canvas.nodes, projectId)
    if (!shot) throw new Error(`shot_not_found:${String(shotId)}`)
    return { handled: true, value: shot }
  }
  if (toolName === 'read_asset_registry') {
    const kind = typeof record.kind === 'string' ? record.kind : ''
    const assets = canvas.nodes.filter((node) => {
      const isAsset = (node.categoryId || 'shots') !== 'shots' || Boolean(node.creativeResource)
      return isAsset && (!kind || node.kind === kind || node.categoryId === kind)
    })
    return { handled: true, value: assets.map(revisionSummary) }
  }
  if (toolName === 'read_task_status') {
    const requested = Array.isArray(record.nodeIds)
      ? new Set(record.nodeIds.filter((id): id is string => typeof id === 'string'))
      : null
    return {
      handled: true,
      value: canvas.nodes
        .filter((node) => !requested || requested.has(node.id))
        .filter((node) => node.status !== 'idle' || Boolean(node.runs?.length))
        .map((node) => ({
          nodeId: node.id,
          title: node.title,
          status: node.status ?? 'idle',
          progress: node.progress,
          runs: node.runs ?? [],
        })),
    }
  }
  if (toolName === 'propose_film_bible_patch' || toolName === 'propose_shot_patch'
    || toolName === 'propose_generation_plan' || toolName === 'propose_timeline_assembly') {
    return { handled: true, value: { proposal: true, ...record } }
  }
  if (toolName === 'apply_film_bible_patch') {
    const patch = recordValue(record.patch)
    const current = workbench.filmBible ?? readFilmBibleView((selectActiveStoryboardDesign(workbench)?.plan ?? null), projectId) ?? {
      version: 1 as const,
      projectId,
    }
    const next = filmBibleSchema.parse({ ...current, ...patch, version: 1, projectId })
    workbench.setFilmBible(next)
    return { handled: true, value: { applied: true, filmBible: next } }
  }
  if (toolName === 'select_asset_revision' || toolName === 'archive_asset_revision') {
    const nodeId = typeof record.nodeId === 'string' ? record.nodeId : ''
    const revisionId = typeof record.revisionId === 'string' ? record.revisionId : ''
    return {
      handled: true,
      value: updateRevisionNode(nodeId, revisionId, toolName === 'select_asset_revision' ? 'select' : 'archive'),
    }
  }
  if (toolName === 'cancel_provider_task') {
    const runId = typeof record.runId === 'string' ? record.runId.trim() : ''
    const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : ''
    if (!runId && !taskId) throw new Error('cancel_provider_task requires runId or taskId')
    const payload = {
      projectId,
      projectBinding: project.binding,
      runId: runId || taskId,
      ...(taskId ? { taskId } : {}),
      ...(typeof record.nodeId === 'string' ? { nodeId: record.nodeId } : {}),
      ...(typeof record.vendor === 'string' ? { vendor: record.vendor } : {}),
    }
    return {
      handled: true,
      value: cancelWorkbenchTask(payload).then(result => { project.assertCurrent(); return result }),
    }
  }
  return { handled: false }
}
