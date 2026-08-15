/**
 * Gate 8 harness 测试（验证脚手架结构与预算约束，**不伪造生成**）。
 *
 * 验收：
 * - ISOLATED_TEST_SCREENPLAY 是 6 镜结构。
 * - GATE8_ACCEPTANCE_BUDGET 保守（maxSubmissions/costCny/concurrency）。
 * - Gate8AcceptanceRun.budget 在超限时拒绝新提交（§23.3）。
 * - markStepPassed 带证据。
 * - buildReport verdict 在未完成时 = not-run/in-progress（**不伪造 passed**）。
 * - 全旅程 9 步 checklist 完整（剧本→分镜→资产→关键帧→视频→验收→时间线→MP4）。
 *
 * **本测试不调 recordRealSubmission 伪造费用**——那需真实生成（§4.3 禁止）。
 */
import { describe, expect, it } from 'vitest'
import {
  GATE8_ACCEPTANCE_BUDGET,
  GATE8_JOURNEY_CHECKLIST,
  ISOLATED_TEST_SCREENPLAY,
  Gate8AcceptanceRun,
} from './isolatedProductionAcceptanceHarness'

describe('Gate 8 隔离测试项目 fixture', () => {
  it('ISOLATED_TEST_SCREENPLAY is a 6-shot short film', () => {
    expect(ISOLATED_TEST_SCREENPLAY.shots).toHaveLength(6)
    expect(ISOLATED_TEST_SCREENPLAY.shots.some((s) => s.kind === 'image')).toBe(true)
    expect(ISOLATED_TEST_SCREENPLAY.shots.some((s) => s.kind === 'video')).toBe(true)
  })

  it('GATE8_ACCEPTANCE_BUDGET is conservative (§25.5)', () => {
    expect(GATE8_ACCEPTANCE_BUDGET.maxSubmissions).toBeLessThanOrEqual(20)
    expect(GATE8_ACCEPTANCE_BUDGET.maxCostCny).toBeLessThanOrEqual(50)
    expect(GATE8_ACCEPTANCE_BUDGET.maxConcurrency).toBeLessThanOrEqual(2)
    expect(GATE8_ACCEPTANCE_BUDGET.autoRetryPaid).toBe(false) // §25.5 失败不自动重付费
  })
})

describe('Gate 8 journey checklist — 全旅程 9 步', () => {
  it('covers 剧本→分镜→资产→关键帧/图片→视频→验收/预览→Blender→时间线→MP4', () => {
    const steps = GATE8_JOURNEY_CHECKLIST.map((s) => s.step)
    expect(steps).toHaveLength(9)
    expect(steps.some((s) => s.includes('剧本'))).toBe(true)
    expect(steps.some((s) => s.includes('镜'))).toBe(true) // 拆镜/分镜
    expect(steps.some((s) => s.includes('资产'))).toBe(true)
    expect(steps.some((s) => s.includes('图片'))).toBe(true)
    expect(steps.some((s) => s.includes('视频'))).toBe(true)
    expect(steps.some((s) => s.includes('时间线'))).toBe(true)
    expect(steps.some((s) => s.includes('MP4'))).toBe(true)
  })

  it('all steps start unpassed (no false pre-completion)', () => {
    for (const s of GATE8_JOURNEY_CHECKLIST) {
      expect(s.passed).toBe(false)
    }
  })
})

describe('Gate8AcceptanceRun — 预算约束（§23.3）', () => {
  it('budget rejects new submission when maxCostCny exceeded', () => {
    const run = new Gate8AcceptanceRun('gate8-test')
    // 用 maxCostCny=10；提交多次直到超
    for (let i = 0; i < 5; i++) {
      run.recordRealSubmission({
        submissionId: `s${i}`,
        vendor: 'kie',
        model: 'x',
        costCny: 2, // 每次 2 元
        status: 'succeeded',
      })
    }
    // 第 6 次（总 12 > 10）应被拒
    const r = run.recordRealSubmission({
      submissionId: 's5',
      vendor: 'kie',
      model: 'x',
      costCny: 2,
      status: 'succeeded',
    })
    expect(r.accepted).toBe(false)
  })

  it('recordRealSubmission records assetPath + cost', () => {
    const run = new Gate8AcceptanceRun('gate8-test')
    run.recordRealSubmission({
      submissionId: 's1',
      vendor: 'codex',
      model: 'gpt-image-2',
      costCny: 0.5,
      status: 'succeeded',
      assetPath: '/proj/assets/shot1.png',
    })
    const report = run.buildReport({
      cleanup: { orphanProcesses: [], tempFilesCleaned: 0 },
      credentialLeakCheck: { passed: true, scannedFields: ['costBreakdown'] },
    })
    expect(report.assetPaths).toContain('/proj/assets/shot1.png')
    expect(report.costBreakdown[0].costCny).toBe(0.5)
  })
})

describe('Gate8AcceptanceRun — verdict 不伪造 passed（§4.3）', () => {
  it('fresh run → verdict not-run', () => {
    const run = new Gate8AcceptanceRun('gate8-test')
    const report = run.buildReport({
      cleanup: { orphanProcesses: [], tempFilesCleaned: 0 },
      credentialLeakCheck: { passed: true, scannedFields: [] },
    })
    expect(report.verdict).toBe('not-run')
  })

  it('partially completed → verdict in-progress (not passed)', () => {
    const run = new Gate8AcceptanceRun('gate8-test')
    run.markStepPassed('1', '剧本已导入')
    run.markStepPassed('2', '6 镜方案已审')
    const report = run.buildReport({
      cleanup: { orphanProcesses: [], tempFilesCleaned: 0 },
      credentialLeakCheck: { passed: true, scannedFields: [] },
    })
    expect(report.verdict).toBe('in-progress')
  })

  it('all steps passed + no leak → verdict passed', () => {
    const run = new Gate8AcceptanceRun('gate8-test')
    for (const s of GATE8_JOURNEY_CHECKLIST) {
      run.markStepPassed(s.step, `evidence for ${s.step}`)
    }
    const report = run.buildReport({
      cleanup: { orphanProcesses: [], tempFilesCleaned: 5 },
      credentialLeakCheck: { passed: true, scannedFields: ['all'] },
    })
    expect(report.verdict).toBe('passed')
  })

  it('credential leak → verdict not passed (even if all steps done)', () => {
    const run = new Gate8AcceptanceRun('gate8-test')
    for (const s of GATE8_JOURNEY_CHECKLIST) {
      run.markStepPassed(s.step, 'evidence')
    }
    const report = run.buildReport({
      cleanup: { orphanProcesses: [], tempFilesCleaned: 0 },
      credentialLeakCheck: { passed: false, scannedFields: ['costBreakdown'] }, // 泄漏
    })
    expect(report.verdict).not.toBe('passed')
  })
})

describe('Gate8AcceptanceRun — markStepPassed 带证据', () => {
  it('step evidence is recorded (not just a boolean)', () => {
    const run = new Gate8AcceptanceRun('gate8-test')
    run.markStepPassed('9', '/proj/exports/gate8.mp4 (1080p, 30s, AAC)')
    const report = run.buildReport({
      cleanup: { orphanProcesses: [], tempFilesCleaned: 0 },
      credentialLeakCheck: { passed: true, scannedFields: [] },
    })
    const step9 = report.journey.find((s) => s.step.startsWith('9'))
    expect(step9?.passed).toBe(true)
    expect(step9?.evidence).toContain('gate8.mp4')
  })
})
