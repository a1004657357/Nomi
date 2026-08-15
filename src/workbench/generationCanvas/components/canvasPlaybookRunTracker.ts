import type { AgentHarnessConfig } from '../../../api/desktopClient'
import type { ToolCallEvent } from '../agent/generationCanvasAgentClient'
import {
  completeCanvasSkillStage,
  failCanvasSkillStage,
  syncCanvasSkillStageFromHarness,
  type CanvasSkillHarnessStage,
  type CanvasSkillStageRun,
} from '../skills/canvasSkillModel'

type PlaybookTarget = { skillNodeId: string; stage: CanvasSkillStageRun }

export type CanvasPlaybookRunTracker = {
  onHarnessConfig: (config: AgentHarnessConfig) => void
  trackToolCall: (event: ToolCallEvent) => ToolCallEvent
  complete: (raw: unknown) => void
  fail: (message: string) => void
}

/** Keeps backend-validated Playbook stage state out of the assistant panel shell. */
export function createCanvasPlaybookRunTracker(
  target: PlaybookTarget | undefined,
  skillKey: string | undefined,
): CanvasPlaybookRunTracker {
  let blocked = false
  let harnessStage: CanvasSkillHarnessStage | null = null
  return {
    onHarnessConfig: (config) => {
      const stage = config.playbook
      if (!target || !stage) return
      harnessStage = stage
      if (
        stage.skillKey !== skillKey
        || stage.stageId !== target.stage.id
        || !syncCanvasSkillStageFromHarness(target.skillNodeId, stage)
      ) blocked = true
    },
    trackToolCall: (event) => target
      ? {
          ...event,
          confirm: async (decision) => {
            if (!decision.ok) blocked = true
            await event.confirm(decision)
          },
        }
      : event,
    complete: (rawValue) => {
      if (!target) return
      const raw = rawValue as { cancelled?: unknown; playbook?: CanvasSkillHarnessStage } | undefined
      const stage = raw?.playbook ?? harnessStage
      if (!raw?.cancelled && !blocked && stage?.stageId === target.stage.id) {
        completeCanvasSkillStage(target.skillNodeId, target.stage.id, stage)
        return
      }
      const reason = raw?.cancelled
        ? '用户停止了当前阶段'
        : blocked
          ? '当前阶段有操作未获批准'
          : 'Agent 没有返回匹配的 Playbook 阶段回执'
      failCanvasSkillStage(target.skillNodeId, target.stage.id, reason)
    },
    fail: (message) => {
      if (target) failCanvasSkillStage(target.skillNodeId, target.stage.id, message)
    },
  }
}
