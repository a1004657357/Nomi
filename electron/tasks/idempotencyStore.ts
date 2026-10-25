/**
 * Slice 6 — 提交幂等的磁盘持久化（§20 tasks/ledger.jsonl）。
 *
 * 对应 Gate 1 实施计划 Slice 6 + 目标架构 §20 / §10.2 / §21.5 SLO「重启后 10s 内恢复
 * submitted/queued/running/unknown 任务，不创建新任务」。
 *
 * 背景（Gate 0 §1.5 证据）：既有 `submissionLedger.ts` 是进程内 `Map`（`:69`），重启即空；
 * 同 key 重启后再提交会再执行 fn = 潜在二次扣费。本模块给它加一层**磁盘镜像**。
 *
 * 钱安全铁律（§10.2 不变量 1-3）：
 * - 同一 idempotencyKey 的真实 create 在进程内已 at-most-once（既有 submissionLedger 守）。
 * - 跨重启：本模块记录 settled 条目；重启后同 key 再来 → **绝不重新执行 fn**，而是：
 *   · 若记录里有 providerTaskId → 返回「走查询恢复」信号（调用方进 query-only 路径，§10.2 unknown 不重发）；
 *   · 若无 providerTaskId（create 结果未知）→ 抛 SubmissionReplayError，强制人工/上层新建生成意图（新 key）。
 * - 本模块**绝不**主动触发 create。它只是「这个 key 已经被受理过」的持久备忘录。
 *
 * 磁盘 IO 容错（计划风险表）：写失败不阻塞提交（best-effort 镜像），仅降级回纯进程内台账。
 */
import * as fs from 'fs'
import * as path from 'path'
import type { TaskStatus } from '../shared/taskStatus'

/** 持久化的单条记录（append-only jsonl）。 */
export type IdempotencyRecord = {
  idempotencyKey: string
  /** provider 返回的任务 id（create 成功后才有；用于重启后查询恢复）。 */
  providerTaskId?: string
  vendorKey?: string
  modelKey?: string
  taskKind?: string
  projectId?: string
  nodeId?: string
  /** Provider 任务状态。submitting/unknown 都禁止自动重新 create。 */
  status: TaskStatus | 'submitting' | 'submitted'
  /** 受理时间（ms）。 */
  createdAt: number
  /** settle 时间（ms）；in-flight 时为 null。 */
  settledAt?: number
}

const DEFAULT_PERSIST_TTL_MS = 24 * 60 * 60 * 1000 // 24h：远长于进程内 5min，覆盖重启窗口

/**
 * 重启后同 key 再来时抛此错——上层应把它映射成「新建生成意图（新 idempotencyKey）」，
 * 或（记录有 providerTaskId）走 query-only 恢复（recoverNodeResult），**绝不**自动重新 create。
 */
export class SubmissionReplayError extends Error {
  readonly record: IdempotencyRecord
  constructor(record: IdempotencyRecord, message: string) {
    super(message)
    this.name = 'SubmissionReplayError'
    this.record = record
  }
}

/**
 * 持久幂等台账。每个项目（或全局）一个实例，append-only 写 `ledger.jsonl`。
 * 读时按 idempotencyKey 索引（重启后 load 一次）。
 */
export class IdempotencyStore {
  private readonly ledgerPath: string
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly byKey = new Map<string, IdempotencyRecord>()
  private loaded = false

  constructor(opts: { ledgerDir: string; ttlMs?: number; now?: () => number }) {
    this.ledgerPath = path.join(opts.ledgerDir, 'tasks', 'ledger.jsonl')
    this.ttlMs = opts.ttlMs ?? DEFAULT_PERSIST_TTL_MS
    this.now = opts.now ?? Date.now
  }

  /** 懒加载：首次访问时从磁盘 replay（best-effort，读失败=空台账，不抛）。 */
  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = fs.readFileSync(this.ledgerPath, 'utf8')
      const now = this.now()
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const rec = JSON.parse(trimmed) as IdempotencyRecord
          if (!rec.idempotencyKey || typeof rec.createdAt !== 'number') continue
          // TTL 过滤：超 24h 的不回放（允许同 key 重新执行）
          if (rec.settledAt != null && now - rec.settledAt > this.ttlMs) continue
          // 保留最新一条（jsonl 可能同 key 多条——后写覆盖）
          this.byKey.set(rec.idempotencyKey, rec)
        } catch {
          // 单行损坏跳过，不影响其他记录
        }
      }
    } catch {
      // 文件不存在/不可读 = 空台账，正常首次启动
    }
  }

  /** 该 key 在持久台账里是否有「未过期的受理记录」。 */
  has(key: string): boolean {
    this.ensureLoaded()
    return this.byKey.has(key)
  }

  /**
   * 取该 key 的持久记录（用于重启后判断是否要走查询恢复）。
   * 无记录或已过期返回 undefined。
   */
  get(key: string): IdempotencyRecord | undefined {
    this.ensureLoaded()
    return this.byKey.get(key)
  }

  /** 按 Provider task id 找受理记录，供免费 query/cancel 回写状态。 */
  findByProviderTaskId(providerTaskId: string): IdempotencyRecord | undefined {
    this.ensureLoaded()
    const id = providerTaskId.trim()
    if (!id) return undefined
    for (const record of this.byKey.values()) {
      if (record.providerTaskId === id) return record
    }
    return undefined
  }

  /** 更新已受理任务状态；找不到 task id 时不创建猜测记录。 */
  updateByProviderTaskId(
    providerTaskId: string,
    status: IdempotencyRecord['status'],
    settledAt?: number,
  ): IdempotencyRecord | undefined {
    const current = this.findByProviderTaskId(providerTaskId)
    if (!current) return undefined
    const next: IdempotencyRecord = {
      ...current,
      status,
      ...(settledAt == null ? { settledAt: undefined } : { settledAt }),
    }
    this.record(next)
    return next
  }

  /**
   * 记录一条 settled 条目（append-only 写盘，best-effort）。
   * 同 key 多次写：后写覆盖内存索引，磁盘追加（读时取最后一条）。
   *
   * 写盘同步执行（appendFileSync 单行，开销极小）——保证跨重启读时序正确：
   * 若异步写，调用方 await runTask 解析后再读磁盘可能读到空（见 Slice 6 测试「重启 fixture」）。
   * 写失败静默降级（内存索引仍在 → 本进程内幂等仍成立）。
   */
  record(entry: IdempotencyRecord): void {
    this.ensureLoaded()
    this.byKey.set(entry.idempotencyKey, entry)
    try {
      fs.mkdirSync(path.dirname(this.ledgerPath), { recursive: true })
      fs.appendFileSync(this.ledgerPath, JSON.stringify(entry) + '\n', 'utf8')
    } catch {
      // best-effort：写盘失败静默（内存索引仍在，本进程内幂等仍成立）
    }
  }

  /** 测试用：清空内存索引（不动磁盘）。 */
  clearMemoryForTests(): void {
    this.byKey.clear()
    this.loaded = true
  }

  /** 测试用：直接注入一条记录（不走磁盘）。 */
  seedForTests(record: IdempotencyRecord): void {
    this.loaded = true
    this.byKey.set(record.idempotencyKey, record)
  }
}

/**
 * 单例：全局持久台账（位于 settingsRoot/tasks/ledger.jsonl）。
 * 由 main.ts 启动时初始化（见 Slice 6 集成点）。
 */
let globalStore: IdempotencyStore | null = null

export function initGlobalIdempotencyStore(settingsRoot: string): IdempotencyStore {
  globalStore = new IdempotencyStore({ ledgerDir: settingsRoot })
  return globalStore
}

export function getGlobalIdempotencyStore(): IdempotencyStore | null {
  return globalStore
}

/** 测试用：重置单例。 */
export function resetGlobalIdempotencyStoreForTests(): void {
  globalStore = null
}
