/**
 * Gate 2 Slice 2 — 统一 PlaybookRun（backend）与 CanvasSkillNodeState（frontend）双状态机。
 *
 * 对应目标架构 §10.3 Skill Playbook 状态机 + Gate 0 §2「两套并行状态机」缺口。
 *
 * 现状（Gate 0 §1.2 证据）：
 * - backend `PlaybookRun`（`electron/skills/playbookOrchestrator.ts:103`）：权威状态机，
 *   status = running/awaiting-confirm/done，cursor 推进。
 * - frontend `CanvasSkillNodeState`（`src/workbench/generationCanvas/skills/canvasSkillModel.ts:21`）：
 *   runStatus = ready/running/awaiting-confirm/done/error，currentStageIndex。
 * - 二者**独立计算**，无同步——后端 awaiting-confirm 时前端可能显示 ready（漂移）。
 *
 * 本 Slice（不破坏既有）：
 * - **投影同步**：backend 为权威，`syncCanvasSkillFromPlaybook` 把 PlaybookRun.progress() 投影成
 *   CanvasSkillNodeState。frontend 不再独立判定 awaiting-confirm/done（仅 error 仍由 frontend 自主，
 *   因 error 是 frontend 渲染层瞬时故障）。
 * - **纯函数**：无副作用，调用方（harness 事件处理）持有 PlaybookRun 实例 + nodeId 调用本函数。
 *
 * 不在本 Slice：实际接入 harness 事件流（需改 canvasSkillEvents.ts 的运行回路，留 Slice 4 与工具注册一起做）。
 */
import type { CanvasSkillNodeState } from './canvasSkillModel'

/** backend PlaybookRun 的 status（镜像 playbookOrchestrator.ts 的 PlaybookStatus，避免 electron↔src 跨界 import）。 */
export type PlaybookStatus = 'running' | 'awaiting-confirm' | 'done'

/** backend PlaybookRun.progress() 的镜像形（playbookOrchestrator.ts:161）。 */
export type PlaybookProgress = {
  index: number
  total: number
  status: PlaybookStatus
}

/**
 * 把 backend PlaybookRun 的 progress 投影成 frontend CanvasSkillNodeState 的应然状态。
 *
 * 规则（backend 权威）：
 * - backend done → frontend done（无论 frontend 之前是什么）。
 * - backend awaiting-confirm → frontend awaiting-confirm（消除"backend 暂停但 frontend 显示 ready"漂移）。
 * - backend running + index 变化 → frontend running + currentStageIndex 跟进。
 * - frontend error 是**渲染层瞬时故障**（如脚本注入失败），不由 backend 覆盖——保留 frontend 既有的 error。
 *
 * @param current frontend 当前 state（用于保留 error / 判断是否需变更）。
 * @param progress backend 权威进度。
 * @returns 新的 frontend state（若无需变更，返回原对象引用——避免无谓重渲染）。
 */
export function syncCanvasSkillFromPlaybook(
  current: CanvasSkillNodeState,
  progress: PlaybookProgress,
): CanvasSkillNodeState {
  // 保留 frontend error：backend 不懂渲染层故障，error 只由 failCanvasSkillStage 设置、由 begin 清除。
  const preserveError = current.runStatus === 'error' ? current.lastRunError : undefined

  // 计算 backend 权威的应然 runStatus
  let authoritativeRunStatus: CanvasSkillNodeState['runStatus']
  if (progress.status === 'done') {
    authoritativeRunStatus = 'done'
  } else if (progress.status === 'awaiting-confirm') {
    authoritativeRunStatus = 'awaiting-confirm'
  } else {
    // running
    authoritativeRunStatus = 'running'
  }

  // 若 frontend 已是 error 且 backend 仍在 running/awaiting → 不覆盖（让 error 先被处理）
  // 但 backend done 总是覆盖（playbook 结束 = 该轮 run 终结，error 也归档）
  if (current.runStatus === 'error' && progress.status !== 'done') {
    return current
  }

  const nextIndex = Math.min(progress.index, Math.max(current.stages.length - 1, 0))

  // 无变更则返回原引用（避免无谓重渲染）
  if (
    current.runStatus === authoritativeRunStatus &&
    current.currentStageIndex === nextIndex &&
    preserveError === current.lastRunError
  ) {
    return current
  }

  return {
    ...current,
    runStatus: authoritativeRunStatus,
    currentStageIndex: nextIndex,
    // done 时清 error（playbook 终结归档）；running/awaiting 保留既有 error（上面已决定不覆盖）
    lastRunError: progress.status === 'done' ? undefined : preserveError,
  }
}

/**
 * 检测双状态机是否漂移（用于诊断/日志，非运行时门）。
 * 漂移 = frontend 与 backend 对当前阶段的 status 看法不一致。
 */
export function detectPlaybookDrift(
  current: CanvasSkillNodeState,
  progress: PlaybookProgress,
): { drifted: boolean; detail?: string } {
  const expected = syncCanvasSkillFromPlaybook(current, progress)
  if (expected.runStatus === current.runStatus && expected.currentStageIndex === current.currentStageIndex) {
    return { drifted: false }
  }
  return {
    drifted: true,
    detail: `backend(status=${progress.status},index=${progress.index}) vs frontend(runStatus=${current.runStatus},index=${current.currentStageIndex})`,
  }
}
