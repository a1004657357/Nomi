import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isShotNumberedNode } from '../model/shotNumbering'
import {
  storyboardContainedRowIndex,
  storyboardContainerNodeId,
} from '../model/storyboardContainedNodes'
import { parseStoryboardPlan, storyboardShotVideoPrompt } from './storyboardPlan'
import i18n from '../../../i18n'

function metaRecord(node: Pick<GenerationCanvasNode, 'meta'>): Record<string, unknown> {
  return node.meta && typeof node.meta === 'object' ? node.meta as Record<string, unknown> : {}
}

function storyboardPromptForImageNode(
  node: GenerationCanvasNode,
  nodes: readonly GenerationCanvasNode[],
): string | null {
  const meta = metaRecord(node)
  const tableNodeId = storyboardContainerNodeId(node)
    || (typeof meta.sourceStoryboardTableNodeId === 'string' ? meta.sourceStoryboardTableNodeId : '')
  const rowIndex = storyboardContainedRowIndex(node)
    ?? (typeof meta.storyboardRowIndex === 'number' ? meta.storyboardRowIndex : node.shotIndex)
  if (!tableNodeId || typeof rowIndex !== 'number') return null
  const table = nodes.find((candidate) => candidate.id === tableNodeId)
  const snapshot = table ? metaRecord(table).storyboardPlanSnapshot : null
  if (!snapshot) return null
  try {
    const shot = parseStoryboardPlan(snapshot).shots.find((candidate) => candidate.index === rowIndex)
    return shot ? storyboardShotVideoPrompt(shot) : null
  } catch {
    return null
  }
}

export function compileImageShotFallbackVideoPrompt(imagePrompt: string): string {
  const visualBasis = imagePrompt.trim() || '沿用当前分镜图中的人物、场景、道具和空间关系'
  return [
    '视频导演提示词：参考画面只定义人物身份、场景、道具和初始空间关系，不是静态图片的运动化。',
    `画面基础：${visualBasis}`,
    '动作设计：主体在前 2 秒内开始一个符合画面因果的明确动作链，依次发生视线确认、重心变化、手部或身体动作，并产生可见结果；同一动作只执行一次。',
    '运镜设计：摄影机在主体动作启动后再响应，保持空间轴线与主体尺度，完成后减速停稳，留下可剪辑的结束姿态。',
    '运动下限：禁止只用眨眼、呼吸、头发飘动、粒子、画面缩放或轻微推镜冒充主要动作；人物和道具不得复制、瞬移、变形或凭空增减。',
  ].join('\n')
}

/**
 * 图片镜头 → 视频镜头：
 * 建一个派生 video 节点，默认把分镜图作为构图/镜头意图参考，而不是锁死为视频首帧。
 * Seedance 等有多图 image_ref 的模型会据此进入全能参考；只有模型不支持全能参考或
 * 用户手动选了首帧模式时，分镜表输出层才会把边收窄为 first_frame。
 *
 * 语义要点：
 * - 视频节点**继承源图的镜号**（同一镜的两阶段——排片按视频镜位落在剧本位置 3 而非新号 13）；
 *   addNode 会先自动领新号，随即 updateNode 覆写回继承号（nextShotIndex 按 max 计算，空号无影响）。
 * - meta.sourceNodeId 指回源图 → 一键整理会把视频紧跟其源镜头摆放。
 * - 不写 modelKey：让 useNodeModelAutoSelect 的「modelKey 空时自动选默认视频模型」既有路径接管。
 * - 幂等：该图已转出过视频（存在 image→video 的构图/首帧出边）→ 返回已有节点 id，不重复建。
 *
 * 返回 { nodeId, existed }；UI 层据此吐 toast。纯 store 编排，可单测（store 可在测试里 setState 铺底）。
 */
export function convertImageShotToVideo(node: GenerationCanvasNode): { nodeId: string; existed: boolean } {
  const state = useGenerationCanvasStore.getState()
  const existing = state.nodes.find(
    (candidate) =>
      getGenerationNodeExecutionKind(candidate.kind) === 'video' &&
      state.edges.some((edge) => (
        edge.source === node.id
        && edge.target === candidate.id
        && (edge.mode === 'composition_ref' || edge.mode === 'first_frame')
      )),
  )
  if (existing) {
    state.selectNode(existing.id)
    return { nodeId: existing.id, existed: true }
  }
  const storyboardPrompt = storyboardPromptForImageNode(node, state.nodes)
  const video = state.addNode({
    kind: 'video',
    title: node.title ? i18n.t('generationCommon.shotConversion.videoTitle', { name: node.title }) : '',
    prompt: storyboardPrompt || compileImageShotFallbackVideoPrompt(node.prompt || ''),
    meta: {
      sourceNodeId: node.id,
      storyboardVideoReferenceStrategy: 'full_reference',
      storyboardVideoPromptSource: storyboardPrompt ? 'storyboard_plan' : 'compiled_image_fallback',
      ...(!storyboardPrompt ? { videoPromptNeedsReview: true } : {}),
    },
    position: { x: node.position.x + (node.size?.width ?? 320) + 80, y: node.position.y },
    ...(node.categoryId ? { categoryId: node.categoryId } : {}),
    select: true,
  })
  if (typeof node.shotIndex === 'number') {
    useGenerationCanvasStore.getState().updateNode(video.id, { shotIndex: node.shotIndex })
  }
  // 先把角色/场景/道具参考直接复制到视频节点，避免只通过分镜图递归继承时丢失
  // 参考语义和顺序；再把分镜图本身作为构图/镜头意图参考放在最后。
  for (const edge of state.edges.filter((edge) => edge.target === node.id)) {
    if (
      edge.mode === 'character_ref'
      || edge.mode === 'style_ref'
      || edge.mode === 'composition_ref'
      || edge.mode === 'reference'
    ) {
      useGenerationCanvasStore.getState().connectNodes(edge.source, video.id, edge.mode)
    }
  }
  useGenerationCanvasStore.getState().connectNodes(node.id, video.id, 'composition_ref')
  return { nodeId: video.id, existed: false }
}

export function isConvertibleImageShotNode(node: GenerationCanvasNode): boolean {
  return node.kind === 'image' && typeof node.shotIndex === 'number' && isShotNumberedNode(node)
}

export type ConvertImageShotsToVideosResult = {
  nodeIds: string[]
  created: number
  existing: number
  skipped: number
}

export function convertImageShotsToVideos(nodes: readonly GenerationCanvasNode[]): ConvertImageShotsToVideosResult {
  const nodeIds: string[] = []
  let created = 0
  let existing = 0
  let skipped = 0
  for (const node of nodes) {
    if (!isConvertibleImageShotNode(node)) {
      skipped += 1
      continue
    }
    const result = convertImageShotToVideo(node)
    nodeIds.push(result.nodeId)
    if (result.existed) existing += 1
    else created += 1
  }
  const uniqueNodeIds = Array.from(new Set(nodeIds))
  if (uniqueNodeIds.length > 0) {
    const state = useGenerationCanvasStore.getState()
    state.selectNode(uniqueNodeIds[0])
    for (const nodeId of uniqueNodeIds.slice(1)) state.selectNode(nodeId, true)
  }
  return { nodeIds: uniqueNodeIds, created, existing, skipped }
}
