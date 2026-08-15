/**
 * Gate 3 Slice 3 测试：批量生成预算执行闸（§16.2, §23.3）。
 *
 * 验收：
 * - canSubmit 在达 maxSubmissions / maxCostCny 时返回 false。
 * - recordSubmission 计数（含失败——防「失败重试绕过预算」）。
 * - snapshot 正确反映剩余（供 UI 显示，§16.2）。
 * - previewBatchBudget 计算预计提交数/费用/超限（§16.2 批量面板）。
 */
import { describe, expect, it } from 'vitest'
import { GenerationBudget, previewBatchBudget } from './generationBudget'

describe('GenerationBudget — 提交次数上限', () => {
  it('canSubmit until maxSubmissions reached', () => {
    const budget = new GenerationBudget({ maxSubmissions: 3 })
    expect(budget.canSubmit()).toBe(true)
    budget.recordSubmission({})
    expect(budget.canSubmit()).toBe(true)
    budget.recordSubmission({})
    expect(budget.canSubmit()).toBe(true)
    budget.recordSubmission({})
    expect(budget.canSubmit()).toBe(false) // 达上限 3
  })

  it('snapshot reports atSubmissionCap and remainingSubmissions', () => {
    const budget = new GenerationBudget({ maxSubmissions: 2 })
    budget.recordSubmission({})
    const snap = budget.snapshot()
    expect(snap.submissionsUsed).toBe(1)
    expect(snap.remainingSubmissions).toBe(1)
    expect(snap.atSubmissionCap).toBe(false)
    budget.recordSubmission({})
    expect(budget.snapshot().atSubmissionCap).toBe(true)
    expect(budget.snapshot().remainingSubmissions).toBe(0)
  })
})

describe('GenerationBudget — 费用上限', () => {
  it('canSubmit false when next cost would exceed maxCostCny', () => {
    const budget = new GenerationBudget({ maxSubmissions: 10, maxCostCny: 5 })
    budget.recordSubmission({ costCny: 3 })
    expect(budget.canSubmit(2)).toBe(true) // 3+2=5 ≤ 5
    expect(budget.canSubmit(3)).toBe(false) // 3+3=6 > 5
  })

  it('atCostCap true when costUsed reaches maxCostCny', () => {
    const budget = new GenerationBudget({ maxSubmissions: 10, maxCostCny: 5 })
    budget.recordSubmission({ costCny: 5 })
    expect(budget.snapshot().atCostCap).toBe(true)
    // canSubmit(0): projected 5+0=5, not > 5 → 仍可（atCostCap 是已达，canSubmit 看是否会超）
    // 但任何正费用下一次提交都会超 → canSubmit(0.01) false
    expect(budget.canSubmit(0.01)).toBe(false)
  })

  it('costUsed accumulates', () => {
    const budget = new GenerationBudget({ maxSubmissions: 10, maxCostCny: 10 })
    budget.recordSubmission({ costCny: 2 })
    budget.recordSubmission({ costCny: 3 })
    expect(budget.snapshot().costUsedCny).toBe(5)
  })
})

describe('GenerationBudget — 失败也计数（防绕过）', () => {
  it('recordSubmission with no cost still counts toward maxSubmissions', () => {
    const budget = new GenerationBudget({ maxSubmissions: 2 })
    budget.recordSubmission({}) // 失败（无费用）
    budget.recordSubmission({}) // 失败
    expect(budget.canSubmit()).toBe(false) // 失败也算，防「失败重试绕过预算」
  })
})

describe('GenerationBudget — 构造校验', () => {
  it('throws on maxSubmissions < 1', () => {
    expect(() => new GenerationBudget({ maxSubmissions: 0 })).toThrow()
    expect(() => new GenerationBudget({ maxSubmissions: -1 })).toThrow()
  })
})

describe('previewBatchBudget — §16.2 批量面板预计', () => {
  it('computes planned submissions excluding already-has-result', () => {
    const preview = previewBatchBudget({
      totalIntents: 12,
      alreadyHasResultCount: 4,
      estimatedCostPerSubmissionCny: 0.5,
      maxSubmissions: 10,
      maxCostCny: 5,
    })
    expect(preview.plannedSubmissions).toBe(8)
    expect(preview.estimatedCostCny).toBe(4)
    expect(preview.blockedByBudget).toBe(false)
  })

  it('blockedByBudget true when planned exceeds maxSubmissions', () => {
    const preview = previewBatchBudget({
      totalIntents: 15,
      alreadyHasResultCount: 0,
      maxSubmissions: 10,
    })
    expect(preview.plannedSubmissions).toBe(15)
    expect(preview.overflows.submissionOverflow).toBe(5)
    expect(preview.blockedByBudget).toBe(true)
  })

  it('blockedByBudget true when estimated cost exceeds maxCostCny', () => {
    const preview = previewBatchBudget({
      totalIntents: 10,
      alreadyHasResultCount: 0,
      estimatedCostPerSubmissionCny: 1,
      maxSubmissions: 20,
      maxCostCny: 5,
    })
    expect(preview.overflows.costOverflow).toBe(5)
    expect(preview.blockedByBudget).toBe(true)
  })

  it('no maxCostCny → costOverflow always 0', () => {
    const preview = previewBatchBudget({
      totalIntents: 100,
      alreadyHasResultCount: 0,
      estimatedCostPerSubmissionCny: 99,
      maxSubmissions: 200,
    })
    expect(preview.overflows.costOverflow).toBe(0)
  })
})
