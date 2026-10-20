import { recordPersistedTaskResult, runTaskWithIdempotency } from '../submissionLedger'
import type { IdempotencyRecord } from './idempotencyStore'
import { withNodeSubmitExclusive } from './nodeSubmitInFlight'

type RuntimeModule = typeof import('../runtime')

function recoveryPayload(payload: unknown, record: IdempotencyRecord): Record<string, unknown> {
  const raw = (payload || {}) as {
    vendor?: unknown
    request?: { kind?: unknown; prompt?: unknown; extras?: Record<string, unknown> }
  }
  const extras = raw.request?.extras || {}
  return {
    taskId: record.providerTaskId,
    vendor: record.vendorKey || String(raw.vendor || ''),
    taskKind: record.taskKind || String(raw.request?.kind || ''),
    modelKey: record.modelKey || String(extras.modelKey || extras.modelAlias || ''),
    projectId: record.projectId || String(extras.projectId || ''),
    prompt: String(raw.request?.prompt || ''),
  }
}

export function createTaskSubmissionRuntime(loadRuntime: () => Promise<RuntimeModule>): {
  run: (payload: unknown) => Promise<import('../runtime').TaskResult>
  result: (payload: unknown) => Promise<{ vendor: string; result: import('../runtime').TaskResult }>
} {
  return {
    run: async (payload) => {
      const runtime = await loadRuntime()
      const extras = (payload as { request?: { extras?: Record<string, unknown> } } | null)?.request?.extras;
      return runTaskWithIdempotency(payload, () => withNodeSubmitExclusive(extras, () => runtime.runTask(payload)), {
        recoverPersisted: async (record) => {
          const recovered = await runtime.fetchTaskResult(recoveryPayload(payload, record))
          return recovered.result
        },
      })
    },
    result: async (payload) => {
      const runtime = await loadRuntime()
      const response = await runtime.fetchTaskResult(payload)
      recordPersistedTaskResult(response.result)
      return response
    },
  }
}
