/**
 * Gate 2 Slice 2 测试：统一 PlaybookRun ↔ CanvasSkillNodeState 双状态机。
 *
 * 验收：
 * - backend done → frontend done（权威覆盖）。
 * - backend awaiting-confirm → frontend awaiting-confirm（消除漂移）。
 * - backend running + index 变化 → frontend running + index 跟进。
 * - frontend error 时，backend 仍 running/awaiting 不覆盖（保留 error）。
 * - 无变更返回原引用（避免无谓重渲染）。
 * - detectPlaybookDrift 正确识别漂移。
 */
import { describe, expect, it } from 'vitest'
import type { CanvasSkillNodeState } from './canvasSkillModel'
import { detectPlaybookDrift, syncCanvasSkillFromPlaybook } from './playbookStateSync'

function makeState(overrides: Partial<CanvasSkillNodeState> = {}): CanvasSkillNodeState {
  return {
    inputs: [],
    stages: [
      { id: 's1', goal: 'g1', tools: [], pause: false },
      { id: 's2', goal: 'g2', tools: [], pause: true },
      { id: 's3', goal: 'g3', tools: [], pause: false },
    ],
    neededProviders: [],
    recipeIds: [],
    defaultRecipeId: undefined,
    outputNodeIds: [],
    runStatus: 'ready',
    currentStageIndex: 0,
    ...overrides,
  } as CanvasSkillNodeState
}

describe('syncCanvasSkillFromPlaybook — backend 权威投影', () => {
  it('backend done → frontend done (overrides any prior state)', () => {
    const state = makeState({ runStatus: 'running', currentStageIndex: 1 })
    const next = syncCanvasSkillFromPlaybook(state, { index: 3, total: 3, status: 'done' })
    expect(next.runStatus).toBe('done')
  })

  it('backend awaiting-confirm → frontend awaiting-confirm (fixes drift)', () => {
    // 漂移场景：backend 已暂停等确认，frontend 却显示 ready
    const state = makeState({ runStatus: 'ready', currentStageIndex: 1 })
    const next = syncCanvasSkillFromPlaybook(state, { index: 1, total: 3, status: 'awaiting-confirm' })
    expect(next.runStatus).toBe('awaiting-confirm')
  })

  it('backend running + index advance → frontend running + index follows', () => {
    const state = makeState({ runStatus: 'awaiting-confirm', currentStageIndex: 1 })
    const next = syncCanvasSkillFromPlaybook(state, { index: 2, total: 3, status: 'running' })
    expect(next.runStatus).toBe('running')
    expect(next.currentStageIndex).toBe(2)
  })

  it('preserves frontend error when backend still running (renderer-local fault)', () => {
    const state = makeState({ runStatus: 'error', currentStageIndex: 0, lastRunError: '脚本注入失败' })
    const next = syncCanvasSkillFromPlaybook(state, { index: 0, total: 3, status: 'running' })
    // error 保留，backend running 不覆盖
    expect(next).toBe(state) // 返回原引用（不覆盖）
    expect(next.runStatus).toBe('error')
    expect(next.lastRunError).toBe('脚本注入失败')
  })

  it('backend done clears frontend error (playbook termination archives error)', () => {
    const state = makeState({ runStatus: 'error', currentStageIndex: 0, lastRunError: 'boom' })
    const next = syncCanvasSkillFromPlaybook(state, { index: 3, total: 3, status: 'done' })
    expect(next.runStatus).toBe('done')
    expect(next.lastRunError).toBeUndefined()
  })

  it('no change → returns same reference (no needless re-render)', () => {
    const state = makeState({ runStatus: 'running', currentStageIndex: 1 })
    const next = syncCanvasSkillFromPlaybook(state, { index: 1, total: 3, status: 'running' })
    expect(next).toBe(state)
  })

  it('index clamps to stages length (defensive)', () => {
    const state = makeState({ runStatus: 'ready', currentStageIndex: 0 })
    const next = syncCanvasSkillFromPlaybook(state, { index: 99, total: 3, status: 'running' })
    // stages.length = 3 → clamp to 2
    expect(next.currentStageIndex).toBe(2)
  })
})

describe('detectPlaybookDrift — 漂移诊断', () => {
  it('no drift when states agree', () => {
    const state = makeState({ runStatus: 'awaiting-confirm', currentStageIndex: 1 })
    const result = detectPlaybookDrift(state, { index: 1, total: 3, status: 'awaiting-confirm' })
    expect(result.drifted).toBe(false)
  })

  it('detects drift (backend awaiting-confirm, frontend ready)', () => {
    const state = makeState({ runStatus: 'ready', currentStageIndex: 1 })
    const result = detectPlaybookDrift(state, { index: 1, total: 3, status: 'awaiting-confirm' })
    expect(result.drifted).toBe(true)
    expect(result.detail).toContain('awaiting-confirm')
    expect(result.detail).toContain('ready')
  })

  it('detects index drift (same status, different stage)', () => {
    const state = makeState({ runStatus: 'running', currentStageIndex: 0 })
    const result = detectPlaybookDrift(state, { index: 2, total: 3, status: 'running' })
    expect(result.drifted).toBe(true)
  })

  it('error state with backend running = no drift (error is renderer-local)', () => {
    const state = makeState({ runStatus: 'error', currentStageIndex: 0, lastRunError: 'x' })
    const result = detectPlaybookDrift(state, { index: 0, total: 3, status: 'running' })
    expect(result.drifted).toBe(false)
  })
})
