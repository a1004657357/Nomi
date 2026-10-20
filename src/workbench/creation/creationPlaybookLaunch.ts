import type { ComposerAttachment } from '../ai/composer/composerAttachmentTypes'
import { listWorkbenchSkills } from '../api/skillApi'
import {
  addCanvasSkillNode,
  beginCanvasSkillStage,
  focusCanvasSkillNode,
  readCanvasSkillNodeState,
} from '../generationCanvas/skills/canvasSkillModel'
import { requestCanvasSkillAgent } from '../generationCanvas/skills/canvasSkillEvents'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'

type LaunchCreationPlaybookInput = {
  selectedSkillKey?: string
  userMessage: string
  attachments: ComposerAttachment[]
  clearComposer: () => void
  switchToGeneration: () => void
  reportError: (message: string) => void
}

/** Route a manifest-backed playbook through its canvas Skill node. */
export async function launchCreationPlaybook(input: LaunchCreationPlaybookInput): Promise<boolean> {
  if (!input.selectedSkillKey) return false
  let playbook
  try {
    playbook = (await listWorkbenchSkills()).find((skill) => skill.name === input.selectedSkillKey)
  } catch {
    return false
  }
  if (!playbook?.isPlaybook || !playbook.canvas) return false

  const canvas = useGenerationCanvasStore.getState()
  let skillNode = canvas.nodes.find((node) => readCanvasSkillNodeState(node)?.skillKey === playbook.name)
  if (!skillNode) skillNode = addCanvasSkillNode(playbook) ?? undefined
  if (!skillNode) {
    input.reportError('无法创建画布 Skill 节点。')
    return true
  }
  const stage = beginCanvasSkillStage(skillNode.id)
  if (!stage) {
    input.reportError('当前 Playbook 没有可执行阶段，或阶段正在运行。')
    return true
  }
  const sourceNodeIds = useGenerationCanvasStore.getState().edges
    .filter((edge) => edge.target === skillNode.id)
    .map((edge) => edge.source)

  input.clearComposer()
  input.switchToGeneration()
  window.setTimeout(() => {
    focusCanvasSkillNode(skillNode.id)
    requestCanvasSkillAgent({
      skill: { skillKey: playbook.name, label: playbook.label },
      skillNodeId: skillNode.id,
      sourceNodeIds: [...new Set(sourceNodeIds)],
      stage,
      userMessage: input.userMessage,
      ...(input.attachments.length ? { attachments: input.attachments } : {}),
    })
  }, 60)
  return true
}
