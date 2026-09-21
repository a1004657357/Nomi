import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { getDesktopBridge } from '../../../desktop/bridge'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { toast } from '../../../ui/toast'
import { cancelWorkbenchTask, mintSpendGrant } from '../../api/taskApi'
import { confirmGenerationSpend, describeGenerationCost, type GenerationCostKind } from '../spend/spendConfirm'
import { generationNodeExecutor, type GenerationNodeExecutor } from './generationNodeExecutor'
import { narrateProgress } from '../../observability/narrate'
import { LocalTaskCancelledError, clearTaskCancel, isTaskCancelRequested, isLocalTaskCancelledError } from './localTaskControl'
import { useComfyuiPreviewStore } from '../store/comfyuiPreviewStore'
import { isRecoverableTimeoutError } from './recoverableTimeout'
import { recordModelFailure, recordModelSuccess } from './modelHealthMemory'
import {
  beginSingletonBatch,
  isEntryCancelled,
  useGenerationQueueStore,
  waitForQueueGate,
} from './generationQueueStore'
// 错误分类(classifyGenerationError)已抽到 observability/classifyError(人话叶子层,生成域+对话域共用);
// 这里 re-export 保持 NodeErrorReport / classifyGenerationError.test 等既有 import 不破。
export { classifyGenerationError, type GenerationErrorReport } from '../../observability/classifyError'
import type { DependencyWavePlan } from './dependencyWaves'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { archetypeForNode, resolveModeForConnectedReferences } from '../agent/referenceEdgeCapability'
import { applyArchetypeModeSwitch } from '../nodes/controls/archetypeMeta'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { generationBatchConcurrency } from './generationConcurrency'
import {
  generationProviderKey,
  generationProviderLimit,
  runWithGenerationProviderSlot,
} from './generationProviderScheduler'
import i18n from '../../../i18n'
import { AssetUploadConsentCancelledError, hasLocalAssetReference } from './assetUploadConsent'
import { resolveHostingDisclosure, type AssetUploadConsentDecision } from './generationRunConsent'
import { canRunGenerationNode } from './generationNodeEligibility'
export { resolveAutonomousUploadConsent, type AssetUploadConsentDecision } from './generationRunConsent'
export { canRunGenerationNode, unmetReferenceDependencyForNode } from './generationNodeEligibility'

/** 节点 kind → 付费预估用的产物口径，喂给 describeGenerationCost 报对名词与时长。 */
function spendCostKind(kind: GenerationNodeKind): Exclude<GenerationCostKind, 'mixed'> {
  const exec = getGenerationNodeExecutionKind(kind)
  return exec === 'text' || exec === 'video' || exec === 'audio' ? exec : 'image'
}

/** 一批节点的产物口径：全同则取该类，混合则 'mixed'，喂给 describeGenerationCost 报对名词。 */
export function spendCostKindForNodes(ids: string[]): GenerationCostKind {
  const nodes = useGenerationCanvasStore.getState().nodes
  const kinds = new Set(
    ids
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is GenerationCanvasNode => Boolean(n))
      .map((n) => spendCostKind(n.kind)),
  )
  if (kinds.size === 1) return [...kinds][0]
  return kinds.size === 0 ? 'image' : 'mixed'
}

export type RunGenerationNodeOptions = {
  executor?: GenerationNodeExecutor
  retry?: {
    maxAttempts?: number
    baseDelayMs?: number
  }
  /** 付费守卫令牌：真人确认后铸的 grantId，透传到 executor → request.extras 供主进程核验。 */
  grantId?: string
  /** Optional external cancellation signal. */
  signal?: AbortSignal
  /** One-shot correction appended to the provider prompt for a bounded QA retry. */
  promptSuffix?: string
  /** 队列批次 id（任务中心的调度真相源，见 generationQueueStore）。不传 = 单发，内部自建 1 节点批次。 */
  batchId?: string
  /**
   * 上游确认面已解析好的托管同意。**必填**，理由见 AssetUploadConsentDecision。
   * runner 不问用户——它只执行已经做出的决定。
   */
  assetUploadConsent: AssetUploadConsentDecision
}

type RetryableGenerationError = Error & {
  status?: number
  code?: unknown
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 350
const activeGenerationRuns = new Map<string, { controller: AbortController; runId: string; taskId?: string }>()
const activeGenerationBatchControllers = new Set<AbortController>()

type GenerationBatchCancellation = {
  controller: AbortController
  dispose: () => void
}

function createGenerationBatchCancellation(externalSignal?: AbortSignal): GenerationBatchCancellation {
  const controller = new AbortController()
  const abortFromExternal = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  activeGenerationBatchControllers.add(controller)
  return {
    controller,
    dispose: () => {
      externalSignal?.removeEventListener('abort', abortFromExternal)
      activeGenerationBatchControllers.delete(controller)
    },
  }
}

function generationAbortError(): DOMException {
  return new DOMException('生成已取消', 'AbortError')
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}

export function cancelGenerationNode(nodeId: string): boolean {
  const id = String(nodeId || '').trim()
  const active = activeGenerationRuns.get(id)
  if (!active) return false
  active.controller.abort()
  useGenerationCanvasStore.getState().setNodeStatus(id, 'idle')
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
  void cancelWorkbenchTask({
    runId: active.runId,
    ...(active.taskId ? { taskId: active.taskId } : {}),
    nodeId: id,
    ...(node ? { vendor: generationProviderKey(node) } : {}),
  }).catch(() => {})
  return true
}

export function cancelGenerationNodes(nodeIds: readonly string[]): number {
  let cancelled = 0
  for (const nodeId of nodeIds) {
    if (cancelGenerationNode(nodeId)) cancelled += 1
  }
  return cancelled
}

/** Stop every active batch and node. Batch abort prevents queued work from starting. */
export function cancelAllGenerationRuns(): number {
  for (const controller of activeGenerationBatchControllers) controller.abort()
  return cancelGenerationNodes([...activeGenerationRuns.keys()])
}

function isRetryableGenerationError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (!(error instanceof Error)) return false
  const candidate = error as RetryableGenerationError
  // A Codex image may already have reached imagegen before the local watchdog
  // fires. Never turn that timeout into another paid submission implicitly.
  if (candidate.message.includes('Codex Img2 长时间无进展') || candidate.message.includes('Codex Img2 生成超时'))
    return false
  if (typeof candidate.status === 'number') {
    return (
      candidate.status === 408 ||
      candidate.status === 409 ||
      candidate.status === 425 ||
      candidate.status === 429 ||
      candidate.status >= 500
    )
  }
  const message = candidate.message.trim().toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('socket') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('rate limit')
  )
}

function normalizeRetryAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS
  return Math.max(1, Math.min(5, Math.floor(value)))
}

function normalizeBaseDelayMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BASE_DELAY_MS
  return Math.max(0, Math.min(3_000, Math.floor(value)))
}

async function waitForRetry(attempt: number, baseDelayMs: number, signal?: AbortSignal): Promise<void> {
  if (baseDelayMs <= 0) return
  if (signal?.aborted) throw generationAbortError()
  await new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      },
      baseDelayMs * 2 ** Math.max(0, attempt - 1),
    )
    const onAbort = () => {
      globalThis.clearTimeout(timer)
      reject(generationAbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 提交前对账「生成方式 × 活边参考」（2026-07-28 群反馈根治）：当前模式一条参考边都收不下、档案里
 * 有能收的模式 → 切过去（与建边 autoPromoteTargetModeForEdge 同一套语义，ModeBar 同步翻转）。
 * 建边时的 auto-promote 只覆盖「建边那一刻」，换模型（archetype 失配落回默认 t2i）、存量边都够不到；
 * 停在 t2i 的节点会在投影层（buildArchetypeInputParams 空槽互斥）把挂着的参考静默丢掉、付费发出
 * 纯文生（「男的角色图生成出女的」根因）。挂在唯一提交咽喉 runGenerationNode 入口，整类不再复发。幂等。
 */
export function reconcileNodeModeWithConnectedReferences(nodeId: string): void {
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  const nextModeId = resolveModeForConnectedReferences(node, state.nodes, state.edges)
  if (!nextModeId) return
  const archetype = archetypeForNode(node)
  if (!archetype) return
  state.updateNode(nodeId, {
    meta: applyArchetypeModeSwitch((node.meta || {}) as Record<string, unknown>, archetype, nextModeId),
  })
}

/** 结算时读节点当前绑定的模型键（健康记忆的记账主体；meta 无 modelKey 的异常路径记空=跳过）。 */
function currentNodeModelKey(nodeId: string): unknown {
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  return (node?.meta as Record<string, unknown> | undefined)?.modelKey
}

// options 没有默认值：`= {}` 正是让调用点能省略托管同意的那个逃生口（F16b 根因）。
// 去掉它之后，「谁问的用户」在编译期就必须有答案。
export async function runGenerationNode(
  nodeId: string,
  options: RunGenerationNodeOptions,
): Promise<GenerationNodeResult> {
  const id = String(nodeId || '').trim()
  if (!id) throw new Error('nodeId is required')

  reconcileNodeModeWithConnectedReferences(id)
  const initialState = useGenerationCanvasStore.getState()
  const initialNode = initialState.nodes.find((node) => node.id === id)
  if (!initialNode) throw new Error('node not found')
  if (!canRunGenerationNode(initialNode, { nodes: initialState.nodes, edges: initialState.edges })) {
    throw new Error(
      initialNode.kind === 'video'
        ? '视频节点缺少上游真实图片或视频资产 URL。请先生成或选择首帧/参考图后再生成视频。'
        : `暂不支持「${initialNode.kind}」类型节点的生成`,
    )
  }
  if (activeGenerationRuns.has(id)) throw new Error('该节点已经在生成队列中')

  const controller = new AbortController()
  const abortFromExternal = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', abortFromExternal, { once: true })

  // 托管同意在**上游**就已经问完了（花钱确认卡里的披露块，或自主路径的
  // resolveAutonomousUploadConsent）。这一层不再问、也不再有能问的东西——它只把已决的答案
  // 往下透传给 executor。F16b 之前这里会自己弹第二张卡，那张卡现已删除，见 assetUploadConsent.ts。
  const resolvedReferences = resolveGenerationReferences(initialNode, { nodes: initialState.nodes, edges: initialState.edges })
  const hasLocalReference = hasLocalAssetReference({
    ...initialNode,
    references: [
      ...(initialNode.references || []),
      ...resolvedReferences.referenceImages,
      ...resolvedReferences.referenceVideos,
      ...resolvedReferences.referenceAudios,
      ...(resolvedReferences.firstFrameUrl ? [resolvedReferences.firstFrameUrl] : []),
      ...(resolvedReferences.lastFrameUrl ? [resolvedReferences.lastFrameUrl] : []),
      ...(resolvedReferences.relayFromVideoUrl ? [resolvedReferences.relayFromVideoUrl] : []),
    ],
  })

  // 队列登记：批量路径由 runGenerationNodesByPlan 预先整批登记（含后续波次），单发路径自建 1 节点批次。
  // markRunning 只把 queued 翻成 running（幂等），所以两条路都能安全调。
  const ownsBatch = !options.batchId
  const batchId = options.batchId ?? beginSingletonBatch(id)
  useGenerationQueueStore.getState().markRunning(batchId, id)

  const run = initialState.appendNodeRun(id, {
    status: 'queued',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  })
  const activeRun = { controller, runId: run.id }
  activeGenerationRuns.set(id, activeRun)
  useGenerationCanvasStore.getState().setNodeProgress(id, {
    runId: run.id,
    phase: 'queued',
    message: narrateProgress('queued'),
    percent: 0,
  })

  try {
    const executor = options.executor ?? generationNodeExecutor
    const maxAttempts = normalizeRetryAttempts(options.retry?.maxAttempts)
    const baseDelayMs = normalizeBaseDelayMs(options.retry?.baseDelayMs)
    let result: GenerationNodeResult | null = null
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const state = useGenerationCanvasStore.getState()
      const node = state.nodes.find((candidate) => candidate.id === id) || initialNode
      try {
        result = await runWithGenerationProviderSlot(
          node,
          () =>
            executor(node, {
              nodes: state.nodes,
              edges: state.edges,
              ...(options.grantId ? { grantId: options.grantId } : {}),
              // 提交幂等键 = 本次 run.id：重试循环内每次 attempt 复用同一个 run.id，
              // electron 侧台账据此认作「同一次意图提交」→ 重试绝不二次下单。新生成 = 新 run.id。
              idempotencyKey: run.id,
              ...(options.promptSuffix ? { promptSuffix: options.promptSuffix } : {}),
              ...(hasLocalReference && options.assetUploadConsent === 'allow'
                ? { anonymousAssetHostingConsent: 'allow' as const } : {}),
              signal: controller.signal,
              // S2:catalog 任务各阶段回报 → 节点进度(人话已由 narrate 翻好)。
              onProgress: (progress) => {
                useGenerationCanvasStore.getState().setNodeProgress(id, {
                  runId: run.id,
                  phase: progress.phase,
                  message: progress.message,
                  ...(progress.taskId ? { taskId: progress.taskId } : {}),
                })
                const active = activeGenerationRuns.get(id)
                if (active === activeRun && progress.taskId) active.taskId = progress.taskId
              },
              // 旧项目若把图片模型元数据串到视频节点，catalog 会从最近一次同类型成功结果恢复。
              // 在请求提交前写回 store，避免本次能跑、下次重启又回到错误模型。
              onResolvedNode: async (resolvedNode) => {
                useGenerationCanvasStore.getState().updateNode(id, { meta: resolvedNode.meta })
                await persistActiveWorkbenchProjectNow().catch(() => {})
              },
            }),
          {
            signal: controller.signal,
            onQueueWait: ({ providerKey, queueAhead, activeForProvider, providerLimit }) => {
              useGenerationCanvasStore.getState().setNodeProgress(id, {
                runId: run.id,
                phase: 'queued',
                message: narrateProgress('queued', {
                  providerKey,
                  queueAhead,
                  activeForProvider,
                  providerLimit,
                }),
              })
            },
            onRateLimitWait: ({ waitMs }) => {
              useGenerationCanvasStore.getState().setNodeProgress(id, {
                runId: run.id,
                phase: 'rate-limited',
                message: narrateProgress('rate-limited', { waitMs }),
              })
            },
          },
        )
        break
      } catch (error: unknown) {
        if (attempt >= maxAttempts || !isRetryableGenerationError(error)) {
          throw error
        }
        useGenerationCanvasStore.getState().setNodeProgress(id, {
          runId: run.id,
          phase: 'retrying',
          // 文案走 narrate 注册表(S2 纪律:展示文案不许散落字面量)。
          message: narrateProgress('retrying', { attempt: attempt + 1, maxAttempts }),
        })
        await waitForRetry(attempt, baseDelayMs, controller.signal)
      }
    }
    if (!result) throw new Error('生成失败')
    useGenerationCanvasStore.getState().addNodeResult(id, result)
    // 自动另存（集中设置页开启时）：新生成的图/视频静默复制一份到用户目录。fire-and-forget——不 await
    // （不拖慢生成收尾）、失败不冒泡（best-effort 全在主进程侧，关着/没设目录/失败都静默）。只对新生成，
    // 找回(recoverTaskActions)不触发、避免重复另存。
    if ((result.type === 'image' || result.type === 'video') && (result.url || '').trim()) {
      const title = (useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.title || '').trim()
      void getDesktopBridge()
        ?.assets?.autoSave?.({ url: result.url as string, suggestedName: title || undefined })
        .catch(() => undefined)
    }
    recordModelSuccess(currentNodeModelKey(id))
    useGenerationQueueStore.getState().markSettled(batchId, id, 'success')
    await persistActiveWorkbenchProjectNow().catch(() => {})
    return result
  } catch (error: unknown) {
    if (controller.signal.aborted || isAbortError(error)) {
      useGenerationCanvasStore.getState().setNodeStatus(id, 'idle')
      useGenerationQueueStore.getState().markSettled(batchId, id, 'cancelled', { countsTowardBrake: false })
      throw isAbortError(error) ? error : new DOMException('生成已取消', 'AbortError')
    }
    // P 轨遮罩取消：用户主动停的，不进红色错误桶也不算模型失败——回 idle 静静结束。
    // 两条路都要兜：① 轮询 tick 主动抛 LocalTaskCancelledError；② 竞态——点取消瞬间轮询恰好
    // 把 /history 的 interrupted 终态拉回来当失败抛（走查实锤），靠 cancelRequested 登记识别。
    if (isLocalTaskCancelledError(error) || isTaskCancelRequested(id)) {
      useGenerationCanvasStore.getState().setNodeStatus(id, 'idle')
      // 用户主动停的：不进刹车计数（模型没挂，是人喊停的）。
      useGenerationQueueStore.getState().markSettled(batchId, id, 'cancelled', { countsTowardBrake: false })
      throw isLocalTaskCancelledError(error) ? error : new LocalTaskCancelledError()
    }
    if (error instanceof AssetUploadConsentCancelledError) {
      useGenerationCanvasStore.getState().setNodeStatus(id, 'idle')
      useGenerationQueueStore.getState().markSettled(batchId, id, 'cancelled', { countsTowardBrake: false })
      throw error
    }
    // 可找回超时：上游可能仍在跑/已出片 → 落 recoverable（不进红色错误桶），给「重新拉取」入口。
    // taskId 已在 run 记录里持久化，recover 动作从节点重建续查（重启后也能拉）。
    // 健康记账也不算失败——上游没有明确判死。
    if (isRecoverableTimeoutError(error)) {
      useGenerationCanvasStore.getState().setNodeStatus(id, 'recoverable', error.message)
      // 上游没有明确判死（可能仍在跑/已出片）→ 健康记账不算失败，刹车也不该算。
      useGenerationQueueStore.getState().markSettled(batchId, id, 'error', {
        error: error.message,
        countsTowardBrake: false,
      })
      throw error
    }
    recordModelFailure(currentNodeModelKey(id))
    // Store the RAW message; the UI (NodeErrorReport) runs classifyGenerationError
    // to show a human reason + hint + the raw detail. Keeping node.error a plain
    // string avoids a persisted-shape migration for existing project files.
    const rawMessage = error instanceof Error && error.message ? error.message : '生成失败'
    useGenerationCanvasStore.getState().setNodeStatus(id, 'error', rawMessage)
    // 真执行失败 → 计入刹车（连续 3 个即暂停队列，防上游整体挂掉时把剩下的额度一路烧完）。
    useGenerationQueueStore.getState().markSettled(batchId, id, 'error', { error: rawMessage })
    throw error
  } finally {
    options.signal?.removeEventListener('abort', abortFromExternal)
    if (activeGenerationRuns.get(id) === activeRun) activeGenerationRuns.delete(id)
    // 取消登记与活预览帧都是会话瞬态：任务收尾（成/败/取消）一律清，防泄漏到下一次生成。
    clearTaskCancel(id)
    useComfyuiPreviewStore.getState().clearPreview(id)
    // 单发路径的批次由本函数自建，也由本函数收尾（批量路径归 runGenerationNodesByPlan 收）。
    if (ownsBatch) useGenerationQueueStore.getState().finishBatch(batchId)
  }
}

export type RunGenerationNodesBatchOptions = RunGenerationNodeOptions & {
  /** Maximum concurrent runs. Defaults to 6; dependency-ready nodes start as soon as their own inputs finish. */
  concurrency?: number
  /** Called whenever a node finishes (success or failure) so the UI can update progress. */
  onNodeResult?: (
    event: { ok: true; nodeId: string; result: GenerationNodeResult } | { ok: false; nodeId: string; error: Error },
  ) => void
}

export type RunGenerationNodesBatchResult = {
  totalCount: number
  successes: Array<{ nodeId: string; result: GenerationNodeResult }>
  failures: Array<{ nodeId: string; error: Error }>
}

/**
 * Run a batch of generation nodes with bounded concurrency. Each node
 * goes through the same retry/failure semantics as `runGenerationNode`,
 * so callers can still display a per-node retry button if a run fails.
 * This is the runtime used by the storyboard demo's "全部生成" action.
 *
 * @legacy-batch-frozen (P4 S7, docs/plan/2026-08-25-p4-s7-legacy-converge.md)
 * 这是 GUI 画布批量的**唯一自有派发循环**，也是默认构建里现役的唯一 GUI 批量路径（语义调度器默认关）。
 * 冻结纪律：**不加新功能**。新批量能力（合同/收据/预算/锚检查点/慢供应商韧性）只进语义调度器
 * multiShotBatchScheduler；本函数只做维护性修复，别在此长新逻辑。Canvas owner → 语义运行时的迁移
 * 是 P5 Proposal adapter（runtime plan line 103/505），不是 S7。check:batch-machines 门岗钉死
 * runGenerationNode 调用点不外扩（别在别处再起第四台批量循环）。
 */
export async function runGenerationNodesBatch(
  nodeIds: readonly string[],
  options: RunGenerationNodesBatchOptions,
): Promise<RunGenerationNodesBatchResult> {
  const queue = nodeIds
    .map((value) => String(value || '').trim())
    .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index)
  const concurrency = generationBatchConcurrency(queue, useGenerationCanvasStore.getState().nodes, options.concurrency)
  const successes: RunGenerationNodesBatchResult['successes'] = []
  const failures: RunGenerationNodesBatchResult['failures'] = []
  const batchCancellation = createGenerationBatchCancellation(options.signal)
  const signal = batchCancellation.controller.signal
  let cursor = 0

  async function worker(): Promise<void> {
    while (!signal.aborted && cursor < queue.length) {
      // 闸一：批次被整体取消 → 跳出；被连续失败刹车暂停 → 在此挂起，等用户「继续」或「全部取消」。
      // 不传 batchId 时恒 'go'，退化回接队列前的行为。
      if ((await waitForQueueGate(options.batchId)) === 'stop') break
      const nextIndex = cursor
      cursor += 1
      const nodeId = queue[nextIndex]
      // 闸二：这一个被单独取消了 → 直接跳过。**零 vendor 调用零扣费**，这就是「取消不产生费用」的兑现处。
      if (isEntryCancelled(options.batchId, nodeId)) continue
      try {
        const result = await runGenerationNode(nodeId, {
          executor: options.executor,
          retry: options.retry,
          // 整批共用一个托管决定：批量确认卡对整批问了一次（batchPlanPreview），别在波次里逐个再问。
          assetUploadConsent: options.assetUploadConsent,
          ...(options.promptSuffix ? { promptSuffix: options.promptSuffix } : {}),
          ...(options.grantId ? { grantId: options.grantId } : {}),
          signal,
          ...(options.batchId ? { batchId: options.batchId } : {}),
        })
        successes.push({ nodeId, result })
        options.onNodeResult?.({ ok: true, nodeId, result })
      } catch (error: unknown) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        failures.push({ nodeId, error: normalizedError })
        options.onNodeResult?.({ ok: false, nodeId, error: normalizedError })
      }
    }
  }

  try {
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
    await Promise.all(workers)
    if (signal.aborted) {
      for (const nodeId of queue.slice(cursor)) {
        const error = generationAbortError()
        useGenerationCanvasStore.getState().setNodeStatus(nodeId, 'idle')
        failures.push({ nodeId, error })
        options.onNodeResult?.({ ok: false, nodeId, error })
      }
    }
    return { totalCount: queue.length, successes, failures }
  } finally {
    batchCancellation.dispose()
  }
}

/**
 * 按拓扑依赖执行批量生成(harness S2b,替代平铺 FIFO 的入口):
 * - 就绪即运行：一个节点自己的依赖完成后立即开跑，不再等待同层慢任务;
 * - 依赖节点仍等到上游真完成才开跑——参考图不再"没出来就裸跑";
 * - blocked(上游缺果/环)与"上游本批失败"的下游 → **显式失败**,人话原因,可单独重试。
 *
 * @legacy-batch-frozen (P4 S7)：见下方 runGenerationNodesBatch 的冻结纪律——本函数是波次编排层，
 * 同样冻结、不加新功能。新批量能力走语义调度器。
 */
export async function runGenerationNodesByPlan(
  plan: DependencyWavePlan,
  options: RunGenerationNodesBatchOptions,
): Promise<RunGenerationNodesBatchResult> {
  const batchCancellation = createGenerationBatchCancellation(options.signal)
  const signal = batchCancellation.controller.signal
  const successes: RunGenerationNodesBatchResult['successes'] = []
  const failures: RunGenerationNodesBatchResult['failures'] = []
  // 整批一次登记（含后续波次 + 被拦下的）——「排队可见」的全部秘密：等 worker 空位的、等上游的，
  // 从这一刻起就在任务中心里有名有姓，而不是像以前那样在 store 里still idle、看着像没被选中。
  const batchId = useGenerationQueueStore
    .getState()
    .enqueueBatch([...plan.waves, plan.blocked.map((blocked) => blocked.nodeId)])
  const failNode = (nodeId: string, message: string) => {
    const error = new Error(message)
    useGenerationCanvasStore.getState().setNodeStatus(nodeId, 'error', message)
    // 「上游缺果/成环」与「上游本批失败的连带」都不是模型挂了 → 不进刹车计数，否则一个上游失败
    // 会把下游连锁标失败、瞬间凑满 3 个，误停整条队列。
    useGenerationQueueStore.getState().markSettled(batchId, nodeId, 'error', { error: message, countsTowardBrake: false })
    failures.push({ nodeId, error })
    options.onNodeResult?.({ ok: false, nodeId, error })
  }
  const cancelNode = (nodeId: string) => {
    const error = generationAbortError()
    useGenerationCanvasStore.getState().setNodeStatus(nodeId, 'idle')
    useGenerationQueueStore.getState().markSettled(batchId, nodeId, 'cancelled', { countsTowardBrake: false })
    failures.push({ nodeId, error })
    options.onNodeResult?.({ ok: false, nodeId, error })
  }
  // 等待态不许穿红衣（F15）：`unfrozen-anchor`（等定妆）与 `missing-upstream`（等上游出图）不是「失败」，
  // 是「在等一个还没做的前置」——红色错误卡只留给真失败（provider 报错）/结构错误（环）。这类：节点**留在 idle**
  // （不画红错误卡）、队列条目记 `cancelled`（已结算、零扣费、不进刹车、不进「重试失败」），原因由确认条 +
  // 完成汇总 notice 带可点下一步说清（去定妆 / 去生成上游）。retry 会再次被人话拦下，不静默、也不误当失败。
  const waitNode = (nodeId: string) => {
    useGenerationCanvasStore.getState().setNodeStatus(nodeId, 'idle')
    useGenerationQueueStore.getState().markSettled(batchId, nodeId, 'cancelled', { countsTowardBrake: false })
  }
  const isWaitingReason = (reason: DependencyWavePlan['blocked'][number]['reason']): boolean =>
    reason === 'unfrozen-anchor' || reason === 'missing-upstream'
  for (const blocked of plan.blocked) {
    if (isWaitingReason(blocked.reason)) waitNode(blocked.nodeId)
    else failNode(blocked.nodeId, blocked.detail) // cycle 等结构错误 = 真失败桶（红），可单独处理
  }

  const plannedIds = new Set(plan.waves.flat())
  const internalDeps = new Map<string, string[]>()
  for (const edge of plan.edgesUsed) {
    if (!plannedIds.has(edge.source) || !plannedIds.has(edge.target)) continue
    internalDeps.set(edge.target, [...(internalDeps.get(edge.target) ?? []), edge.source])
  }

  const orderedIds = plan.waves.flat()
  const failedIds = new Set(plan.blocked.map((blocked) => blocked.nodeId))
  const completedIds = new Set<string>()
  const startedIds = new Set<string>()
  const nodeById = new Map(useGenerationCanvasStore.getState().nodes.map((node) => [node.id, node]))
  const localConcurrency = generationBatchConcurrency(orderedIds, [...nodeById.values()], options.concurrency)
  const activeByProvider = new Map<string, number>()
  let activeCount = 0
  let settledCount = 0

  try {
    await new Promise<void>((resolve) => {
      const schedule = () => {
        if (signal.aborted) {
          for (const nodeId of orderedIds) {
            if (startedIds.has(nodeId) || completedIds.has(nodeId) || failedIds.has(nodeId)) continue
            failedIds.add(nodeId)
            settledCount += 1
            cancelNode(nodeId)
          }
          if (activeCount === 0 || settledCount >= orderedIds.length) resolve()
          return
        }
        let changed = true
        while (changed) {
          changed = false
          for (const nodeId of orderedIds) {
            if (startedIds.has(nodeId) || completedIds.has(nodeId) || failedIds.has(nodeId)) continue
            const failedDep = (internalDeps.get(nodeId) ?? []).find((dep) => failedIds.has(dep))
            if (!failedDep) continue
            failedIds.add(nodeId)
            settledCount += 1
            const depTitle = nodeById.get(failedDep)?.title || failedDep
            failNode(nodeId, `上游「${depTitle}」本批生成失败,本节点未执行`)
            changed = true
          }
        }

        for (const nodeId of orderedIds) {
          if (activeCount >= localConcurrency) break
          if (startedIds.has(nodeId) || completedIds.has(nodeId) || failedIds.has(nodeId)) continue
          const deps = internalDeps.get(nodeId) ?? []
          if (!deps.every((dep) => completedIds.has(dep))) continue
          const node = nodeById.get(nodeId)
          if (!node) {
            failedIds.add(nodeId)
            settledCount += 1
            failNode(nodeId, '节点不存在，本节点未执行')
            continue
          }
          const provider = generationProviderKey(node)
          if ((activeByProvider.get(provider) || 0) >= generationProviderLimit(provider)) continue

          startedIds.add(nodeId)
          activeCount += 1
          activeByProvider.set(provider, (activeByProvider.get(provider) || 0) + 1)
          void waitForQueueGate(batchId)
            .then((gate) => {
              if (gate === 'stop' || isEntryCancelled(batchId, nodeId)) throw generationAbortError()
              return runGenerationNode(nodeId, {
                executor: options.executor,
                retry: options.retry,
                assetUploadConsent: options.assetUploadConsent,
                ...(options.promptSuffix ? { promptSuffix: options.promptSuffix } : {}),
                ...(options.grantId ? { grantId: options.grantId } : {}),
                signal,
                batchId,
              })
            })
            .then(
              (result) => {
                completedIds.add(nodeId)
                successes.push({ nodeId, result })
                options.onNodeResult?.({ ok: true, nodeId, result })
              },
              (error: unknown) => {
                const normalizedError = error instanceof Error ? error : new Error(String(error))
                failedIds.add(nodeId)
                failures.push({ nodeId, error: normalizedError })
                options.onNodeResult?.({ ok: false, nodeId, error: normalizedError })
              },
            )
            .finally(() => {
              activeCount = Math.max(0, activeCount - 1)
              const providerActive = Math.max(0, (activeByProvider.get(provider) || 1) - 1)
              if (providerActive === 0) activeByProvider.delete(provider)
              else activeByProvider.set(provider, providerActive)
              settledCount += 1
              if (settledCount >= orderedIds.length) resolve()
              else schedule()
            })
        }

        if (settledCount >= orderedIds.length) resolve()
      }
      schedule()
    })
    return { totalCount: plan.waves.flat().length + plan.blocked.length, successes, failures }
  } finally {
    useGenerationQueueStore.getState().finishBatch(batchId)
    batchCancellation.dispose()
  }
}

/**
 * 单节点生成/重试/生成新版本的轻确认 + 铸令牌 + 跑（付费守卫，务实纵深 A1）。
 * rerun=true 时先复制出新节点再绑令牌跑，已生成的旧节点始终保留。
 */
export async function confirmAndRunNode(nodeId: string, opts: { rerun?: boolean } = {}): Promise<void> {
  const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === nodeId)
  const hosting = await resolveHostingDisclosure(node)
  if (!hosting.allowed) return
  const ok = await confirmGenerationSpend([node], {
    title: opts.rerun
      ? i18n.t('generationCommon.spend.generateVariant')
      : i18n.t('generationCommon.spend.startGeneration'),
    message: describeGenerationCost(1, node ? spendCostKind(node.kind) : 'image'),
    confirmLabel: opts.rerun ? '生成新版本' : '生成',
    light: true,
    ...(hosting.disclosure ? { hostingDisclosure: hosting.disclosure } : {}),
  })
  if (!ok) return
  let runId = nodeId
  if (opts.rerun) {
    const dup = useGenerationCanvasStore.getState().duplicateNodeForRegeneration(nodeId)
    if (!dup) return
    runId = dup.id
  }
  let grantId: string
  try {
    grantId = await mintSpendGrant([runId])
  } catch (error) {
    toast(
      error instanceof Error && error.message
        ? error.message
        : i18n.t('generationCommon.batchPlan.authorizationFailed'),
      'error',
    )
    return
  }
  try {
    await runGenerationNode(runId, { grantId, assetUploadConsent: 'allow' })
  } catch {
    // 失败已记在节点上（卡片渲染人话错误），这里不再弹。
  }
}

/**
 * 同一镜头 ×N 变体连发（2026-07-29 批量体检 C，样张拍板）：一次轻确认按 N 张报成本，
 * 随后逐次铸令牌+跑。**串行**——同节点的进度/状态是单通道，并发会互踩；N≤4 体感可接受。
 * 出图走 addNodeResult 既有堆叠（新图设主图、旧图进历史里挑）。中途失败即停：
 * 剩余次数不再扣费（对坏通道不连烧；失败原因已落节点卡片），已出的变体保留。
 */
export async function confirmAndRunNodeVariants(
  nodeId: string,
  count: number,
  // 托管同意由本函数自己的花钱卡问出来（下方固定传 'allow'），调用方给不了也不该给。
  options: Omit<RunGenerationNodeOptions, 'assetUploadConsent'> = {},
): Promise<void> {
  const id = String(nodeId || '').trim()
  if (!id) return
  const total = Math.max(1, Math.min(8, Math.floor(count)))
  const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
  const hosting = await resolveHostingDisclosure(node)
  if (!hosting.allowed) return
  const ok = await confirmGenerationSpend([node], {
    title: i18n.t('generationCommon.spend.startGeneration'),
    message: describeGenerationCost(total, node ? spendCostKind(node.kind) : 'image'),
    confirmLabel: i18n.t('generationCommon.spend.generate'),
    light: true,
    ...(hosting.disclosure ? { hostingDisclosure: hosting.disclosure } : {}),
  })
  if (!ok) return
  for (let index = 0; index < total; index += 1) {
    let grantId: string
    try {
      grantId = await mintSpendGrant([id])
    } catch (error) {
      toast(
        error instanceof Error && error.message
          ? error.message
          : i18n.t('generationCommon.batchPlan.authorizationFailed'),
        'error',
      )
      return
    }
    try {
      const result = await runGenerationNode(id, { ...options, grantId, assetUploadConsent: 'allow' })
      useWorkbenchStore.getState().reconcileTimelineForUpdatedNodes(id, result)
    } catch {
      return // 失败已落节点卡片（人话错误）；停发剩余变体
    }
  }
}

/**
 * 时间轴专用的“替换当前片段”操作。它必须保留 sourceNodeId 才能原位回填 clip，
 * 但 `addNodeResult` 仍会把旧结果留在 history，可从节点结果栈切回。
 * 画布节点的再次生成不得调用这里，统一走上面的新版本节点路径。
 */
export async function regenerateNodeInPlace(nodeId: string): Promise<void> {
  const id = String(nodeId || '').trim()
  if (!id) return
  const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
  const hosting = await resolveHostingDisclosure(node)
  if (!hosting.allowed) return
  const ok = await confirmGenerationSpend([node], {
    title: i18n.t('generationCommon.composer.regenerate'),
    message: describeGenerationCost(1, node ? spendCostKind(node.kind) : 'image'),
    confirmLabel: '生成并替换',
    light: true,
    ...(hosting.disclosure ? { hostingDisclosure: hosting.disclosure } : {}),
  })
  if (!ok) return
  let grantId: string
  try {
    grantId = await mintSpendGrant([id])
  } catch (error) {
    toast(
      error instanceof Error && error.message
        ? error.message
        : i18n.t('generationCommon.batchPlan.authorizationFailed'),
      'error',
    )
    return
  }
  try {
    const result = await runGenerationNode(id, { grantId, assetUploadConsent: 'allow' })
    useWorkbenchStore.getState().reconcileTimelineForUpdatedNodes(id, result)
  } catch {
    // 失败已记在节点卡片（人话错误），不再弹。
  }
}
