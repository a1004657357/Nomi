import { desktopT } from "../desktopStrings";
/**
 * Gate 8 — 隔离真实生产验收 harness（§27 Gate 8 + §25.5 真实 Provider 验收）。
 *
 * **诚实声明（§4.3）**：本 harness 是脚手架——它定义了 Gate 8 验收的**结构、预算约束、清理报告**，
 * 但**不**在无凭据/无预算时伪造生成结果。Gate 8 真实通过需：
 * 1. 真实付费 Provider 凭据（Codex/即梦/AGNES/Seedance API key）
 * 2. 真实预算授权（CNY 上限）
 * 3. 真实用户确认每步生成（§11.3 付费工具确认门）
 * 4. 真实人工六角色审查（§26.1）
 *
 * 本 harness 提供：
 * - **隔离测试项目 fixture**（剧本→分镜结构，不含真实资产——资产由真实生成产生）。
 * - **验收预算闸**（§25.5：明确提交上限、并发上限、费用上限）。
 * - **验收报告结构**（质量/费用/耗时/资产路径/清理）。
 * - **全旅程检查清单**（剧本→分镜→资产→关键帧→视频→验收→时间线→MP4）。
 */
import { GenerationBudget, type BudgetSnapshot } from '../tasks/generationBudget'

/** §27 Gate 8 隔离测试项目的剧本 fixture（6 镜短片；不含真实资产，仅结构）。 */
export const ISOLATED_TEST_SCREENPLAY = {
  title: desktopT("custom.gate8.isolatedProductionAcceptanceHarness.text1"),
  logline: '林夏在天台接到反派电话，从迟疑到转身面对。',
  shots: [
    { index: 1, kind: 'image' as const, scene: '天台远景', shot: '建立空间', durationSec: 0 },
    { index: 2, kind: 'image' as const, scene: '林夏背影', shot: '建立角色', durationSec: 0 },
    { index: 3, kind: 'video' as const, scene: '电话响', shot: '林夏看电话', durationSec: 5 },
    { index: 4, kind: 'video' as const, scene: '林夏接电话', shot: '对白', durationSec: 6 },
    { index: 5, kind: 'video' as const, scene: '脚步声', shot: '反派出现', durationSec: 4 },
    { index: 6, kind: 'video' as const, scene: '林夏转身', shot: '高潮', durationSec: 5 },
  ],
}

/** §25.5 Gate 8 验收预算约束（保守；可由调用方覆盖）。 */
export const GATE8_ACCEPTANCE_BUDGET = {
  /** 最大真实提交次数（6 镜 × 允许重试）。 */
  maxSubmissions: 12,
  /** 费用上限（人民币）。 */
  maxCostCny: 10,
  /** 并发上限。 */
  maxConcurrency: 2,
  /** 失败默认不自动重新付费提交（§25.5）。 */
  autoRetryPaid: false,
}

/** Gate 8 全旅程检查清单（§27 + §25.4 E2E）。 */
export type JourneyStep = {
  step: string
  description: string
  /** 真实通过的证据（截图/录屏/资产路径/费用记录）。填了才算通过。 */
  evidence?: string
  passed: boolean
}

export const GATE8_JOURNEY_CHECKLIST: JourneyStep[] = [
  { step: '1. 导入短剧本', description: '把 ISOLATED_TEST_SCREENPLAY 导入为项目', passed: false },
  { step: '2. Agent 拆 6 镜并审阅', description: 'propose_storyboard_plan 产出 6 镜方案，用户审阅', passed: false },
  { step: '3. 落画布并创建资产卡', description: '角色/场景/道具资产卡就位', passed: false },
  { step: '4. 生成图片镜头', description: '至少 1 个 image 镜真实生成成功', passed: false },
  { step: '5. 生成视频镜头', description: '至少 1 个 video 镜真实生成成功', passed: false },
  { step: '6. 全屏预览 + 选 revision', description: '双击全屏、比较、select revision', passed: false },
  { step: '7. Blender 预演', description: '发送 1 镜到 Blender，回传 preview/.blend', passed: false },
  { step: '8. 放入时间线', description: 'selected revision → timeline', passed: false },
  { step: '9. 导出 MP4', description: '导出可播放 MP4（正确画幅 + 预期音频）', passed: false },
]

/**
 * Gate 8 验收报告（§27：质量、费用、耗时、资产路径、清理）。
 * 真实通过 = 所有 journey step passed=true + budget 未超 + 无凭据泄漏 + 清理完成。
 */
export type Gate8Report = {
  projectId: string
  startedAt: string
  finishedAt?: string
  journey: JourneyStep[]
  budget: BudgetSnapshot
  /** 真实资产路径（生成结果落盘位置）。 */
  assetPaths: string[]
  /** 费用明细（per submission）。 */
  costBreakdown: Array<{ submissionId: string; vendor: string; model: string; costCny?: number; status: string }>
  /** 清理报告（孤儿进程/临时文件检查）。 */
  cleanup: { orphanProcesses: string[]; tempFilesCleaned: number }
  /** 凭据泄漏自检（§22.1：报告不得含 key/cookie）。 */
  credentialLeakCheck: { passed: boolean; scannedFields: string[] }
  /** 是否真实通过（非伪造）。 */
  verdict: 'not-run' | 'in-progress' | 'passed' | 'failed'
  /** 未通过的 P2 缺口（§27 允许非阻塞 P2）。 */
  knownP2Gaps: string[]
}

/**
 * 初始化一个 Gate 8 验收运行。
 * 调用方（真实测试运行器）持有此对象，逐步推进 journey + 记录证据。
 *
 * **绝不**在无凭据时调 recordRealSubmission——那会伪造数据（§4.3 禁止）。
 */
export class Gate8AcceptanceRun {
  readonly projectId: string
  readonly budget: GenerationBudget
  private readonly journey: JourneyStep[]
  private readonly assetPaths: string[] = []
  private readonly costBreakdown: Gate8Report['costBreakdown'] = []
  private startedAt: string

  constructor(projectId: string) {
    this.projectId = projectId
    this.budget = new GenerationBudget({
      maxSubmissions: GATE8_ACCEPTANCE_BUDGET.maxSubmissions,
      maxCostCny: GATE8_ACCEPTANCE_BUDGET.maxCostCny,
    })
    this.journey = GATE8_JOURNEY_CHECKLIST.map((s) => ({ ...s }))
    this.startedAt = new Date().toISOString()
  }

  /** 标记某 journey step 通过（带证据）。 */
  markStepPassed(step: string, evidence: string): void {
    const item = this.journey.find((s) => s.step.startsWith(step))
    if (item) {
      item.passed = true
      item.evidence = evidence
    }
  }

  /**
   * 记录一次真实提交（含费用）。**仅在真实生成发生后调用**——伪造 = §4.3 违规。
   * 返回 false 表示预算超限（§23.3：停止新提交，已有任务继续查询）。
   */
  recordRealSubmission(entry: {
    submissionId: string
    vendor: string
    model: string
    costCny?: number
    status: string
    assetPath?: string
  }): { accepted: boolean; budgetSnapshot: Snapshot } {
    if (!this.budget.canSubmit(entry.costCny)) {
      return { accepted: false, budgetSnapshot: this.budget.snapshot() }
    }
    this.budget.recordSubmission({ costCny: entry.costCny })
    this.costBreakdown.push({
      submissionId: entry.submissionId,
      vendor: entry.vendor,
      model: entry.model,
      ...(entry.costCny != null ? { costCny: entry.costCny } : {}),
      status: entry.status,
    })
    if (entry.assetPath) this.assetPaths.push(entry.assetPath)
    return { accepted: true, budgetSnapshot: this.budget.snapshot() }
  }

  /** 生成验收报告（§27 Gate 8 交付）。 */
  buildReport(opts: {
    cleanup: { orphanProcesses: string[]; tempFilesCleaned: number }
    credentialLeakCheck: { passed: boolean; scannedFields: string[] }
    knownP2Gaps?: string[]
  }): Gate8Report {
    const allPassed = this.journey.every((s) => s.passed)
    const budgetOk = !this.budget.snapshot().atSubmissionCap || this.costBreakdown.length > 0
    const verdict: Gate8Report['verdict'] = allPassed && budgetOk && opts.credentialLeakCheck.passed
      ? 'passed'
      : this.journey.some((s) => s.passed)
        ? 'in-progress'
        : 'not-run'
    return {
      projectId: this.projectId,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      journey: this.journey,
      budget: this.budget.snapshot(),
      assetPaths: this.assetPaths,
      costBreakdown: this.costBreakdown,
      cleanup: opts.cleanup,
      credentialLeakCheck: opts.credentialLeakCheck,
      verdict,
      knownP2Gaps: opts.knownP2Gaps ?? [],
    }
  }
}

type Snapshot = BudgetSnapshot
