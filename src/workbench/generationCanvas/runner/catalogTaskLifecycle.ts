import type { GenerationNodeResult } from '../model/generationCanvasTypes'
import { narrateProgress } from '../../observability/narrate'
import type { CatalogTaskActionOptions } from './catalogTaskResolve'
import type { PhaseClock, PhaseWaitGuard } from './generationPhaseDeadline'
import { LocalTaskCancelledError, onTaskCancelRequested } from './localTaskControl'

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('生成已取消', 'AbortError')
}

export function subscribeCatalogCancellation(nodeId: string, signal?: AbortSignal): NonNullable<PhaseWaitGuard['cancelled']> {
  return (stop) => {
    const abort = () => stop(new DOMException('生成已取消', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    const unsubscribe = onTaskCancelRequested(nodeId, () => stop(new LocalTaskCancelledError()))
    if (signal?.aborted) abort()
    return () => {
      signal?.removeEventListener('abort', abort)
      unsubscribe()
    }
  }
}

/** Display-only heartbeat: a timer is not provider progress and cannot renew the deadline. */
export async function withSubmissionHeartbeat<T>(
  run: () => Promise<T>, options: CatalogTaskActionOptions, clock: PhaseClock,
): Promise<T> {
  const interval = options.requestHeartbeatMs
  const heartbeatMs = typeof interval === 'number' && Number.isFinite(interval) ? Math.max(1, Math.floor(interval)) : 5_000
  const startedAt = Date.now()
  const timer = setInterval(() => {
    if (clock.current()?.phase !== 'requesting' || options.signal?.aborted) return
    options.onProgress?.({ phase: 'generating', message: narrateProgress('generating', { elapsedMs: Date.now() - startedAt }) })
  }, heartbeatMs)
  try {
    return await run()
  } finally {
    clearInterval(timer)
  }
}

export function attachGenerationPhaseTimings(
  result: GenerationNodeResult,
  timings: { resolveMs: number; submitMs: number; pollMs: number; finalizeMs: number; totalMs: number },
): GenerationNodeResult {
  const raw = result.raw && typeof result.raw === 'object' && !Array.isArray(result.raw)
    ? result.raw as Record<string, unknown> : { providerRaw: result.raw }
  const nomi = raw.__nomi && typeof raw.__nomi === 'object' && !Array.isArray(raw.__nomi)
    ? raw.__nomi as Record<string, unknown> : {}
  return { ...result, raw: { ...raw, __nomi: { ...nomi, generationPhases: timings } } }
}
