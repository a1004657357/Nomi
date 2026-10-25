import { desktopT } from "./desktopStrings";
import { TASK_STATUSES } from './shared/taskStatus';
// 进程内提交合并器：把同一幂等键的并发调用 memo 化，避免当前进程重复执行提交内核。
//
// 这不是跨重启的 at-most-once 保证。ProductionRun 的持久化 outbox 才负责提交意图、预算负债、
// provider 回执与 submission_unknown；本模块只缩小单进程并发窗口。
//   · 进行中 → 等同一个 promise（拿到同一个 taskId，渲染层轮询同一个真任务）
//   · 已成功 → 返回同一个结果（连「成功但回执丢了」也找回真任务，无需供应商支持）
//   · 已失败 → 重放同一个 rejection → 绝不二次下单（控制器再重试也是同一个失败）
// 无键则完全不介入（向后兼容 headless/测试路径）——这由调用方判断，本模块只处理「有键」。
//
// Gate 1 Slice 6（§20）：跨重启持久化层在 `./tasks/idempotencyStore.ts`。
// 本模块首次成功后镜像 outcome 到持久台账；重启后同 key 再来时绝不重新执行 run。

import { getGlobalIdempotencyStore, SubmissionReplayError } from './tasks/idempotencyStore'

type LedgerEntry<T> = {
  readonly promise: Promise<T>;
  /** settle 后到点清理的绝对时间戳（ms）；未 settle 前为 null（进行中不过期）。 */
  expiresAt: number | null;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000; // settle 后保留 5min：覆盖控制器 ~2s 重试 burst，再清理 bound 内存。
const DEFAULT_LEDGER_MAX_ENTRIES = 1000;

export type DedupeOptions = {
  /** settle 后保留多久（ms）。期间同键重放，过后同键可重新执行。 */
  ttlMs?: number;
  /** 注入「现在」便于测试 TTL；默认 Date.now。 */
  now?: () => number;
};

export type RunTaskIdempotencyOptions<T> = DedupeOptions & {
  /** 重启后已有 providerTaskId 时只做免费查询，绝不再次调用 create。 */
  recoverPersisted?: (record: import('./tasks/idempotencyStore').IdempotencyRecord) => Promise<T>;
};

/**
 * 按 `key` memo 化提交内核 `fn`。同一个键在「进行中 + settle 后 ttl 内」只执行 fn 一次，
 * 其余同键调用重放同一个 promise（成功/失败都重放）。返回 fn 的结果 promise。
 *
 * 纯模块、无单例：调用方持有一个 ledger Map 注入进来（runtime 持一个进程级 Map）。
 */
export function dedupeSubmission<T>(
  ledger: Map<string, LedgerEntry<T>>,
  key: string,
  fn: () => Promise<T>,
  options: DedupeOptions = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  const existing = ledger.get(key);
  if (existing) {
    // 进行中(expiresAt=null) → 重放；已 settle 且未过期 → 重放；已过期 → 落到下面重新执行。
    if (existing.expiresAt == null || existing.expiresAt > now()) {
      return existing.promise;
    }
    ledger.delete(key);
  }

  // 首次（或过期后重跑）：执行 fn，登记进行中（不过期），settle 后打 TTL 戳。
  const promise = fn();
  const entry: LedgerEntry<T> = { promise, expiresAt: null };
  ledger.set(key, entry);

  const stamp = () => {
    // 仍是同一个 entry 才打戳（防过期重跑后被旧 settle 误伤）。
    if (ledger.get(key) === entry) entry.expiresAt = now() + ttlMs;
  };
  promise.then(stamp, stamp);

  return promise;
}

// 进程级默认台账 + 薄 helper：在 IPC 边界（main.ts 的 nomi:tasks:run）包住提交，
// 避免把 Map 与包装逻辑塞进巨壳 runtime.ts。同键提交内核 at-most-once。
const defaultLedger = new Map<string, LedgerEntry<unknown>>();

function readIdempotencyKey(payload: unknown): string {
  const key = (payload as { request?: { extras?: { idempotencyKey?: unknown } } })?.request?.extras?.idempotencyKey;
  return typeof key === "string" ? key.trim() : "";
}

/**
 * 在提交入口包一层幂等：payload.request.extras.idempotencyKey 存在 → 同键的 `run` 最多执行一次
 * （重试重放第一次的 promise，绝不二次下单）；无键 → 原样执行（向后兼容 headless/旧路径）。
 *
 * Gate 1 Slice 6（§20）：跨重启持久化——若 `getGlobalIdempotencyStore()` 返回的持久台账里
 * 已有该 key（上一会话受理过），**绝不重新执行 run**（防二次扣费）：
 *   · 记录有 providerTaskId → 抛 SubmissionReplayError，上层映射为 query-only 恢复（§10.2 unknown 不重发）；
 *   · 记录无 providerTaskId（create 结果未知）→ 同样抛 SubmissionReplayError，强制新建生成意图（新 key）。
 * 本进程内首次成功后，会把 outcome 镜像到持久台账（best-effort）。
 */
export function runTaskWithIdempotency<T>(
  payload: unknown,
  run: () => Promise<T>,
  options: RunTaskIdempotencyOptions<T> = {},
): Promise<T> {
  const key = readIdempotencyKey(payload);
  if (!key) return run();
  const now = options.now ?? Date.now;

  pruneExpiredSubmissions(defaultLedger, now);
  if (!defaultLedger.has(key) && defaultLedger.size >= DEFAULT_LEDGER_MAX_ENTRIES) {
    return Promise.reject(new Error(desktopT("custom.submissionLedger.text1")));
  }

  // 持久检查和 submitting 落盘必须放在 dedupeSubmission 的首次 fn 内：这样同进程第二个
  // 并发请求先命中内存 promise，不会被刚写入的持久记录误判为“上一会话重放”。
  return dedupeSubmission(
    defaultLedger as Map<string, LedgerEntry<T>>,
    key,
    async () => {
      const persistStore = getGlobalIdempotencyStore();
      const persisted = persistStore?.get(key);
      if (persisted) {
        if (persisted.providerTaskId && options.recoverPersisted) {
          const recovered = await options.recoverPersisted(persisted);
          recordPersistedTaskResult(recovered);
          return recovered;
        }
        throw new SubmissionReplayError(
          persisted,
          persisted.providerTaskId
            ? `此生成已在上一会话受理（任务 ${persisted.providerTaskId}），请用查询恢复而非重新提交`
            : '此生成在上一会话已提交但结果未知，请新建生成（新意图）或人工核对，系统不会自动重发',
        );
      }

      if (persistStore) recordSubmissionStarted(persistStore, key, payload, now());
      try {
        const value = await run();
        if (persistStore) recordOutcomeToPersistStore(persistStore, key, payload, value, now());
        return value;
      } catch (error) {
        // 无法可靠区分“请求未发出”与“已发出但回执丢失”，故保守落 unknown，禁止自动重发。
        if (persistStore) recordSubmissionUnknown(persistStore, key, payload, now());
        throw error;
      }
    },
    options,
  );
}

/** 从 runTask 结果里尽量抠出 providerTaskId（用于重启后查询恢复）。 */
function extractProviderTaskId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as { id?: unknown; providerMeta?: { task_id?: unknown; query_id?: unknown } }
  if (typeof v.id === 'string' && v.id) return v.id
  if (v.providerMeta) {
    if (typeof v.providerMeta.task_id === 'string') return v.providerMeta.task_id
    if (typeof v.providerMeta.query_id === 'string') return v.providerMeta.query_id
  }
  return undefined
}

function extractVendorKey(payload: unknown): string | undefined {
  const v = (payload as { vendor?: unknown })?.vendor
  return typeof v === 'string' ? v : undefined
}

function extractRequestContext(payload: unknown): {
  modelKey?: string;
  taskKind?: string;
  projectId?: string;
  nodeId?: string;
} {
  const request = (payload as { request?: { kind?: unknown; extras?: Record<string, unknown> } })?.request;
  const extras = request?.extras || {};
  const pick = (...values: unknown[]): string | undefined => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };
  const modelKey = pick(extras.modelKey, extras.modelAlias);
  const taskKind = pick(request?.kind);
  const projectId = pick(extras.projectId);
  const nodeId = pick(extras.nodeId);
  return {
    ...(modelKey ? { modelKey } : {}),
    ...(taskKind ? { taskKind } : {}),
    ...(projectId ? { projectId } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

const PERSISTABLE_TASK_STATUSES = new Set<string>([
  'submitted',
  ...TASK_STATUSES,
]);

function extractTaskStatus(value: unknown): import('./tasks/idempotencyStore').IdempotencyRecord['status'] | undefined {
  const status = (value as { status?: unknown })?.status;
  return typeof status === 'string' && PERSISTABLE_TASK_STATUSES.has(status)
    ? status as import('./tasks/idempotencyStore').IdempotencyRecord['status']
    : undefined;
}

function recordSubmissionStarted(
  store: NonNullable<ReturnType<typeof getGlobalIdempotencyStore>>,
  key: string,
  payload: unknown,
  createdAt: number,
): void {
  const context = extractRequestContext(payload);
  store.record({
    idempotencyKey: key,
    vendorKey: extractVendorKey(payload),
    ...context,
    status: 'submitting',
    createdAt,
  });
}

function recordSubmissionUnknown(
  store: NonNullable<ReturnType<typeof getGlobalIdempotencyStore>>,
  key: string,
  payload: unknown,
  timestamp: number,
): void {
  const current = store.get(key);
  // A user cancellation can race with the rejected create promise. Once the IPC
  // cancellation boundary has persisted cancelled, the later rejection must not
  // downgrade it to unknown and make the UI offer an unsafe recovery path.
  if (current?.status === 'cancelled') return;
  store.record({
    idempotencyKey: key,
    vendorKey: current?.vendorKey ?? extractVendorKey(payload),
    ...extractRequestContext(payload),
    ...current,
    status: 'unknown',
    createdAt: current?.createdAt ?? timestamp,
    settledAt: undefined,
  });
}

function recordOutcomeToPersistStore(
  store: NonNullable<ReturnType<typeof getGlobalIdempotencyStore>>,
  key: string,
  payload: unknown,
  value: unknown,
  timestamp: number,
): void {
  try {
    const current = store.get(key);
    const status = extractTaskStatus(value) ?? 'succeeded';
    const terminal = status === 'succeeded' || status === 'failed' || status === 'cancelled';
    store.record({
      ...current,
      idempotencyKey: key,
      providerTaskId: extractProviderTaskId(value) ?? current?.providerTaskId,
      vendorKey: current?.vendorKey ?? extractVendorKey(payload),
      ...extractRequestContext(payload),
      status,
      createdAt: current?.createdAt ?? timestamp,
      ...(terminal ? { settledAt: timestamp } : { settledAt: undefined }),
    })
  } catch {
    // best-effort：镜像失败不影响主流程
  }
}

/** 免费 query/cancel 返回后同步持久任务状态；没有对应 create 记录时保持 no-op。 */
export function recordPersistedTaskResult(value: unknown): void {
  const store = getGlobalIdempotencyStore();
  const providerTaskId = extractProviderTaskId(value);
  const status = extractTaskStatus(value);
  if (!store || !providerTaskId || !status) return;
  const terminal = status === 'succeeded' || status === 'failed' || status === 'cancelled';
  try {
    store.updateByProviderTaskId(providerTaskId, status, terminal ? Date.now() : undefined);
  } catch {
    // best-effort：状态镜像失败不能让免费查询本身失败
  }
}

/** Persist a successful cancellation by intent key and/or Provider task id. */
export function recordPersistedTaskCancellation(input: {
  idempotencyKey?: string;
  providerTaskId?: string;
}): void {
  const store = getGlobalIdempotencyStore();
  if (!store) return;
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  const providerTaskId = String(input.providerTaskId || '').trim();
  try {
    const record = (idempotencyKey ? store.get(idempotencyKey) : undefined)
      ?? (providerTaskId ? store.findByProviderTaskId(providerTaskId) : undefined);
    if (!record) return;
    store.record({
      ...record,
      status: 'cancelled',
      settledAt: Date.now(),
    });
  } catch {
    // best-effort: cancellation itself must not fail because ledger mirroring did.
  }
}

/** 清掉所有已过期条目（可选的主动 GC；不调也会在同键再次访问时惰性清理）。 */
export function pruneExpiredSubmissions(ledger: Map<string, LedgerEntry<unknown>>, now: () => number = Date.now): void {
  const t = now();
  for (const [key, entry] of ledger) {
    if (entry.expiresAt != null && entry.expiresAt <= t) ledger.delete(key);
  }
}

export function resetDefaultSubmissionLedgerForTests(): void {
  defaultLedger.clear();
}

export function defaultSubmissionLedgerSizeForTests(): number {
  return defaultLedger.size;
}
