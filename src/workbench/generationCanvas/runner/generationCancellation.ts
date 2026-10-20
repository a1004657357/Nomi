import type { ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { cancelWorkbenchTask } from '../../api/taskApi'
import { markTaskCancelRequested } from './localTaskControl'

export const activeGenerationRuns = new Map<string, { controller: AbortController; runId: string; projectId: string; taskId?: string }>()

const activeGenerationBatchControllers = new Set<AbortController>()

export function createGenerationBatchCancellation(signal?: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  activeGenerationBatchControllers.add(controller)
  return { controller, dispose: () => { signal?.removeEventListener('abort', abort); activeGenerationBatchControllers.delete(controller) } }
}

export function cancelGenerationNode(nodeId: string, project: ProjectExecutionContext): boolean {
  project.assertCurrent()
  const projectId = project.binding.projectId
  const active = activeGenerationRuns.get(projectId + ':' + nodeId)
  if (!active) return false
  active.controller.abort()
  markTaskCancelRequested(nodeId)
  const payload = { runId: active.runId, nodeId, projectId, projectBinding: project.binding, ...(active.taskId ? { taskId: active.taskId } : {}) }
  void cancelWorkbenchTask(payload).catch(() => {})
  return true
}

export function cancelGenerationNodes(nodeIds: readonly string[], project: ProjectExecutionContext): number {
  project.assertCurrent()
  return nodeIds.filter(nodeId => cancelGenerationNode(nodeId, project)).length
}

export function cancelAllGenerationRuns(): number {
  for (const controller of activeGenerationBatchControllers) controller.abort()
  let count = 0
  for (const [key, active] of activeGenerationRuns) {
    active.controller.abort()
    const nodeId = key.slice(active.projectId.length + 1)
    markTaskCancelRequested(nodeId)
    void cancelWorkbenchTask({ runId: active.runId, nodeId, ...(active.taskId ? { taskId: active.taskId } : {}) }).catch(() => {})
    count++
  }
  return count
}

