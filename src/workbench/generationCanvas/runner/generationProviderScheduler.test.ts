import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  createGenerationProviderScheduler,
  generationProviderLimit,
  generationStartRatePolicy,
} from './generationProviderScheduler'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('generationProviderScheduler', () => {
  it('keeps Codex serial while another provider can start', async () => {
    const scheduler = createGenerationProviderScheduler({ globalLimit: 4 })
    const gates = [deferred(), deferred(), deferred(), deferred()]
    let activeCodex = 0
    let maxActiveCodex = 0
    let kieStarted = false

    const codexRuns = gates.slice(0, 3).map((gate) =>
      scheduler.run('codex', async () => {
        activeCodex += 1
        maxActiveCodex = Math.max(maxActiveCodex, activeCodex)
        await gate.promise
        activeCodex -= 1
      }),
    )
    const kieRun = scheduler.run('kie', async () => {
      kieStarted = true
      await gates[3].promise
    })

    await vi.waitFor(() => {
      expect(maxActiveCodex).toBe(1)
      expect(kieStarted).toBe(true)
      expect(scheduler.snapshot()).toMatchObject({ active: 2, queued: 2 })
    })

    gates.forEach((gate) => gate.resolve())
    await Promise.all([...codexRuns, kieRun])
  })

  it('reports the Codex provider queue position before a third run starts', async () => {
    const scheduler = createGenerationProviderScheduler({ globalLimit: 4 })
    const firstGate = deferred()
    const secondGate = deferred()
    const queueEvents: Array<{
      providerKey: string
      queueAhead: number
      activeForProvider: number
      providerLimit: number
    }> = []

    const first = scheduler.run('codex', () => firstGate.promise)
    const second = scheduler.run('codex', () => secondGate.promise)
    const thirdWork = vi.fn(async () => undefined)
    const third = scheduler.run('codex', thirdWork, {
      onQueueWait: (event) => queueEvents.push(event),
    })

    expect(thirdWork).not.toHaveBeenCalled()
    expect(queueEvents).toEqual([{
      providerKey: 'codex',
      queueAhead: 1,
      activeForProvider: 1,
      providerLimit: 1,
    }])

    firstGate.resolve()
    await first
    secondGate.resolve()
    await second
    await third
  })

  it('never exceeds the global limit across different providers', async () => {
    const scheduler = createGenerationProviderScheduler({ globalLimit: 3, defaultProviderLimit: 3 })
    const gates = Array.from({ length: 5 }, deferred)
    let active = 0
    let maxActive = 0

    const runs = gates.map((gate, index) =>
      scheduler.run(`vendor-${index}`, async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await gate.promise
        active -= 1
      }),
    )

    await vi.waitFor(() => expect(maxActive).toBe(3))
    gates.forEach((gate) => gate.resolve())
    await Promise.all(runs)
    expect(maxActive).toBe(3)
  })

  it('removes an aborted queued run before its work starts', async () => {
    const scheduler = createGenerationProviderScheduler({ globalLimit: 1, defaultProviderLimit: 1 })
    const gate = deferred()
    const first = scheduler.run('kie', () => gate.promise)
    const controller = new AbortController()
    const work = vi.fn(async () => undefined)
    const second = scheduler.run('kie', work, { signal: controller.signal })

    controller.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(work).not.toHaveBeenCalled()

    gate.resolve()
    await first
  })

  it('uses conservative limits for Codex and Jimeng', () => {
    expect(generationProviderLimit('codex')).toBe(1)
    expect(generationProviderLimit('jimeng-web')).toBe(1)
    expect(generationProviderLimit('pavo-web')).toBe(1)
    expect(generationProviderLimit('agnes')).toBe(4)
  })

  it('spaces Agnes video starts with rolling-window headroom without blocking another provider', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const scheduler = createGenerationProviderScheduler({ globalLimit: 3, defaultProviderLimit: 3 })
    const starts: string[] = []
    const waits: number[] = []

    const first = scheduler.run('agnes', async () => {
      starts.push('agnes-1')
    }, {
      rateKey: 'agnes:video',
      minimumStartIntervalMs: 75_000,
    })
    const second = scheduler.run('agnes', async () => {
      starts.push('agnes-2')
    }, {
      rateKey: 'agnes:video',
      minimumStartIntervalMs: 75_000,
      onRateLimitWait: ({ waitMs }) => waits.push(waitMs),
    })
    const other = scheduler.run('kie', async () => {
      starts.push('kie')
    })

    await Promise.all([first, other])
    expect(starts).toEqual(['agnes-1', 'kie'])
    expect(waits).toEqual([75_000])
    expect(scheduler.snapshot()).toMatchObject({ active: 0, queued: 1, rateLimitedQueued: 1 })

    await vi.advanceTimersByTimeAsync(74_999)
    expect(starts).toEqual(['agnes-1', 'kie'])
    await vi.advanceTimersByTimeAsync(1)
    await second
    expect(starts).toEqual(['agnes-1', 'kie', 'agnes-2'])
  })

  it('derives modality-specific conservative Agnes start intervals from a node', () => {
    const makeNode = (kind: GenerationCanvasNode['kind'], modelKey: string): GenerationCanvasNode => ({
      id: `${kind}-${modelKey}`,
      kind,
      title: modelKey,
      position: { x: 0, y: 0 },
      meta: { vendor: 'agnes', modelKey },
    })

    expect(generationStartRatePolicy(makeNode('video', 'agnes-video-v2.0'))).toMatchObject({
      rateKey: 'agnes:video',
      minimumStartIntervalMs: 75_000,
    })
    expect(generationStartRatePolicy(makeNode('image', 'agnes-image-2.1-flash'))).toMatchObject({
      rateKey: 'agnes:image',
      minimumStartIntervalMs: 6_000,
    })
    expect(generationStartRatePolicy(makeNode('image', 'other-image'))).toMatchObject({
      rateKey: 'agnes:default',
      minimumStartIntervalMs: 3_000,
    })
    expect(generationStartRatePolicy({
      ...makeNode('video', 'other-video'),
      meta: { vendor: 'kie', modelKey: 'other-video' },
    })).toBeNull()
    expect(generationStartRatePolicy({
      ...makeNode('video', 'agnes-video-v2.0'),
      meta: { modelKey: 'agnes-video-v2.0' },
    })).toMatchObject({
      rateKey: 'agnes:video',
      minimumStartIntervalMs: 75_000,
    })
  })

  it('cancels a rate-limited queued run without starting it later', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const scheduler = createGenerationProviderScheduler({ globalLimit: 2 })
    const first = scheduler.run('agnes', async () => undefined, {
      rateKey: 'agnes:video',
      minimumStartIntervalMs: 75_000,
    })
    const controller = new AbortController()
    const work = vi.fn(async () => undefined)
    const second = scheduler.run('agnes', work, {
      signal: controller.signal,
      rateKey: 'agnes:video',
      minimumStartIntervalMs: 75_000,
    })

    await first
    controller.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(75_000)
    expect(work).not.toHaveBeenCalled()
    expect(scheduler.snapshot()).toMatchObject({ active: 0, queued: 0, rateLimitedQueued: 0 })
  })
})
