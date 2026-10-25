import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDefaultSubmissionLedgerForTests } from '../submissionLedger'
import {
  getGlobalIdempotencyStore,
  initGlobalIdempotencyStore,
  resetGlobalIdempotencyStoreForTests,
} from './idempotencyStore'
import { createTaskSubmissionRuntime } from './taskSubmissionRuntime'

let tmpDir = ''

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-task-runtime-'))
  resetDefaultSubmissionLedgerForTests()
  resetGlobalIdempotencyStoreForTests()
  initGlobalIdempotencyStore(tmpDir)
})

afterEach(() => {
  resetDefaultSubmissionLedgerForTests()
  resetGlobalIdempotencyStoreForTests()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('createTaskSubmissionRuntime', () => {
  it('never creates again after an unacknowledged submission, including after restart', async () => {
    const create = vi.fn(async () => { throw new Error('[nomi:submission-unknown] acknowledgement missing'); });
    const query = vi.fn();
    const load = async () => ({ runTask: create, fetchTaskResult: query }) as unknown as typeof import('../runtime');
    const payload = { vendor: 'fixture', request: { kind: 'text_to_video', extras: { idempotencyKey: 'missing-ack' } } };
    const runtime = createTaskSubmissionRuntime(load);
    const results = await Promise.allSettled([runtime.run(payload), runtime.run(payload)]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(getGlobalIdempotencyStore()?.get('missing-ack')).toMatchObject({ status: 'unknown' });
    expect(getGlobalIdempotencyStore()?.get('missing-ack')?.providerTaskId).toBeUndefined();
    resetDefaultSubmissionLedgerForTests();
    resetGlobalIdempotencyStoreForTests();
    initGlobalIdempotencyStore(tmpDir);
    await expect(createTaskSubmissionRuntime(load).run(payload)).rejects.toThrow(/系统不会自动重发/);
    expect(create).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });
  it('routes a restarted duplicate through query-only recovery', async () => {
    const create = vi.fn(async () => ({ id: 'provider-1', kind: 'text_to_video', status: 'queued', assets: [], raw: {} }))
    const query = vi.fn(async () => ({
      vendor: 'agnes',
      result: { id: 'provider-1', kind: 'text_to_video', status: 'running', assets: [], raw: {} },
    }))
    const loadRuntime = async () => ({ runTask: create, fetchTaskResult: query }) as unknown as typeof import('../runtime')
    const payload = {
      vendor: 'agnes',
      request: {
        kind: 'text_to_video',
        prompt: 'camera follows subject',
        extras: { idempotencyKey: 'intent-1', modelKey: 'agnes-video', projectId: 'project-1' },
      },
    }

    await createTaskSubmissionRuntime(loadRuntime).run(payload)
    resetDefaultSubmissionLedgerForTests()
    resetGlobalIdempotencyStoreForTests()
    initGlobalIdempotencyStore(tmpDir)

    const recovered = await createTaskSubmissionRuntime(loadRuntime).run(payload)
    expect(create).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'provider-1',
      vendor: 'agnes',
      taskKind: 'text_to_video',
      modelKey: 'agnes-video',
      projectId: 'project-1',
    }))
    expect(recovered.status).toBe('running')
  })

  it('writes free query terminal status back to the persistent ledger', async () => {
    const loadForCreate = async () => ({
      runTask: async () => ({ id: 'provider-2', kind: 'text_to_video', status: 'queued', assets: [], raw: {} }),
      fetchTaskResult: async () => ({ vendor: 'agnes', result: {} }),
    }) as unknown as typeof import('../runtime')
    const payload = {
      vendor: 'agnes',
      request: { kind: 'text_to_video', extras: { idempotencyKey: 'intent-2' } },
    }
    await createTaskSubmissionRuntime(loadForCreate).run(payload)

    const loadForQuery = async () => ({
      runTask: async () => ({ id: '', kind: 'text_to_video', status: 'failed', assets: [], raw: {} }),
      fetchTaskResult: async () => ({
        vendor: 'agnes',
        result: { id: 'provider-2', kind: 'text_to_video', status: 'succeeded', assets: [], raw: {} },
      }),
    }) as unknown as typeof import('../runtime')
    await createTaskSubmissionRuntime(loadForQuery).result({ taskId: 'provider-2' })

    expect(getGlobalIdempotencyStore()?.get('intent-2')).toMatchObject({
      status: 'succeeded',
      settledAt: expect.any(Number),
    })
  })

  it('does not overwrite a persisted cancellation with unknown when the create promise rejects', async () => {
    let rejectCreate: ((error: Error) => void) | undefined
    const create = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectCreate = reject
    }))
    const loadRuntime = async () => ({
      runTask: create,
      fetchTaskResult: async () => ({ vendor: 'codex', result: {} }),
    }) as unknown as typeof import('../runtime')
    const payload = {
      vendor: 'codex',
      request: { kind: 'text_to_image', extras: { idempotencyKey: 'cancelled-intent' } },
    }

    const running = createTaskSubmissionRuntime(loadRuntime).run(payload)
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const store = getGlobalIdempotencyStore()
    const started = store?.get('cancelled-intent')
    expect(started?.status).toBe('submitting')
    store?.record({ ...started!, status: 'cancelled', settledAt: Date.now() })
    rejectCreate?.(new Error('cancelled by user'))

    await expect(running).rejects.toThrow('cancelled by user')
    expect(store?.get('cancelled-intent')?.status).toBe('cancelled')
  })
})
