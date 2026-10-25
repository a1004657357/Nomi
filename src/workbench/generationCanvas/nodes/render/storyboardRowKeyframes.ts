import { canvasSourceDefaults } from '../../../../../electron/shared/canvas/sourceDefaults'
import { storyboardShotVideoPrompt, type PlanShot } from '../../agent/storyboardPlan'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { storyboardRowOutputPosition } from './storyboardRowOutputs'

const FIRST_SEGMENT_SECONDS = 5
const SECOND_SEGMENT_SECONDS = 3
const TOTAL_SECONDS = FIRST_SEGMENT_SECONDS + SECOND_SEGMENT_SECONDS
const VIDEO_NODE_WIDTH = 420
const KEYFRAME_NODE_WIDTH = 320
const OUTPUT_GAP = 80

type StoryboardKeyframeRole = 'boundary' | 'end'

type EnsureStoryboardRowKeyframesInput = {
  tableNode: GenerationCanvasNode
  shot: PlanShot
  sourceImageNode: GenerationCanvasNode
}

export type StoryboardRowKeyframesResult = {
  sourceImageNodeId: string
  boundaryNodeId: string
  endNodeId: string
  nodeIds: [string, string]
  createdCount: number
}

const META_KEYS_TO_RESET = [
  'storyboardContainedByNodeId',
  'storyboardContainedRowIndex',
  'storyboardContainedRole',
  'storyboardContainedExpanded',
  'sourceStoryboardTableNodeId',
  'storyboardRowIndex',
  'storyboardRowOutputRole',
  'referenceImageUrls',
  'referenceVideoUrls',
  'referenceAudioUrls',
  'firstFrameUrl',
  'lastFrameUrl',
  'first_frame_url',
  'last_frame_url',
  'input_images',
] as const

function metaRecord(node: Pick<GenerationCanvasNode, 'meta'>): Record<string, unknown> {
  return node.meta && typeof node.meta === 'object' ? node.meta : {}
}

function hasUsableImage(node: GenerationCanvasNode): boolean {
  if (node.result?.type !== 'image') return false
  return Boolean(node.result.url || node.result.thumbnailUrl || node.result.providerUrl)
}

function keyframePrompt(shot: PlanShot, role: StoryboardKeyframeRole): string {
  const videoPrompt = storyboardShotVideoPrompt(shot).trim()
  const timing = role === 'boundary'
    ? [
        `时间位置：连续 ${TOTAL_SECONDS} 秒镜头的第 ${FIRST_SEGMENT_SECONDS} 秒。`,
        `动作阶段：把视频提示词中的动作链推进到前 ${FIRST_SEGMENT_SECONDS} 秒已经完成的状态，画面必须明显区别于起始参考图。`,
      ]
    : [
        `时间位置：同一镜头的第 ${TOTAL_SECONDS} 秒结尾，即第 ${FIRST_SEGMENT_SECONDS} 秒动作帧之后的后续 ${SECOND_SEGMENT_SECONDS} 秒。`,
        `动作阶段：从输入的第 ${FIRST_SEGMENT_SECONDS} 秒状态继续完成剩余动作，不得重新表演前段动作，不得回到起始姿态。`,
      ]
  return [
    '基于输入参考图，生成同一镜头、同一时空中的单张电影关键帧，不要生成分镜格、拼图、字幕或时间码。',
    ...timing,
    '连续性锁定：严格保持角色身份、脸部、发型、服装、场景结构、道具形状、左右关系、镜头轴线、焦段感、画幅比例、光线方向和色彩风格一致。',
    '动作要有可见的位移、姿态或道具状态变化；只表现该时间点的瞬间，不要用运动模糊掩盖动作结果。',
    `完整视频提示词：${videoPrompt || '保持当前构图，让主体完成清晰、符合物理逻辑的动作链。'}`,
  ].join('\n')
}

function keyframeMeta(
  source: GenerationCanvasNode,
  tableNodeId: string,
  shotIndex: number,
  role: StoryboardKeyframeRole,
): Record<string, unknown> {
  const meta = { ...metaRecord(source) }
  for (const key of META_KEYS_TO_RESET) delete meta[key]
  return {
    ...meta,
    excludeFromShotNumbering: true,
    storyboardKeyframeForTableNodeId: tableNodeId,
    storyboardKeyframeShotIndex: shotIndex,
    storyboardKeyframeRole: role,
    storyboardKeyframeTimeSec: role === 'boundary' ? FIRST_SEGMENT_SECONDS : TOTAL_SECONDS,
    storyboardKeyframeSourceImageNodeId: source.id,
    storyboardKeyframeSequence: `${FIRST_SEGMENT_SECONDS}+${SECOND_SEGMENT_SECONDS}`,
  }
}

function findOwnedKeyframe(
  tableNodeId: string,
  shotIndex: number,
  role: StoryboardKeyframeRole,
): GenerationCanvasNode | null {
  const nodes = useGenerationCanvasStore.getState().nodes
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    const meta = metaRecord(node)
    if (
      node.kind === 'keyframe'
      && meta.storyboardKeyframeForTableNodeId === tableNodeId
      && meta.storyboardKeyframeShotIndex === shotIndex
      && meta.storyboardKeyframeRole === role
    ) {
      return node
    }
  }
  return null
}

function keyframePosition(
  tableNode: GenerationCanvasNode,
  shotIndex: number,
  role: StoryboardKeyframeRole,
): { x: number; y: number } {
  const videoPosition = storyboardRowOutputPosition(tableNode, shotIndex, 'video')
  const boundaryX = videoPosition.x + VIDEO_NODE_WIDTH + OUTPUT_GAP
  return {
    x: role === 'boundary' ? boundaryX : boundaryX + KEYFRAME_NODE_WIDTH + OUTPUT_GAP,
    y: videoPosition.y,
  }
}

function ensureKeyframeNode(
  input: EnsureStoryboardRowKeyframesInput,
  source: GenerationCanvasNode,
  role: StoryboardKeyframeRole,
): { node: GenerationCanvasNode; created: boolean } {
  const store = useGenerationCanvasStore.getState()
  const prompt = keyframePrompt(input.shot, role)
  const existing = findOwnedKeyframe(input.tableNode.id, input.shot.index, role)
  if (existing) {
    if (existing.prompt !== prompt) store.updateNodePrompt(existing.id, prompt)
    return {
      node: useGenerationCanvasStore.getState().nodes.find((node) => node.id === existing.id) || existing,
      created: false,
    }
  }

  const timeSec = role === 'boundary' ? FIRST_SEGMENT_SECONDS : TOTAL_SECONDS
  const created = store.addNode({
    kind: 'keyframe',
    title: canvasSourceDefaults.keyframeTitle(input.shot.index, timeSec, role === 'boundary' ? '动作' : '结尾'),
    prompt,
    position: keyframePosition(input.tableNode, input.shot.index, role),
    categoryId: input.tableNode.categoryId || source.categoryId || 'shots',
    select: false,
    exactPosition: true,
    meta: keyframeMeta(source, input.tableNode.id, input.shot.index, role),
  })
  return { node: created, created: true }
}

export function ensureStoryboardRowKeyframes(
  input: EnsureStoryboardRowKeyframesInput,
): StoryboardRowKeyframesResult {
  const state = useGenerationCanvasStore.getState()
  const source = state.nodes.find((node) => node.id === input.sourceImageNode.id)
  if (!source || !hasUsableImage(source)) {
    throw new Error('请先生成该镜头的分镜参考图，再派生 5+3 秒关键帧')
  }

  const boundary = ensureKeyframeNode(input, source, 'boundary')
  const ending = ensureKeyframeNode(input, boundary.node, 'end')
  useGenerationCanvasStore.getState().connectNodes(source.id, boundary.node.id, 'reference')
  useGenerationCanvasStore.getState().connectNodes(boundary.node.id, ending.node.id, 'reference')

  return {
    sourceImageNodeId: source.id,
    boundaryNodeId: boundary.node.id,
    endNodeId: ending.node.id,
    nodeIds: [boundary.node.id, ending.node.id],
    createdCount: Number(boundary.created) + Number(ending.created),
  }
}
