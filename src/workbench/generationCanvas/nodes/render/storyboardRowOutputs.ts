import { convertImageShotToVideo } from '../../agent/convertShotToVideo'
import { resolveStoryboardVideoDefault } from '../../agent/availableModels'
import {
  parseStoryboardPlan,
  storyboardShotImagePrompt,
  storyboardShotVideoPrompt,
  type PlanShot,
  type StoryboardPlan,
} from '../../agent/storyboardPlan'
import { resolveKeyframeParams, resolveShotParams } from '../../agent/storyboardShotScope'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../../model/generationNodeKinds'
import { STORYBOARD_TABLE_MIN_CONTENT_WIDTH } from '../../model/storyboardTableSizing'
import {
  isStoryboardContainedNodeExpanded,
  storyboardContainedRole,
  storyboardContainedRowIndex,
  storyboardContainerNodeId,
  withStoryboardContainedMeta,
  type StoryboardContainedRole,
} from '../../model/storyboardContainedNodes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { resolveArchetypeForModel } from '../controls/archetypeMeta'

const ROW_STRIDE = 220
const OUTPUT_NODE_GAP = 80
const OUTPUT_NODE_WIDTH = 320

type EnsureRowOutputInput = {
  tableNode: GenerationCanvasNode
  shot: PlanShot
  imageNode?: GenerationCanvasNode | null
  videoNode?: GenerationCanvasNode | null
  expanded?: boolean
  resolveVideoDefault?: () => Promise<{ modelKey?: string; modeId?: string }>
}

export type StoryboardRowImageOutput = {
  nodeId: string
  node: GenerationCanvasNode
  created: boolean
}

export type StoryboardRowVideoOutput = {
  nodeId: string
  node: GenerationCanvasNode
  imageNodeId: string
  created: boolean
  imageCreated: boolean
}

export function storyboardRowOutputPosition(
  tableNode: GenerationCanvasNode,
  shotIndex: number,
  role: StoryboardContainedRole,
): { x: number; y: number } {
  const tableWidth = tableNode.size?.width ?? STORYBOARD_TABLE_MIN_CONTENT_WIDTH
  const imageX = tableNode.position.x + tableWidth + OUTPUT_NODE_GAP
  return {
    x: imageX + (role === 'video' ? OUTPUT_NODE_WIDTH + OUTPUT_NODE_GAP : 0),
    y: tableNode.position.y + 48 + (Math.max(1, shotIndex) - 1) * ROW_STRIDE,
  }
}

function currentNode(candidate?: GenerationCanvasNode | null): GenerationCanvasNode | null {
  if (!candidate) return null
  return useGenerationCanvasStore.getState().nodes.find((node) => node.id === candidate.id) || null
}

function metaRecord(node: Pick<GenerationCanvasNode, 'meta'>): Record<string, unknown> {
  return node.meta && typeof node.meta === 'object' ? node.meta : {}
}

function isOutputRole(node: GenerationCanvasNode, role: StoryboardContainedRole): boolean {
  return getGenerationNodeExecutionKind(node.kind) === role
}

function isLegacyRowOutput(
  node: GenerationCanvasNode,
  tableNodeId: string,
  rowIndex: number,
  role: StoryboardContainedRole,
): boolean {
  const meta = metaRecord(node)
  return meta.sourceStoryboardTableNodeId === tableNodeId
    && meta.storyboardRowIndex === rowIndex
    && isOutputRole(node, role)
}

function findOwnedOutput(
  tableNodeId: string,
  rowIndex: number,
  role: StoryboardContainedRole,
): GenerationCanvasNode | null {
  const nodes = useGenerationCanvasStore.getState().nodes
  return nodes.find((node) => (
    storyboardContainerNodeId(node) === tableNodeId
    && storyboardContainedRowIndex(node) === rowIndex
    && storyboardContainedRole(node) === role
  )) || nodes.find((node) => isLegacyRowOutput(node, tableNodeId, rowIndex, role)) || null
}

function fallbackOutput(
  candidate: GenerationCanvasNode | null | undefined,
  tableNodeId: string,
  rowIndex: number,
  role: StoryboardContainedRole,
): GenerationCanvasNode | null {
  const node = currentNode(candidate)
  if (!node || !isOutputRole(node, role)) return null
  const owner = storyboardContainerNodeId(node)
  if (owner && (
    owner !== tableNodeId
    || storyboardContainedRowIndex(node) !== rowIndex
    || storyboardContainedRole(node) !== role
  )) return null
  const meta = metaRecord(node)
  const legacyOwner = typeof meta.sourceStoryboardTableNodeId === 'string'
    ? meta.sourceStoryboardTableNodeId
    : ''
  if (legacyOwner && (
    legacyOwner !== tableNodeId
    || meta.storyboardRowIndex !== rowIndex
  )) return null
  return node
}

function rowOutputMeta(
  tableNode: GenerationCanvasNode,
  shot: PlanShot,
  targetMeta: GenerationCanvasNode['meta'],
  role: StoryboardContainedRole,
  expanded: boolean,
): Record<string, unknown> {
  return {
    ...withStoryboardContainedMeta(targetMeta, {
      tableNodeId: tableNode.id,
      rowIndex: shot.index,
      role,
      expanded,
    }),
    sourceStoryboardTableNodeId: tableNode.id,
    storyboardRowIndex: shot.index,
    storyboardRowOutputRole: role,
  }
}

function markRowOutput(
  tableNode: GenerationCanvasNode,
  shot: PlanShot,
  target: GenerationCanvasNode,
  role: StoryboardContainedRole,
  expanded: boolean,
): GenerationCanvasNode {
  const store = useGenerationCanvasStore.getState()
  store.updateNode(target.id, {
    meta: rowOutputMeta(tableNode, shot, target.meta, role, expanded),
    position: storyboardRowOutputPosition(tableNode, shot.index, role),
    shotIndex: shot.index,
  })
  return useGenerationCanvasStore.getState().nodes.find((node) => node.id === target.id) || target
}

const VIDEO_MODEL_META_KEYS = [
  'modelVendor',
  'vendor',
  'modelLabel',
  'videoModelVendor',
] as const

function rowPlan(tableNode: GenerationCanvasNode, shot: PlanShot): StoryboardPlan {
  const snapshot = currentNode(tableNode)?.meta?.storyboardPlanSnapshot
    ?? tableNode.meta?.storyboardPlanSnapshot
  return snapshot
    ? parseStoryboardPlan(snapshot)
    : { title: '', anchors: [], shots: [shot] }
}

function withResolvedParams(target: Pick<GenerationCanvasNode, 'meta'>, params: Record<string, unknown>): Record<string, unknown> {
  const next = { ...metaRecord(target) }
  const previousParamKeys = Array.isArray(next.storyboardAppliedParamKeys)
    ? next.storyboardAppliedParamKeys.filter((key): key is string => typeof key === 'string')
    : []
  for (const key of previousParamKeys) delete next[key]

  Object.assign(next, params)
  next.storyboardAppliedParamKeys = Object.keys(params)
  return next
}

function videoMetaForShot(target: GenerationCanvasNode, shot: PlanShot, params: Record<string, unknown>): Record<string, unknown> {
  const next = withResolvedParams(target, params)

  if (Number.isFinite(shot.durationSec)) {
    next.duration = shot.durationSec
    next.durationSeconds = shot.durationSec
    next.videoDuration = shot.durationSec
  }

  const modelKey = String(shot.modelKey || '').trim()
  const previousModelKey = String(next.modelKey || '').trim()
  const previousArchetype = previousModelKey
    ? resolveArchetypeForModel({
        modelKey: previousModelKey,
        vendorKey: String(next.modelVendor || next.vendor || '') || null,
      })
    : null
  const modelChanged = Boolean(modelKey && previousModelKey && previousModelKey !== modelKey)
  if (modelKey) {
    if (modelChanged) {
      for (const key of VIDEO_MODEL_META_KEYS) delete next[key]
      delete next.archetype
      if (previousArchetype && previousArchetype.kind !== 'video') {
        for (const mode of previousArchetype.modes) {
          for (const control of mode.params) delete next[control.key]
        }
        delete next.duration
        delete next.durationSeconds
        delete next.videoDuration
      }
    }
    next.modelKey = modelKey
    next.modelAlias = modelKey
    next.videoModel = modelKey
  }

  const effectiveModelKey = modelKey || previousModelKey
  const resolved = resolveArchetypeForModel({
    modelKey: effectiveModelKey,
    modelAlias: String(next.modelAlias || ''),
    vendorKey: String(next.modelVendor || next.vendor || '') || null,
    meta: next,
  })
  if (resolved) {
    const currentArchetype = next.archetype && typeof next.archetype === 'object'
      ? next.archetype as Record<string, unknown>
      : {}
    const supportsImageInput = (mode: (typeof resolved.modes)[number]): boolean => (
      mode.slots.some((slot) => slot.kind === 'first_frame' || slot.kind === 'image_ref')
    )
    const supportsFullReference = (mode: (typeof resolved.modes)[number]): boolean => (
      mode.slots.some((slot) => slot.kind === 'image_ref' && (slot.max ?? Infinity) > 1)
    )
    const requestedModeId = String(shot.modeId || '').trim()
    const requestedMode = resolved.modes.find((mode) => mode.id === requestedModeId && supportsImageInput(mode))
    const currentMode = !modelChanged && currentArchetype.id === resolved.id
      ? resolved.modes.find((mode) => mode.id === currentArchetype.modeId && supportsImageInput(mode))
      : undefined
    const referenceMode = requestedMode
      || currentMode
      || resolved.modes.find(supportsFullReference)
      || resolved.modes.find(supportsImageInput)
      || resolved.modes.find((mode) => mode.id === requestedModeId)
      || resolved.modes.find((mode) => mode.id === resolved.defaultModeId)
      || resolved.modes[0]
    if (referenceMode) {
      const preserveVariant = !modelChanged && typeof currentArchetype.variantId === 'string'
        ? { variantId: currentArchetype.variantId }
        : {}
      next.archetype = {
        id: resolved.id,
        modeId: referenceMode.id,
        ...preserveVariant,
      }
    }
  }
  return next
}

function selectedVideoMode(target: GenerationCanvasNode) {
  const meta = metaRecord(target)
  const resolved = resolveArchetypeForModel({
    modelKey: String(meta.modelKey || ''),
    modelAlias: String(meta.modelAlias || ''),
    vendorKey: String(meta.modelVendor || meta.vendor || '') || null,
    meta,
  })
  if (!resolved) return null
  const archetypeMeta = meta.archetype && typeof meta.archetype === 'object'
    ? meta.archetype as Record<string, unknown>
    : {}
  const modeId = String(archetypeMeta.modeId || '')
  return resolved.modes.find((mode) => mode.id === modeId)
    || resolved.modes.find((mode) => mode.id === resolved.defaultModeId)
    || resolved.modes[0]
    || null
}

function syncStoryboardReferenceEdges(imageNodeId: string, videoNodeId: string): void {
  const store = useGenerationCanvasStore.getState()
  const video = store.nodes.find((node) => node.id === videoNodeId)
  if (!video) return
  const mode = selectedVideoMode(video)
  // image_ref 并不等于全能参考。AGNES 的 i2v 也是 image_ref，但 max=1，API 只接收
  // 一张首帧图；把它误判成全能参考会让角色卡先占掉唯一输入，真正的分镜图反而不发送。
  const fullReference = Boolean(mode?.slots.some((slot) => slot.kind === 'image_ref' && (slot.max ?? Infinity) > 1))
  const imageEdge = store.edges.find((edge) => (
    edge.source === imageNodeId
    && edge.target === videoNodeId
    && (edge.mode === 'first_frame' || edge.mode === 'composition_ref')
  ))
  const targetMode = fullReference ? 'composition_ref' : 'first_frame'
  if (imageEdge && imageEdge.mode !== targetMode) {
    store.updateEdgeMode(imageEdge.id, targetMode)
  } else if (!imageEdge) {
    store.connectNodes(imageNodeId, videoNodeId, targetMode)
  }

  if (fullReference) {
    // 全能参考要直接收到角色、场景和道具，不能只通过分镜图的祖先关系碰运气。
    // 保留原边语义，确保上传顺序和后续 @图片N 的用途说明都可追溯。
    const imageInputs = useGenerationCanvasStore.getState().edges.filter((edge) => edge.target === imageNodeId)
    for (const edge of imageInputs) {
      if (
        edge.mode === 'character_ref'
        || edge.mode === 'style_ref'
        || edge.mode === 'composition_ref'
        || edge.mode === 'reference'
      ) {
        useGenerationCanvasStore.getState().connectNodes(edge.source, videoNodeId, edge.mode)
      }
    }
  }
  const current = useGenerationCanvasStore.getState().nodes.find((node) => node.id === videoNodeId)
  if (current) {
    useGenerationCanvasStore.getState().updateNode(videoNodeId, {
      meta: {
        ...metaRecord(current),
        storyboardVideoReferenceStrategy: fullReference ? 'full_reference' : 'first_frame',
      },
    })
  }
}

function syncVideoOutput(target: GenerationCanvasNode, shot: PlanShot, params: Record<string, unknown>): GenerationCanvasNode {
  useGenerationCanvasStore.getState().updateNode(target.id, {
    title: `镜头 ${shot.index} · 视频`,
    shotIndex: shot.index,
    meta: videoMetaForShot(target, shot, params),
  })
  return useGenerationCanvasStore.getState().nodes.find((node) => node.id === target.id) || target
}

export function ensureStoryboardRowImageOutput(input: EnsureRowOutputInput): StoryboardRowImageOutput {
  const store = useGenerationCanvasStore.getState()
  const existing = findOwnedOutput(input.tableNode.id, input.shot.index, 'image')
    || fallbackOutput(input.imageNode, input.tableNode.id, input.shot.index, 'image')
  const prompt = storyboardShotImagePrompt(input.shot)
  const plan = rowPlan(input.tableNode, input.shot)
  const params = input.shot.shotKind === 'image'
    ? resolveShotParams(plan, input.shot)
    : resolveKeyframeParams(plan, input.shot)
  if (existing) {
    if (existing.prompt !== prompt) store.updateNodePrompt(existing.id, prompt)
    const expanded = input.expanded ?? isStoryboardContainedNodeExpanded(existing)
    store.updateNode(existing.id, { meta: withResolvedParams(existing, params) })
    const synced = useGenerationCanvasStore.getState().nodes.find(node => node.id === existing.id) || existing
    const node = markRowOutput(input.tableNode, input.shot, synced, 'image', expanded)
    return { nodeId: node.id, node, created: false }
  }

  const created = store.addNode({
    kind: 'image',
    title: `镜头 ${input.shot.index} · 图片`,
    prompt,
    position: storyboardRowOutputPosition(input.tableNode, input.shot.index, 'image'),
    categoryId: input.tableNode.categoryId || 'shots',
    select: false,
    exactPosition: true,
    meta: rowOutputMeta(input.tableNode, input.shot, withResolvedParams({}, params), 'image', Boolean(input.expanded)),
  })
  useGenerationCanvasStore.getState().updateNode(created.id, { shotIndex: input.shot.index })
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === created.id) || created
  return { nodeId: node.id, node, created: true }
}

export async function ensureStoryboardRowVideoOutput(input: EnsureRowOutputInput): Promise<StoryboardRowVideoOutput> {
  const store = useGenerationCanvasStore.getState()
  let existing = findOwnedOutput(input.tableNode.id, input.shot.index, 'video')
    || fallbackOutput(input.videoNode, input.tableNode.id, input.shot.index, 'video')
  const existingIdBeforeDefault = existing?.id || ''
  const existingModelKey = String(existing?.meta?.modelKey || existing?.meta?.modelAlias || existing?.meta?.videoModel || '').trim()
  // 图片分镜行里的 modelKey/modeId/params 属于图片生成。视频设置现在由提取出来的
  // video 节点独立管理，不能再用 codex-img2/2K 等图片配置覆盖 Agnes/Seedance。
  // 旧计划没 shotKind 时仍按视频计划处理，保持既有兼容语义。
  const usesStoryboardVideoSettings = (input.shot.shotKind ?? 'video') !== 'image'
  const requestedModelKey = usesStoryboardVideoSettings ? String(input.shot.modelKey || '').trim() : ''
  const requestedArchetype = requestedModelKey
    ? resolveArchetypeForModel({ modelKey: requestedModelKey, vendorKey: null })
    : null
  const usableRequestedModelKey = requestedArchetype?.kind && requestedArchetype.kind !== 'video'
    ? ''
    : requestedModelKey
  const existingArchetype = existingModelKey
    ? resolveArchetypeForModel({
        modelKey: existingModelKey,
        vendorKey: String(existing?.meta?.modelVendor || existing?.meta?.vendor || '') || null,
      })
    : null
  const usableExistingModelKey = existingArchetype?.kind && existingArchetype.kind !== 'video'
    ? ''
    : existingModelKey
  const needsDefault = !usableRequestedModelKey && !usableExistingModelKey
  const defaults = needsDefault
    ? await (input.resolveVideoDefault || resolveStoryboardVideoDefault)()
    : {}
  if (!useGenerationCanvasStore.getState().nodes.some((node) => node.id === input.tableNode.id)) {
    throw new Error('分镜项目已切换，请在当前项目重新操作')
  }
  const currentState = useGenerationCanvasStore.getState()
  const refreshedExisting = findOwnedOutput(input.tableNode.id, input.shot.index, 'video')
    || fallbackOutput(input.videoNode, input.tableNode.id, input.shot.index, 'video')
  if (existingIdBeforeDefault && !currentState.nodes.some((node) => node.id === existingIdBeforeDefault) && !refreshedExisting) {
    throw new Error('分镜视频节点已变化，请重新操作')
  }
  existing = refreshedExisting
  if (needsDefault && !defaults.modelKey) {
    throw new Error('当前没有已连接且支持图片参考的图生视频模型，请先在「模型接入」中连接一个可用模型')
  }
  const shot: PlanShot = usesStoryboardVideoSettings && usableRequestedModelKey
    ? input.shot
    : {
        ...input.shot,
        modelKey: needsDefault ? defaults.modelKey : undefined,
        modeId: needsDefault ? defaults.modeId : undefined,
        params: undefined,
        // 图片分镜自身没有视频时长；保留视频节点里用户选过的值或模型默认值。
        durationSec: Number.NaN,
      }
  const image = ensureStoryboardRowImageOutput({
    ...input,
    expanded: input.expanded,
  })
  // The row image is a paired frame, not a second owner of the video's shot number.
  store.updateNode(image.nodeId, { meta: { ...image.node.meta, storyboardKeyframe: true } })
  const prompt = storyboardShotVideoPrompt(shot)
  const params = usesStoryboardVideoSettings && (!requestedArchetype || requestedArchetype.kind === 'video')
    ? resolveShotParams(rowPlan(input.tableNode, input.shot), input.shot)
    : {}

  if (existing) {
    if (existing.prompt !== prompt) store.updateNodePrompt(existing.id, prompt)
    const expanded = input.expanded ?? isStoryboardContainedNodeExpanded(existing)
    const synced = syncVideoOutput(
      useGenerationCanvasStore.getState().nodes.find((node) => node.id === existing.id) || existing,
      shot,
      params,
    )
    const node = markRowOutput(input.tableNode, shot, synced, 'video', expanded)
    syncStoryboardReferenceEdges(image.nodeId, node.id)
    const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id) || node
    return { nodeId: current.id, node: current, imageNodeId: image.nodeId, created: false, imageCreated: image.created }
  }

  const converted = convertImageShotToVideo(image.node)
  useGenerationCanvasStore.getState().updateNodePrompt(converted.nodeId, prompt)
  const video = useGenerationCanvasStore.getState().nodes.find((node) => node.id === converted.nodeId)
  if (!video) throw new Error('视频节点创建失败')
  const synced = syncVideoOutput(video, shot, params)
  const node = markRowOutput(input.tableNode, shot, synced, 'video', Boolean(input.expanded))
  syncStoryboardReferenceEdges(image.nodeId, node.id)
  const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id) || node
  return {
    nodeId: current.id,
    node: current,
    imageNodeId: image.nodeId,
    created: !converted.existed,
    imageCreated: image.created,
  }
}
