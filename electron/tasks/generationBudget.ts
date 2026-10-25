import { desktopT } from "../desktopStrings";
/**
 * Gate 3 Slice 3 — 批量生成预算执行闸（§16.2, §23.3）。
 *
 * 对应目标架构 §16.2「批量面板必须显示预计提交数、预计费用、依赖阻塞和已存在结果」+
 * §23.3「批量任务达到预算上限立即停止新提交，已有任务继续查询」。
 *
 * 现状（Gate 0 §1.4 证据）：既有 spendGrant 是**每节点 attempts 上限**（DEFAULT_MAX_ATTEMPTS_PER_NODE=3），
 * **无** maxCostCny/maxSubmissions 批量上限——200 节点批可发 200 次提交。本 Slice 补批量预算闸。
 *
 * 设计：
 * - **GenerationBudget**：一次批量生成的预算台账。提交前 `canSubmit()` 检查是否超 maxSubmissions/maxCostCny。
 * - **超限行为**：canSubmit 返回 false → 调用方停止新提交（§23.3）；**已有任务继续查询**（不取消）。
 * - **不替代 spendGrant**：spendGrant 是每节点 attempts 硬闸（钱安全）；本模块是批量级软上限（预算治理）。
 *   两者正交：spendGrant 防「同一节点重复扣费」，budget 防「整批超预算」。
 * - **纯函数 + 可注入 now**：便于测试。
 */
export type BudgetSnapshot = {
  /** 已提交次数（含成功/失败/取消）。 */
  submissionsUsed: number
  /** 已花费（人民币；Provider 未返回费用时只计次数）。 */
  costUsedCny: number
  /** 是否已达提交上限。 */
  atSubmissionCap: boolean
  /** 是否已达费用上限。 */
  atCostCap: boolean
  /** 剩余可提交数（Infinity=无 maxSubmissions 限制）。 */
  remainingSubmissions: number
}

export type GenerationBudgetOptions = {
  /** 最大提交次数（含重试）；必填（§9.5 GenerationIntent.budget.maxSubmissions）。 */
  maxSubmissions: number
  /** 最大费用（人民币）；可选（Provider 未返回费用时只受 maxSubmissions 约束）。 */
  maxCostCny?: number
  /** 注入「现在」便于测试。 */
  now?: () => number
}

/**
 * 批量生成预算台账。
 *
 * 用法（批量调度器）：
 * ```ts
 * const budget = new GenerationBudget({ maxSubmissions: 10, maxCostCny: 5 })
 * for (const intent of intents) {
 *   if (!budget.canSubmit()) break  // §23.3：超预算立即停新提交
 *   await submit(intent)
 *   budget.recordSubmission({ costCny: estimatedCost })
 * }
 * // 已有任务继续查询（不在本类职责）
 * ```
 */
export class GenerationBudget {
  readonly maxSubmissions: number
  readonly maxCostCny?: number
  private submissionsUsed = 0
  private costUsedCny = 0

  constructor(opts: GenerationBudgetOptions) {
    if (!Number.isFinite(opts.maxSubmissions) || opts.maxSubmissions < 1) {
      throw new Error(desktopT("custom.tasks.generationBudget.text1"))
    }
    this.maxSubmissions = opts.maxSubmissions
    this.maxCostCny = opts.maxCostCny
  }

  /** 是否还能提交（未达 maxSubmissions 且未达 maxCostCny）。 */
  canSubmit(nextCostCny?: number): boolean {
    if (this.submissionsUsed >= this.maxSubmissions) return false
    if (this.maxCostCny != null && Number.isFinite(this.maxCostCny)) {
      const projected = this.costUsedCny + (nextCostCny ?? 0)
      if (projected > this.maxCostCny) return false
    }
    return true
  }

  /** 记录一次提交（含成功/失败/取消——失败也计数，防「失败重试绕过预算」）。 */
  recordSubmission(entry: { costCny?: number }): void {
    this.submissionsUsed += 1
    if (typeof entry.costCny === 'number' && Number.isFinite(entry.costCny)) {
      this.costUsedCny += entry.costCny
    }
  }

  /** 当前快照（供 UI 显示「预计提交数/费用/剩余」，§16.2）。 */
  snapshot(): BudgetSnapshot {
    const atSubmissionCap = this.submissionsUsed >= this.maxSubmissions
    const atCostCap =
      this.maxCostCny != null && Number.isFinite(this.maxCostCny) && this.costUsedCny >= this.maxCostCny
    return {
      submissionsUsed: this.submissionsUsed,
      costUsedCny: this.costUsedCny,
      atSubmissionCap,
      atCostCap,
      remainingSubmissions: Math.max(0, this.maxSubmissions - this.submissionsUsed),
    }
  }

  /** 重置（测试用）。 */
  reset(): void {
    this.submissionsUsed = 0
    this.costUsedCny = 0
  }
}

/**
 * 预检：给定一组 GenerationIntent 的预算与既有可能已存在的部分结果，
 * 计算预计提交数/费用（§16.2 批量面板显示）。
 */
export function previewBatchBudget(input: {
  totalIntents: number
  alreadyHasResultCount: number
  estimatedCostPerSubmissionCny?: number
  maxSubmissions: number
  maxCostCny?: number
}): {
  plannedSubmissions: number
  estimatedCostCny: number
  blockedByBudget: boolean
  overflows: { submissionOverflow: number; costOverflow: number }
} {
  const plannedSubmissions = Math.max(0, input.totalIntents - input.alreadyHasResultCount)
  const estimatedCostCny = plannedSubmissions * (input.estimatedCostPerSubmissionCny ?? 0)
  const submissionOverflow = Math.max(0, plannedSubmissions - input.maxSubmissions)
  const costOverflow =
    input.maxCostCny != null ? Math.max(0, estimatedCostCny - input.maxCostCny) : 0
  return {
    plannedSubmissions,
    estimatedCostCny,
    blockedByBudget: submissionOverflow > 0 || costOverflow > 0,
    overflows: { submissionOverflow, costOverflow },
  }
}
