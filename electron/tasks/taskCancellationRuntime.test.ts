import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getGlobalIdempotencyStore,
  initGlobalIdempotencyStore,
  resetGlobalIdempotencyStoreForTests,
} from './idempotencyStore'
import { createTaskCancellationRuntime } from './taskCancellationRuntime'

let tmpDir = ''

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-task-cancel-'))
  resetGlobalIdempotencyStoreForTests()
  initGlobalIdempotencyStore(tmpDir)
})

afterEach(() => {
  resetGlobalIdempotencyStoreForTests()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function seedTask(): void {
  getGlobalIdempotencyStore()?.seedForTests({
    idempotencyKey: 'run-1',
    providerTaskId: 'provider-1',
    vendorKey: 'comfyui-local',
    status: 'running',
    createdAt: 1,
  })
}

describe('createTaskCancellationRuntime', () => {
  it('keeps legacy vendor-less calls on the Codex run key path', async () => {
    const cancelCodex = vi.fn(async () => true)
    const cancel = createTaskCancellationRuntime({ cancelCodex })

    const result = await cancel({ runId: 'run-legacy' })

    expect(cancelCodex).toHaveBeenCalledWith('run-legacy')
    expect(result).toEqual({ cancelled: true, remoteCancelled: false })
  })

  it('uses the Provider task id for ComfyUI and persists cancelled', async () => {
    seedTask()
    const interruptComfyui = vi.fn(async () => true)
    const cancel = createTaskCancellationRuntime({ interruptComfyui })

    const result = await cancel({
      runId: 'run-1',
      taskId: 'provider-1',
      vendor: 'comfyui-local',
    })

    expect(interruptComfyui).toHaveBeenCalledWith('provider-1')
    expect(result).toEqual({ cancelled: true, remoteCancelled: true })
    expect(getGlobalIdempotencyStore()?.get('run-1')).toMatchObject({
      status: 'cancelled',
      settledAt: expect.any(Number),
    })
  })

  it('does not call a cancellation implementation for unsupported Providers', async () => {
    seedTask()
    const cancelCodex = vi.fn(async () => true)
    const interruptComfyui = vi.fn(async () => true)
    const cancel = createTaskCancellationRuntime({ cancelCodex, interruptComfyui })

    const result = await cancel({ runId: 'run-1', taskId: 'provider-1', vendor: 'jimeng-web' })

    expect(cancelCodex).not.toHaveBeenCalled()
    expect(interruptComfyui).not.toHaveBeenCalled()
    expect(result.cancelled).toBe(false)
    expect(result.reason).toContain('不支持')
    expect(getGlobalIdempotencyStore()?.get('run-1')?.status).toBe('running')
  })

  it('returns false without an id and does not touch Providers', async () => {
    const cancelCodex = vi.fn(async () => true)
    const cancel = createTaskCancellationRuntime({ cancelCodex })

    await expect(cancel({ vendor: 'codex' })).resolves.toEqual({
      cancelled: false,
      remoteCancelled: false,
    })
    expect(cancelCodex).not.toHaveBeenCalled()
  })
})
