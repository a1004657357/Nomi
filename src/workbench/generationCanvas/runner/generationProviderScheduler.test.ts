import { describe, expect, it, vi } from 'vitest'
import { createGenerationProviderScheduler, generationProviderLimit } from './generationProviderScheduler'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('generationProviderScheduler', () => {
  it('keeps Codex at two active runs while another provider can start', async () => {
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
      expect(maxActiveCodex).toBe(2)
      expect(kieStarted).toBe(true)
      expect(scheduler.snapshot()).toMatchObject({ active: 3, queued: 1 })
    })

    gates.forEach((gate) => gate.resolve())
    await Promise.all([...codexRuns, kieRun])
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
    expect(generationProviderLimit('codex')).toBe(2)
    expect(generationProviderLimit('jimeng-web')).toBe(2)
    expect(generationProviderLimit('agnes')).toBe(4)
  })
})
