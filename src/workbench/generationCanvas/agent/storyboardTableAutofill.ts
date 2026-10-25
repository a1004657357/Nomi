import { z } from 'zod'
import { useWorkbenchStore } from '../../workbenchStore'
import { selectActiveStoryboardDesign } from '../../workbenchDocumentSlice'
import type { ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { runSingleShotAgent } from '../../ai/agentLoopMode'
import { collectStoryboardShotPatch, applyDerivedStoryboardVideoPrompt, syncStoryboardPlanToCanvas } from './storyboardPlanMutations'
import type { StoryboardPlan } from './storyboardPlan'

const responseSchema = z.object({ shots: z.array(z.object({ index: z.number().int().positive() }).passthrough()) })
export async function runStoryboardTableAutofill(input: {
  project: ProjectExecutionContext
  plan: StoryboardPlan
  overwriteExisting?: boolean
  onContent?: (text: string) => void
  onCancelReady?: (cancel: () => void) => void
}): Promise<{ updatedShotCount: number; updatedShotIndices: number[]; text: string }> {
  if (!input.plan.shots.length) throw new Error('当前分镜脚本没有镜头可填写')
  const { project } = input
  project.assertCurrent()
  const projectId = project.binding.projectId
  const design = selectActiveStoryboardDesign(useWorkbenchStore.getState())
  let disposeCancellation = () => {}
  try {
  const response = await runSingleShotAgent({
    featureKey: 'nomi:storyboard-table-autofill',
    projectId,
    displayPrompt: '填写分镜表',
    prompt: JSON.stringify(input.plan),
    systemPrompt: [
      '为当前分镜表补充可拍摄的场景、景别、机位、运镜、角色、表演、对白、道具、声音和备注。',
      '只返回 JSON 对象 {"shots":[{"index":1,"scene":"...","shotSize":"...","cameraAngle":"...","cameraMove":"...","characters":"...","performance":"...","dialogue":"...","props":"...","sound":"...","notes":"..."}]}。',
      '保留原镜号，不添加或删除镜头；不要调用工具，不要生成图片或视频，不要输出代码。',
    ].join('\n'),
    onCancelReady: cancel => {
      if (project.signal.aborted) { cancel(); return }
      project.signal.addEventListener('abort', cancel, { once: true })
      disposeCancellation = () => project.signal.removeEventListener('abort', cancel)
      input.onCancelReady?.(cancel)
    },
  })
  project.assertCurrent()
  const parsed = responseSchema.parse(JSON.parse(response.text || ''))
  const current = selectActiveStoryboardDesign(useWorkbenchStore.getState())
  if (current?.id !== design?.id || (current && current.plan !== input.plan)) {
    throw new Error('分镜已发生变化，请重新填写')
  }
  const byIndex = new Map(parsed.shots.map(shot => [shot.index, shot]))
  if (parsed.shots.some(shot => !input.plan.shots.some(current => current.index === shot.index))) throw new Error('Agent 返回了不存在的镜号')
  const changed = new Set<number>()
  const next: StoryboardPlan = { ...input.plan, shots: input.plan.shots.map(shot => {
    const record = byIndex.get(shot.index)
    if (!record) return shot
    const { patch, updated } = collectStoryboardShotPatch(shot, record, { overwriteExisting: input.overwriteExisting === true })
    if (!updated.length) return shot
    changed.add(shot.index)
    return applyDerivedStoryboardVideoPrompt({ ...shot, ...patch })
  }) }
  if (!changed.size) throw new Error('Agent 没有提交分镜表更新')
  useWorkbenchStore.getState().setStoryboardPlan(next, design?.documentId, design?.id)
  syncStoryboardPlanToCanvas(next, changed)
  input.onContent?.(response.text || '')
  return { updatedShotCount: changed.size, updatedShotIndices: [...changed].sort((a, b) => a - b), text: response.text || '' }
  } finally {
    disposeCancellation()
  }
}
