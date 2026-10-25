import i18n from "../../../i18n"
import React from 'react'
import { getDesktopBridge } from '../../../desktop/bridge'
import { toast } from '../../../ui/toast'
import type { ComposerAttachment } from '../../ai/composer/composerAttachmentTypes'
import { isProjectExecutionContextCurrent, withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  buildFixationPlanningMessage,
  FIXATION_PLANNER_SKILL,
  FIXATION_PLANNING_EVENT,
  type FixationPlanningRequest,
} from '../agent/fixationLauncher'
import {
  buildEvenlySpacedFrameTimes,
  resolveVideoDurationSeconds,
} from '../nodes/videoKeyframeInspectorModel'
import type { CanvasSkillStageRun } from '../skills/canvasSkillModel'
import {
  canvasSkillAgentMessage,
  RUN_CANVAS_SKILL_AGENT_EVENT,
  type RunCanvasSkillAgentEventDetail,
} from '../skills/canvasSkillEvents'
import {
  buildVideoDeconstructionAttachments,
  isVideoDeconstructionSkill,
  videoDeconstructionAgentMessage,
} from '../skills/videoDeconstructionSkill'

export type CanvasAssistantSubmitOptions = {
  skill?: { key: string; name: string }
  displayMessage?: string
  attachments?: ComposerAttachment[]
  playbookRun?: { skillNodeId: string; stage: CanvasSkillStageRun }
}

type SubmitAgentMessage = (text: string, options?: CanvasAssistantSubmitOptions) => void

export function useCanvasAssistantSkillEvents(input: {
  nodes: GenerationCanvasNode[]
  setCollapsed: (collapsed: boolean) => void
  submitAgentMessage: SubmitAgentMessage
}): void {
  const { nodes, setCollapsed, submitAgentMessage } = input

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<FixationPlanningRequest>).detail
      const storyText = detail?.storyText?.trim() || ''
      if (!storyText) return
      setCollapsed(false)
      submitAgentMessage(buildFixationPlanningMessage(storyText), {
        skill: FIXATION_PLANNER_SKILL,
        displayMessage: `💄 定妆\n\n${storyText}`,
      })
    }
    window.addEventListener(FIXATION_PLANNING_EVENT, handler as EventListener)
    return () => window.removeEventListener(FIXATION_PLANNING_EVENT, handler as EventListener)
  }, [setCollapsed, submitAgentMessage])

  React.useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<RunCanvasSkillAgentEventDetail>).detail
      if (!detail?.skill?.skillKey || !detail.skill.label || !detail.skillNodeId) return
      setCollapsed(false)
      if (!isVideoDeconstructionSkill(detail.skill.skillKey)) {
        submitAgentMessage(canvasSkillAgentMessage(detail), {
          skill: { key: detail.skill.skillKey, name: detail.skill.label },
          displayMessage: detail.userMessage?.trim()
            ? `使用技能：${detail.skill.label}\n\n${detail.userMessage.trim()}`
            : `使用技能：${detail.skill.label}`,
          ...(detail.attachments?.length ? { attachments: detail.attachments } : {}),
          ...(detail.stage ? { playbookRun: { skillNodeId: detail.skillNodeId, stage: detail.stage } } : {}),
        })
        return
      }
      withProjectAction(project => {
        void prepareVideoDeconstruction({ project, detail, nodes, submitAgentMessage }).catch(error => {
          if (isProjectExecutionContextCurrent(project)) toast(i18n.t("customWorkflow.videoBreakdownPreparationFailed", { v0: error instanceof Error ? error.message : String(error) }), 'error')
        })
      }, () => { toast(i18n.t("customWorkflow.videoBreakdownRequiresAnOpenDesktopProject"), 'error') })
    }
    window.addEventListener(RUN_CANVAS_SKILL_AGENT_EVENT, handler)
    return () => window.removeEventListener(RUN_CANVAS_SKILL_AGENT_EVENT, handler)
  }, [nodes, setCollapsed, submitAgentMessage])
}

async function prepareVideoDeconstruction(input: {
  project: ProjectExecutionContext
  detail: RunCanvasSkillAgentEventDetail
  nodes: GenerationCanvasNode[]
  submitAgentMessage: SubmitAgentMessage
}): Promise<void> {
  const { detail, nodes, submitAgentMessage, project } = input
  project.assertCurrent()
  const source = detail.sourceNodeIds
    .map((id) => nodes.find((node) => node.id === id))
    .find((node) => node?.result?.type === 'video' && node.result.url)
  if (!source || source.result?.type !== 'video' || !source.result.url) {
    toast(i18n.t("customWorkflow.connectAVideoNodeWithAnExistingResult"), 'warning')
    return
  }
  const projectId = project.binding.projectId
  const desktop = getDesktopBridge()
  if (!projectId || !desktop?.video?.extractFrames) {
    toast(i18n.t("customWorkflow.videoBreakdownRequiresASavedDesktopProject"), 'error')
    return
  }
  let duration = resolveVideoDurationSeconds(source)
  if (!duration && desktop.assets.inspectVideo) {
    const inspection = await desktop.assets.inspectVideo({ url: source.result.url })
    project.assertCurrent()
    duration = inspection.metadata?.durationSeconds ?? null
  }
  if (!duration) {
    toast(i18n.t("customWorkflow.couldNotReadVideoDurationPlayTheVideo"), 'error')
    return
  }
  toast(i18n.t("customWorkflow.extracting8SequentialKeyframesForTheAgent"), 'info')
  try {
    const payload = {
      videoUrl: source.result.url,
      projectId,
      projectBinding: project.binding,
      times: buildEvenlySpacedFrameTimes(duration, 8),
    }
    const extracted = await desktop.video.extractFrames(payload)
    project.assertCurrent()
    const frames = extracted.frames.filter((frame) => frame.url)
    if (!frames.length) throw new Error('没有取得有效关键帧')
    submitAgentMessage(videoDeconstructionAgentMessage(detail, frames), {
      skill: { key: detail.skill.skillKey, name: detail.skill.label },
      displayMessage: `使用技能：${detail.skill.label}\n已连接：${source.title}`,
      attachments: buildVideoDeconstructionAttachments(frames),
    })
  } catch (error) {
    if (!isProjectExecutionContextCurrent(project)) return
    toast(i18n.t("customWorkflow.videoBreakdownPreparationFailed", { v0: error instanceof Error ? error.message : String(error) }), 'error')
  }
}
