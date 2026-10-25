import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

export const GENERATION_GLOBAL_MAX_CONCURRENCY = 8
export const GENERATION_DEFAULT_PROVIDER_CONCURRENCY = 4
export const GENERATION_CODEX_PROVIDER_CONCURRENCY = 1
export const GENERATION_JIMENG_PROVIDER_CONCURRENCY = 1
export const GENERATION_PAVO_PROVIDER_CONCURRENCY = 1
// AGNES enforces the rolling minute at the provider POST boundary. Keep 15s
// headroom because local image publication/probing can shift POST timestamps.
export const GENERATION_AGNES_VIDEO_MIN_START_INTERVAL_MS = 75_000
export const GENERATION_AGNES_IMAGE_MIN_START_INTERVAL_MS = 6_000
export const GENERATION_AGNES_DEFAULT_MIN_START_INTERVAL_MS = 3_000

export type GenerationRateLimitWait = {
  rateKey: string
  waitMs: number
  minimumStartIntervalMs: number
}

export type GenerationQueueWait = {
  providerKey: string
  queueAhead: number
  activeForProvider: number
  providerLimit: number
}

export type GenerationStartRatePolicy = {
  rateKey: string
  minimumStartIntervalMs: number
  source: string
}

type GenerationSchedulerRunOptions = {
  signal?: AbortSignal
  rateKey?: string
  minimumStartIntervalMs?: number
  onRateLimitWait?: (wait: GenerationRateLimitWait) => void
  onQueueWait?: (wait: GenerationQueueWait) => void
}

type QueuedRun<T> = {
  providerKey: string
  work: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  rateKey?: string
  minimumStartIntervalMs: number
  signal?: AbortSignal
  abortListener?: () => void
}

export type GenerationSchedulerSnapshot = {
  active: number
  queued: number
  activeByProvider: Record<string, number>
  rateLimitedQueued: number
  nextStartByRateKey: Record<string, number>
}

export type GenerationProviderScheduler = {
  run: <T>(providerKey: string, work: () => Promise<T>, options?: GenerationSchedulerRunOptions) => Promise<T>
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
  if (normalized === 'pavo-web' || normalized.startsWith('pavo-web-')) return GENERATION_PAVO_PROVIDER_CONCURRENCY
  return fallback
}

export function generationProviderKey(node: GenerationCanvasNode): string {
  const meta = node.meta || {}
  const candidates = [meta.modelVendor, meta.vendor, meta.imageModelVendor, meta.videoModelVendor]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return normalizedProviderKey(value)
  }
  const modelKey = typeof meta.modelKey === 'string' ? meta.modelKey.trim().toLowerCase() : ''
  if (modelKey.startsWith('codex-')) return 'codex'
  if (modelKey.startsWith('agnes-')) return 'agnes'
  if (modelKey.startsWith('jimeng-web-')) return 'jimeng-web'
  if (modelKey.startsWith('pavo-')) return 'pavo-web'
  return 'unconfigured'
}

function generationModelKey(node: GenerationCanvasNode): string {
  const meta = node.meta || {}
  const candidates = [meta.modelKey, meta.modelAlias, meta.imageModel, meta.videoModel]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase()
  }
  return ''
}

/**
 * Public free/default limits published by Agnes on 2026-06-28:
 * image 1K 20 RPM, image 2K 10 RPM, video 1 RPM.
 * Nomi uses the conservative 2K image interval because its image controls reach
 * 1536px. Paid/enterprise accounts may be faster, but the default path must not
 * burst beyond the free route advertised in onboarding.
 */
export function generationStartRatePolicy(node: GenerationCanvasNode): GenerationStartRatePolicy | null {
  if (generationProviderKey(node) !== 'agnes') return null
  const modelKey = generationModelKey(node)
  if (modelKey.includes('agnes-video') || node.kind === 'video') {
    return {
      rateKey: 'agnes:video',
      minimumStartIntervalMs: GENERATION_AGNES_VIDEO_MIN_START_INTERVAL_MS,
      source: 'Agnes public free/default video limit, 2026-06-28',
    }
  }
  if (modelKey.includes('agnes-image')) {
    return {
      rateKey: 'agnes:image',
      minimumStartIntervalMs: GENERATION_AGNES_IMAGE_MIN_START_INTERVAL_MS,
      source: 'Agnes public free/default image 2K limit, 2026-06-28',
    }
  }
  return {
    rateKey: 'agnes:default',
    minimumStartIntervalMs: GENERATION_AGNES_DEFAULT_MIN_START_INTERVAL_MS,
    source: 'Agnes public free/default text or 1K image limit, 2026-06-28',
  }
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
  const nextStartByRateKey = new Map<string, number>()
  let active = 0
  let wakeTimer: ReturnType<typeof globalThis.setTimeout> | undefined
  let wakeAt = 0

  const clearWakeTimer = (): void => {
    if (wakeTimer !== undefined) globalThis.clearTimeout(wakeTimer)
    wakeTimer = undefined
    wakeAt = 0
  }

  const entryReadyAt = (entry: QueuedRun<unknown>): number => (
    entry.rateKey ? nextStartByRateKey.get(entry.rateKey) || 0 : 0
  )

  const snapshot = (): GenerationSchedulerSnapshot => ({
    active,
    queued: queue.length,
    activeByProvider: Object.fromEntries(activeByProvider),
    rateLimitedQueued: queue.filter((entry) => entryReadyAt(entry) > Date.now()).length,
    nextStartByRateKey: Object.fromEntries(nextStartByRateKey),
  })

  const scheduleWake = (target: number): void => {
    if (!Number.isFinite(target)) return
    if (wakeTimer !== undefined && wakeAt <= target) return
    clearWakeTimer()
    wakeAt = target
    wakeTimer = globalThis.setTimeout(() => {
      wakeTimer = undefined
      wakeAt = 0
      pump()
    }, Math.max(0, target - Date.now()))
  }

  const pump = (): void => {
    while (active < globalLimit && queue.length > 0) {
      const now = Date.now()
      let earliestRateReadyAt = Number.POSITIVE_INFINITY
      const nextIndex = queue.findIndex((entry) => {
        const providerActive = activeByProvider.get(entry.providerKey) || 0
        if (providerActive >= generationProviderLimit(entry.providerKey, defaultProviderLimit)) return false
        const readyAt = entryReadyAt(entry)
        if (readyAt <= now) return true
        earliestRateReadyAt = Math.min(earliestRateReadyAt, readyAt)
        return false
      })
      if (nextIndex < 0) {
        scheduleWake(earliestRateReadyAt)
        return
      }
      const [entry] = queue.splice(nextIndex, 1)
      if (!entry) return
      if (entry.abortListener && entry.signal) entry.signal.removeEventListener('abort', entry.abortListener)
      if (entry.signal?.aborted) {
        entry.reject(abortError())
        continue
      }

      if (entry.rateKey && entry.minimumStartIntervalMs > 0) {
        nextStartByRateKey.set(entry.rateKey, now + entry.minimumStartIntervalMs)
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
    if (queue.length === 0) clearWakeTimer()
  }

  const run = <T>(
    providerKey: string,
    work: () => Promise<T>,
    options: GenerationSchedulerRunOptions = {},
  ): Promise<T> => {
    if (options.signal?.aborted) return Promise.reject(abortError())
    return new Promise<T>((resolve, reject) => {
      const minimumStartIntervalMs = Math.max(0, Math.floor(options.minimumStartIntervalMs || 0))
      const rateKey = minimumStartIntervalMs > 0 && options.rateKey?.trim()
        ? options.rateKey.trim().toLowerCase()
        : undefined
      const entry: QueuedRun<T> = {
        providerKey: normalizedProviderKey(providerKey),
        work,
        resolve,
        reject,
        minimumStartIntervalMs,
        ...(rateKey ? { rateKey } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      }
      const activeForProvider = activeByProvider.get(entry.providerKey) || 0
      const providerLimit = generationProviderLimit(entry.providerKey, defaultProviderLimit)
      const queueAhead = queue.filter((candidate) => candidate.providerKey === entry.providerKey).length
      const rateReadyAt = rateKey ? nextStartByRateKey.get(rateKey) || 0 : 0
      if (
        options.onQueueWait
        && (active >= globalLimit || activeForProvider >= providerLimit || rateReadyAt > Date.now())
      ) {
        options.onQueueWait({ providerKey: entry.providerKey, queueAhead, activeForProvider, providerLimit })
      }
      if (rateKey && options.onRateLimitWait) {
        const now = Date.now()
        const queuedAhead = queue.filter((candidate) => candidate.rateKey === rateKey).length
        const readyAt = Math.max(now, nextStartByRateKey.get(rateKey) || 0)
        const waitMs = Math.max(0, readyAt - now) + queuedAhead * minimumStartIntervalMs
        if (waitMs > 0) {
          options.onRateLimitWait({ rateKey, waitMs, minimumStartIntervalMs })
        }
      }
      if (options.signal) {
        entry.abortListener = () => {
          const index = queue.indexOf(entry as QueuedRun<unknown>)
          if (index < 0) return
          queue.splice(index, 1)
          reject(abortError())
          if (queue.length === 0) clearWakeTimer()
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
  options: {
    signal?: AbortSignal
    onRateLimitWait?: (wait: GenerationRateLimitWait) => void
    onQueueWait?: (wait: GenerationQueueWait) => void
  } = {},
): Promise<T> {
  const ratePolicy = generationStartRatePolicy(node)
  return globalGenerationProviderScheduler.run(generationProviderKey(node), work, {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onRateLimitWait ? { onRateLimitWait: options.onRateLimitWait } : {}),
    ...(options.onQueueWait ? { onQueueWait: options.onQueueWait } : {}),
    ...(ratePolicy
      ? {
          rateKey: ratePolicy.rateKey,
          minimumStartIntervalMs: ratePolicy.minimumStartIntervalMs,
        }
      : {}),
  })
}
