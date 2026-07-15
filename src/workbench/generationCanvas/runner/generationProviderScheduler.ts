import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

export const GENERATION_GLOBAL_MAX_CONCURRENCY = 8
export const GENERATION_DEFAULT_PROVIDER_CONCURRENCY = 4
export const GENERATION_CODEX_PROVIDER_CONCURRENCY = 2
export const GENERATION_JIMENG_PROVIDER_CONCURRENCY = 2

type QueuedRun<T> = {
  providerKey: string
  work: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  signal?: AbortSignal
  abortListener?: () => void
}

export type GenerationSchedulerSnapshot = {
  active: number
  queued: number
  activeByProvider: Record<string, number>
}

export type GenerationProviderScheduler = {
  run: <T>(providerKey: string, work: () => Promise<T>, options?: { signal?: AbortSignal }) => Promise<T>
  snapshot: () => GenerationSchedulerSnapshot
}

function normalizedProviderKey(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'unconfigured'
}

export function generationProviderLimit(
  providerKey: string,
  fallback = GENERATION_DEFAULT_PROVIDER_CONCURRENCY,
): number {
  const normalized = normalizedProviderKey(providerKey)
  if (normalized === 'codex' || normalized.startsWith('codex-')) return GENERATION_CODEX_PROVIDER_CONCURRENCY
  if (normalized === 'jimeng-web' || normalized.startsWith('jimeng-web-')) return GENERATION_JIMENG_PROVIDER_CONCURRENCY
  return fallback
}

export function generationProviderKey(node: GenerationCanvasNode): string {
  const meta = node.meta || {}
  const candidates = [meta.modelVendor, meta.vendor, meta.imageModelVendor, meta.videoModelVendor]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return normalizedProviderKey(value)
  }
  const modelKey = typeof meta.modelKey === 'string' ? meta.modelKey.trim().toLowerCase() : ''
  return modelKey.startsWith('codex-') ? 'codex' : 'unconfigured'
}

function abortError(): DOMException {
  return new DOMException('生成已取消', 'AbortError')
}

export function createGenerationProviderScheduler(
  input: {
    globalLimit?: number
    defaultProviderLimit?: number
  } = {},
): GenerationProviderScheduler {
  const globalLimit = Math.max(1, Math.floor(input.globalLimit ?? GENERATION_GLOBAL_MAX_CONCURRENCY))
  const defaultProviderLimit = Math.max(
    1,
    Math.floor(input.defaultProviderLimit ?? GENERATION_DEFAULT_PROVIDER_CONCURRENCY),
  )
  const queue: Array<QueuedRun<unknown>> = []
  const activeByProvider = new Map<string, number>()
  let active = 0

  const snapshot = (): GenerationSchedulerSnapshot => ({
    active,
    queued: queue.length,
    activeByProvider: Object.fromEntries(activeByProvider),
  })

  const pump = (): void => {
    while (active < globalLimit && queue.length > 0) {
      const nextIndex = queue.findIndex((entry) => {
        const providerActive = activeByProvider.get(entry.providerKey) || 0
        return providerActive < generationProviderLimit(entry.providerKey, defaultProviderLimit)
      })
      if (nextIndex < 0) return
      const [entry] = queue.splice(nextIndex, 1)
      if (!entry) return
      if (entry.abortListener && entry.signal) entry.signal.removeEventListener('abort', entry.abortListener)
      if (entry.signal?.aborted) {
        entry.reject(abortError())
        continue
      }

      active += 1
      activeByProvider.set(entry.providerKey, (activeByProvider.get(entry.providerKey) || 0) + 1)
      void entry
        .work()
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active = Math.max(0, active - 1)
          const remaining = Math.max(0, (activeByProvider.get(entry.providerKey) || 1) - 1)
          if (remaining === 0) activeByProvider.delete(entry.providerKey)
          else activeByProvider.set(entry.providerKey, remaining)
          pump()
        })
    }
  }

  const run = <T>(providerKey: string, work: () => Promise<T>, options: { signal?: AbortSignal } = {}): Promise<T> => {
    if (options.signal?.aborted) return Promise.reject(abortError())
    return new Promise<T>((resolve, reject) => {
      const entry: QueuedRun<T> = {
        providerKey: normalizedProviderKey(providerKey),
        work,
        resolve,
        reject,
        ...(options.signal ? { signal: options.signal } : {}),
      }
      if (options.signal) {
        entry.abortListener = () => {
          const index = queue.indexOf(entry as QueuedRun<unknown>)
          if (index < 0) return
          queue.splice(index, 1)
          reject(abortError())
          pump()
        }
        options.signal.addEventListener('abort', entry.abortListener, { once: true })
      }
      queue.push(entry as QueuedRun<unknown>)
      pump()
    })
  }

  return { run, snapshot }
}

export const globalGenerationProviderScheduler = createGenerationProviderScheduler()

export function runWithGenerationProviderSlot<T>(
  node: GenerationCanvasNode,
  work: () => Promise<T>,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  return globalGenerationProviderScheduler.run(generationProviderKey(node), work, options)
}
