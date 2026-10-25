import { cancelProviderTask } from '../catalog/providerAdapterContract'
import { recordPersistedTaskCancellation } from '../submissionLedger'

export type TaskCancellationPayload = {
  runId?: unknown
  taskId?: unknown
  vendor?: unknown
}

export type TaskCancellationResult = {
  cancelled: boolean
  remoteCancelled: boolean
  reason?: string
}

type CancellationDependencies = {
  cancelCodex: (runId: string) => Promise<boolean>
  interruptComfyui: (taskId: string) => Promise<boolean>
  recordCancellation: (input: { idempotencyKey?: string; providerTaskId?: string }) => void
}

const defaultDependencies: CancellationDependencies = {
  cancelCodex: async (runId) => {
    const { cancelCodexImageGeneration } = await import('../ai/codexImagegenRunner')
    return cancelCodexImageGeneration(runId)
  },
  interruptComfyui: async (taskId) => {
    const { interruptComfyuiTask } = await import('../comfyuiProgressSocket')
    return (await interruptComfyuiTask(taskId)).ok
  },
  recordCancellation: recordPersistedTaskCancellation,
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Unified cancellation boundary for the desktop task IPC.
 *
 * Cancellation is always best-effort and never submits a new Provider task.
 * Calls without a vendor keep the historical Codex behavior for old projects.
 */
export function createTaskCancellationRuntime(
  overrides: Partial<CancellationDependencies> = {},
): (payload: TaskCancellationPayload) => Promise<TaskCancellationResult> {
  const dependencies = { ...defaultDependencies, ...overrides }
  return async (payload) => {
    const runId = normalizedString(payload?.runId)
    const taskId = normalizedString(payload?.taskId)
    const providerId = normalizedString(payload?.vendor).toLowerCase() || 'codex'
    const isCodex = providerId === 'codex' || providerId === 'codex-local'
    const cancellationTarget = isCodex ? runId || taskId : taskId || runId
    if (!cancellationTarget) return { cancelled: false, remoteCancelled: false }

    const result = await cancelProviderTask(providerId, cancellationTarget, async (provider, id) => {
      if (provider === 'codex' || provider === 'codex-local') {
        return { cancelled: await dependencies.cancelCodex(id), remoteCancelled: false }
      }
      if (provider === 'comfyui-local') {
        const cancelled = await dependencies.interruptComfyui(id)
        return { cancelled, remoteCancelled: cancelled }
      }
      return { cancelled: false, remoteCancelled: false }
    })

    if (result.cancelled) {
      dependencies.recordCancellation({
        ...(runId ? { idempotencyKey: runId } : {}),
        ...(taskId ? { providerTaskId: taskId } : {}),
      })
    }
    return result
  }
}

export const taskCancellationRuntime = createTaskCancellationRuntime()
