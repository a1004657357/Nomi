import type { CanvasSkillNodeState } from './canvasSkillModel'

export const RUN_CANVAS_SKILL_AGENT_EVENT = 'nomi-run-canvas-skill-agent'

export type RunCanvasSkillAgentEventDetail = {
  skill: Pick<CanvasSkillNodeState, 'skillKey' | 'label'>
  sourceNodeIds: string[]
  skillNodeId: string
}

export function requestCanvasSkillAgent(input: RunCanvasSkillAgentEventDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<RunCanvasSkillAgentEventDetail>(RUN_CANVAS_SKILL_AGENT_EVENT, { detail: input }),
  )
}

export function canvasSkillAgentMessage(input: RunCanvasSkillAgentEventDetail): string {
  const sources = input.sourceNodeIds.length
    ? `优先使用已连入技能节点的素材：${input.sourceNodeIds.join('、')}。`
    : '先检查当前选区和画布，确认需要使用的素材。'
  return [
    `请按「${input.skill.label}」技能推进当前画布。`,
    sources,
    `技能节点：${input.skillNodeId}。`,
    '按 playbook 阶段执行；每个写操作先给出可确认的计划，任何付费生成都必须等待我的明确确认。',
  ].join('\n')
}
