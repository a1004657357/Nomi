/**
 * Slice 6 测试：提交幂等的磁盘持久化（§20 tasks/ledger.jsonl）。
 *
 * 验收（Gate 1 Slice 6）——钱安全铁律：
 * - 重启 fixture：写 ledger → 新 store 实例（模拟新进程）→ 同 key 提交 → fn 调用次数仍为 0
 *   （绝不二次付费；抛 SubmissionReplayError 引导走 query-only 恢复）。
 * - 记录有 providerTaskId → 错误信息含任务 id（引导查询恢复，§10.2 unknown 不重发）。
 * - 记录无 providerTaskId（create 结果未知）→ 错误信息引导新建意图（新 key）。
 * - TTL 过期（24h）后同 key 可重新执行。
 * - 磁盘写失败不阻塞（best-effort，降级回纯进程内台账）。
 * - 无 idempotencyKey 的旧路径完全不介入（向后兼容）。
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskResult } from '../runtime'
import {
  IdempotencyStore,
  SubmissionReplayError,
  getGlobalIdempotencyStore,
  initGlobalIdempotencyStore,
  resetGlobalIdempotencyStoreForTests,
} from './idempotencyStore'
import {
  recordPersistedTaskResult,
  resetDefaultSubmissionLedgerForTests,
  runTaskWithIdempotency,
} from '../submissionLedger'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ledger-'))
  resetDefaultSubmissionLedgerForTests()
  resetGlobalIdempotencyStoreForTests()
})

afterEach(() => {
  resetGlobalIdempotencyStoreForTests()
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

function payloadWith(key: string, vendor = 'kie'): unknown {
  return { vendor, request: { kind: 'text_to_video', extras: { idempotencyKey: key } } }
}

describe('IdempotencyStore — 磁盘持久化与重启 replay', () => {
  it('records a settled entry and reloads it in a new instance (simulating restart)', () => {
    const now = Date.now()
    const store1 = new IdempotencyStore({ ledgerDir: tmpDir, now: () => now })
    store1.record({
      idempotencyKey: 'key-1',
      providerTaskId: 'task-99',
      vendorKey: 'kie',
      status: 'succeeded',
      createdAt: now - 1000,
      settledAt: now - 500,
    })

    // 新实例 = 新进程（读同一 ledger.jsonl）
    const store2 = new IdempotencyStore({ ledgerDir: tmpDir, now: () => now })
    expect(store2.has('key-1')).toBe(true)
    const rec = store2.get('key-1')
    expect(rec?.providerTaskId).toBe('task-99')
    expect(rec?.status).toBe('succeeded')
  })

  it('TTL expiry (24h) allows the same key to execute again', () => {
    const fixedNow = 1_000_000
    const store = new IdempotencyStore({ ledgerDir: tmpDir, now: () => fixedNow })
    store.record({
      idempotencyKey: 'key-old',
      status: 'succeeded',
      createdAt: fixedNow - 100_000,
      settledAt: fixedNow - 100_000, // 远超 24h 前
    })
    // 推进时间到 25h 后
    const futureStore = new IdempotencyStore({
      ledgerDir: tmpDir,
      now: () => fixedNow + 25 * 60 * 60 * 1000,
    })
    expect(futureStore.has('key-old')).toBe(false) // 过期，不 replay
  })

  it('best-effort: missing ledger dir does not throw on read', () => {
    const store = new IdempotencyStore({ ledgerDir: path.join(tmpDir, 'nonexistent-nested') })
    expect(store.has('never-recorded')).toBe(false)
  })

  it('corrupted jsonl line is skipped without breaking other records', () => {
    const now = Date.now()
    const ledgerFile = path.join(tmpDir, 'tasks', 'ledger.jsonl')
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true })
    fs.writeFileSync(
      ledgerFile,
      [
        '{not valid json',
        JSON.stringify({ idempotencyKey: 'good', status: 'succeeded', createdAt: now, settledAt: now }),
        '',
      ].join('\n'),
      'utf8',
    )
    const store = new IdempotencyStore({ ledgerDir: tmpDir, now: () => now })
    expect(store.has('good')).toBe(true)
    expect(store.has('bad')).toBe(false)
  })
})

describe('runTaskWithIdempotency — 跨重启钱安全（Slice 6 核心）', () => {
  it('persists submitting before the provider promise settles', async () => {
    initGlobalIdempotencyStore(tmpDir)
    let release: (value: { id: string; status: 'queued'; assets: never[] }) => void = () => {}
    const pending = runTaskWithIdempotency(payloadWith('key-inflight'), () =>
      new Promise((resolve) => {
        release = resolve
      }),
    )

    const restartedView = new IdempotencyStore({ ledgerDir: tmpDir })
    expect(restartedView.get('key-inflight')).toMatchObject({
      status: 'submitting',
      vendorKey: 'kie',
      taskKind: 'text_to_video',
    })

    release({ id: 'task-inflight', status: 'queued', assets: [] })
    await pending
    const settledView = new IdempotencyStore({ ledgerDir: tmpDir })
    expect(settledView.get('key-inflight')).toMatchObject({
      status: 'queued',
      providerTaskId: 'task-inflight',
    })
  })

  it('rejects re-execution of a key that was settled in a previous session (no double-bill)', async () => {
    // 会话 1：初始化全局 store + 提交成功
    initGlobalIdempotencyStore(tmpDir)
    let fnCalls = 0
    const result1 = await runTaskWithIdempotency(payloadWith('key-restart'), async () => {
      fnCalls++
      return { id: 'task-77', assets: [] }
    })
    expect(result1).toEqual({ id: 'task-77', assets: [] })
    expect(fnCalls).toBe(1)

    // 模拟重启：清进程内台账，但持久 store 留在磁盘 → 新全局 store 读同一文件
    resetDefaultSubmissionLedgerForTests()
    resetGlobalIdempotencyStoreForTests()
    initGlobalIdempotencyStore(tmpDir)

    // 会话 2：同 key 再提交 → 绝不重新执行 fn
    let fnCalls2 = 0
    await expect(
      runTaskWithIdempotency(payloadWith('key-restart'), async () => {
        fnCalls2++
        return { id: 'task-78', assets: [] }
      }),
    ).rejects.toThrow(SubmissionReplayError)
    expect(fnCalls2).toBe(0) // **钱安全不变量：重启后同 key 调用 fn 次数为 0**
  })

  it('replay error carries providerTaskId to guide query-only recovery', async () => {
    initGlobalIdempotencyStore(tmpDir)
    await runTaskWithIdempotency(payloadWith('key-with-taskid'), async () => ({
      id: 'task-provid-123',
      assets: [],
    }))
    resetDefaultSubmissionLedgerForTests()
    resetGlobalIdempotencyStoreForTests()
    initGlobalIdempotencyStore(tmpDir)

    try {
      await runTaskWithIdempotency(payloadWith('key-with-taskid'), async () => ({}))
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SubmissionReplayError)
      const rec = (e as SubmissionReplayError).record
      expect(rec.providerTaskId).toBe('task-provid-123')
      expect((e as Error).message).toContain('task-provid-123')
      expect((e as Error).message).toMatch(/查询恢复|query/i)
    }
  })

  it('uses query-only recovery after restart and never calls create again', async () => {
    initGlobalIdempotencyStore(tmpDir)
    await runTaskWithIdempotency(payloadWith('key-query-only'), async () => ({
      id: 'task-query-only',
      status: 'queued' as const,
      assets: [],
    }))
    resetDefaultSubmissionLedgerForTests()
    resetGlobalIdempotencyStoreForTests()
    initGlobalIdempotencyStore(tmpDir)

    let createCalls = 0
    let queryCalls = 0
    const recovered = await runTaskWithIdempotency<TaskResult>(
      payloadWith('key-query-only'),
      async () => {
        createCalls++
        return { id: 'should-not-exist', kind: 'text_to_video', status: 'queued', assets: [], raw: null }
      },
      {
        recoverPersisted: async (record) => {
          queryCalls++
          expect(record.providerTaskId).toBe('task-query-only')
          return { id: 'task-query-only', kind: 'text_to_video', status: 'running', assets: [], raw: null }
        },
      },
    )

    expect(recovered.status).toBe('running')
    expect(createCalls).toBe(0)
    expect(queryCalls).toBe(1)
    expect(getGlobalStoreOrFail().get('key-query-only')?.status).toBe('running')
  })

  it('replay error without providerTaskId guides toward new intent (new key)', async () => {
    // 模拟 create 结果未知：直接 seed 一条无 providerTaskId 的记录
    initGlobalIdempotencyStore(tmpDir)
    getGlobalStoreOrFail().seedForTests({
      idempotencyKey: 'key-unknown',
      status: 'unknown',
      createdAt: 1,
    })
    try {
      await runTaskWithIdempotency(payloadWith('key-unknown'), async () => ({}))
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SubmissionReplayError)
      expect((e as Error).message).toMatch(/新建生成|新意图|new intent/i)
    }
  })

  it('no idempotencyKey → bypasses both ledgers (backward compat for headless/old paths)', async () => {
    initGlobalIdempotencyStore(tmpDir)
    let calls = 0
    // 无 key 的 payload
    const res = await runTaskWithIdempotency(
      { vendor: 'kie', request: { kind: 'text_to_video' } },
      async () => {
        calls++
        return 'ran'
      },
    )
    expect(res).toBe('ran')
    expect(calls).toBe(1)
  })

  it('in-process same-key still dedupes (existing behavior unchanged by Slice 6)', async () => {
    initGlobalIdempotencyStore(tmpDir)
    let calls = 0
    const fn = async () => {
      calls++
      return { id: 't1', assets: [] }
    }
    const p1 = runTaskWithIdempotency(payloadWith('key-inproc'), fn)
    const p2 = runTaskWithIdempotency(payloadWith('key-inproc'), fn)
    await Promise.all([p1, p2])
    expect(calls).toBe(1) // 进程内幂等不变
  })

  it('query results advance the persisted task status to a terminal state', async () => {
    initGlobalIdempotencyStore(tmpDir)
    await runTaskWithIdempotency(payloadWith('key-query-status'), async () => ({
      id: 'task-query-status',
      status: 'queued' as const,
      assets: [],
    }))
    recordPersistedTaskResult({ id: 'task-query-status', status: 'running' })
    expect(getGlobalStoreOrFail().get('key-query-status')?.status).toBe('running')

    recordPersistedTaskResult({ id: 'task-query-status', status: 'succeeded' })
    const terminal = getGlobalStoreOrFail().get('key-query-status')
    expect(terminal?.status).toBe('succeeded')
    expect(terminal?.settledAt).toEqual(expect.any(Number))
  })
})

// 测试辅助：断言全局 store 存在
function getGlobalStoreOrFail(): IdempotencyStore {
  const s = getGlobalIdempotencyStore()
  if (!s) throw new Error('global store not initialized')
  return s
}
