import { useWorkbenchStore } from '../../workbenchStore'
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { generationCanvasTools } from './generationCanvasTools'
import { sendGenerationCanvasAgentMessage, type ToolCallEvent } from './generationCanvasAgentClient'
import type { PlanShot, StoryboardPlan } from './storyboardPlan'

const AUTOFILL_TEXT_FIELDS = [
  'scene',
  'shotSize',
  'cameraAngle',
  'cameraMove',
  'characters',
  'performance',
  'dialogue',
  'props',
  'sound',
  'notes',
] as const satisfies readonly (keyof PlanShot)[]

type AutofillResult = {
  updatedShotCount: number
  updatedShotIndices: number[]
  text: string
}

function shotPayload(shot: PlanShot): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    index: shot.index,
    shotKind: shot.shotKind,
    durationSec: shot.durationSec,
    prompt: shot.prompt,
    imagePrompt: shot.imagePrompt,
    videoPrompt: shot.videoPrompt,
  }
  for (const field of AUTOFILL_TEXT_FIELDS) {
    if (shot[field]) fields[field] = shot[field]
  }
  return fields
}

function buildStoryboardAutofillMessage(plan: StoryboardPlan, overwriteExisting: boolean): string {
  return [
    '请自动填写当前分镜脚本表格。',
    '',
    '硬性要求：',
    '- 只调用 batch_update_storyboard_shots；必要时可以先 read_canvas_state。',
    '- 不要调用 create_canvas_nodes、run_generation_batch、set_node_prompt、delete_canvas_nodes。',
    `- overwriteExisting=${overwriteExisting ? 'true' : 'false'}。${overwriteExisting ? '允许覆盖已有表格字段。' : '只补空字段，不覆盖用户已经填写的表格字段。'}`,
    '- deriveVideoPrompts=true。不要手写松散的视频提示词；系统会用最终表格字段确定性扩写成详细视频生成 prompt。',
    '- 每个镜头尽量填写：scene、shotSize、cameraAngle、cameraMove、characters、performance、dialogue、props、sound、notes。',
    '- 内容必须具体到可拍摄：空间位置、景别、机位、运镜方向、人物动作、道具关系、声音氛围都要明确。',
    '- 如果设备背面/侧面朝向镜头，notes 里必须保留“屏幕不可见、不得描述屏幕内容”的约束。',
    '- shots 数组只返回需要更新的镜头和字段；镜头号必须沿用 index。',
    '',
    '当前分镜方案 JSON：',
    JSON.stringify({
      title: plan.title,
      shots: plan.shots.map(shotPayload),
    }, null, 2),
  ].join('\n')
}

function readAppliedShotResult(result: unknown): number[] {
  if (!result || typeof result !== 'object') return []
  const record = result as Record<string, unknown>
  if (Array.isArray(record.updatedShotIndices)) {
    return record.updatedShotIndices.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  }
  return typeof record.shotIndex === 'number' && Number.isFinite(record.shotIndex) ? [record.shotIndex] : []
}

export async function runStoryboardTableAutofill(input: {
  plan: StoryboardPlan
  overwriteExisting?: boolean
  onContent?: (text: string) => void
  onCancelReady?: (cancel: () => void) => void
}): Promise<AutofillResult> {
  if (input.plan.shots.length === 0) throw new Error('当前分镜脚本没有镜头可填写')
  useWorkbenchStore.getState().setStoryboardPlan(input.plan)
  const updated = new Set<number>()
  const overwriteExisting = input.overwriteExisting === true
  const response = await sendGenerationCanvasAgentMessage({
    message: buildStoryboardAutofillMessage(input.plan, overwriteExisting),
    snapshot: generationCanvasTools.read_canvas(),
    selectedNodes: [],
    mode: 'agent',
    onContent: (_delta, text) => input.onContent?.(text),
    ...(input.onCancelReady ? { onCancelReady: input.onCancelReady } : {}),
    onToolCall: (event: ToolCallEvent) => {
      void (async () => {
        if (event.toolName === 'read_canvas_state') {
          try {
            const result = await applyCanvasToolCall(event.toolName, event.args)
            await event.confirm({ ok: true, result, silent: true })
          } catch (error: unknown) {
            await event.confirm({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (event.toolName === 'batch_update_storyboard_shots' || event.toolName === 'update_storyboard_shot') {
          try {
            const result = await applyCanvasToolCall(event.toolName, event.args)
            readAppliedShotResult(result).forEach((index) => updated.add(index))
            await event.confirm({ ok: true, result, silent: true })
          } catch (error: unknown) {
            await event.confirm({ ok: false, message: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        await event.confirm({
          ok: false,
          denied: true,
          message: 'Agent 填表模式只允许读取画布和更新分镜脚本，不允许创建、删除或生成节点。',
        })
      })()
    },
  })
  if (updated.size === 0) throw new Error('Agent 没有提交分镜表更新')
  return {
    updatedShotCount: updated.size,
    updatedShotIndices: Array.from(updated).sort((a, b) => a - b),
    text: response.response.text?.trim() || '',
  }
}
