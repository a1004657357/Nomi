import {
  storyboardShotImagePrompt,
  storyboardShotVideoPrompt,
  type PlanAnchor,
  type PlanShot,
  type StoryboardPlan,
} from '../../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../../generationCanvas/model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../../generationCanvas/model/generationNodeKinds'
import { isShotNumberedNode } from '../../generationCanvas/model/shotNumbering'

export type StoryboardScriptReference = {
  nodeId: string
  title: string
  url: string
}

export type StoryboardScriptRow = {
  shot: PlanShot
  title: string
  anchors: PlanAnchor[]
  nodes: GenerationCanvasNode[]
  imageNode: GenerationCanvasNode | null
  videoNode: GenerationCanvasNode | null
  primaryNode: GenerationCanvasNode | null
  primaryUrl: string
  primaryType: GenerationNodeResult['type'] | null
  references: StoryboardScriptReference[]
  status: 'generated' | 'running' | 'error' | 'pending'
}

export function generationResultUrl(result: GenerationNodeResult | undefined): string {
  return String(result?.url || result?.thumbnailUrl || result?.providerUrl || '').trim()
}

export function hasStoryboardScriptSource(
  plan: StoryboardPlan | null | undefined,
  nodes: readonly GenerationCanvasNode[],
): boolean {
  return Boolean(plan?.shots.length) || sortedShotNodes(nodes).length > 0
}

function isImageNode(node: GenerationCanvasNode): boolean {
  return getGenerationNodeExecutionKind(node.kind) === 'image'
}

function isVideoNode(node: GenerationCanvasNode): boolean {
  return getGenerationNodeExecutionKind(node.kind) === 'video'
}

function hasResult(node: GenerationCanvasNode | null | undefined): boolean {
  return Boolean(generationResultUrl(node?.result))
}

function resultCreatedAt(node: GenerationCanvasNode): number {
  const createdAt = Number(node.result?.createdAt)
  if (Number.isFinite(createdAt)) return createdAt
  const provenanceAt = Number(node.result?.provenance?.timestamp)
  return Number.isFinite(provenanceAt) ? provenanceAt : 0
}

function pickNodeWithResult(nodes: GenerationCanvasNode[]): GenerationCanvasNode | null {
  const generated = nodes.filter(hasResult)
  if (generated.length === 0) return nodes[0] ?? null
  return generated.reduce((latest, candidate) => (
    resultCreatedAt(candidate) > resultCreatedAt(latest) ? candidate : latest
  ))
}

function rowStatus(nodes: readonly GenerationCanvasNode[]): StoryboardScriptRow['status'] {
  if (nodes.some(hasResult)) return 'generated'
  if (nodes.some((node) => node.status === 'queued' || node.status === 'running')) return 'running'
  if (nodes.some((node) => node.status === 'error')) return 'error'
  return 'pending'
}

function nodeShotIndex(node: GenerationCanvasNode): number | null {
  if (typeof node.shotIndex === 'number' && Number.isFinite(node.shotIndex)) return node.shotIndex
  return nodeTitleShotIndex(node)
}

function nodeTitleShotIndex(node: GenerationCanvasNode): number | null {
  const titleMatch = String(node.title || '').match(/镜头\s*([0-9]+)/)
  if (titleMatch) return Number(titleMatch[1])
  return null
}

function compactPrompt(value: string | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function promptLooksLikeShot(node: GenerationCanvasNode, shot: PlanShot): boolean {
  const probes = Array.from(
    new Set([storyboardShotImagePrompt(shot), storyboardShotVideoPrompt(shot), shot.prompt].map(compactPrompt).filter(Boolean)),
  )
  if (probes.length === 0) return true
  const nodePrompt = compactPrompt(node.prompt)
  if (!nodePrompt) return true
  return probes.some((prompt) => {
    const probe = prompt.slice(0, Math.min(40, prompt.length))
    return Boolean(probe) && nodePrompt.includes(probe)
  })
}

function nodeShotIndexForPlan(
  node: GenerationCanvasNode,
  planShotByIndex: ReadonlyMap<number, PlanShot>,
  nodes: readonly GenerationCanvasNode[],
  planIndexByShotId?: ReadonlyMap<string, number>,
): number | null {
  const stableId = typeof node.meta?.shotId === 'string' ? node.meta.shotId.trim() : ''
  const stableIndex = planIndexByShotId?.get(stableId)
  if (stableIndex !== undefined) return stableIndex
  if (node.regeneratedFrom) {
    const source = nodes.find((candidate) => candidate.id === node.regeneratedFrom)
    const sourceTitleIndex = source ? nodeTitleShotIndex(source) : null
    if (sourceTitleIndex !== null && planShotByIndex.has(sourceTitleIndex)) return sourceTitleIndex
  }
  const titleIndex = nodeTitleShotIndex(node)
  if (titleIndex !== null) {
    const shot = planShotByIndex.get(titleIndex)
    const hasTrustedOccupant = nodes.some(
      (candidate) =>
        candidate.id !== node.id &&
        isShotNumberedNode(candidate) &&
        candidate.shotIndex === titleIndex &&
        nodeTitleShotIndex(candidate) === titleIndex,
    )
    if (shot && !hasTrustedOccupant && promptLooksLikeShot(node, shot)) return titleIndex
  }
  return nodeShotIndex(node)
}

function sortedShotNodes(
  nodes: readonly GenerationCanvasNode[],
  planShotByIndex: ReadonlyMap<number, PlanShot> = new Map(),
  planIndexByShotId?: ReadonlyMap<string, number>,
): GenerationCanvasNode[] {
  return nodes
    .filter((node) => isShotNumberedNode(node) || (isImageNode(node) && node.meta?.storyboardKeyframe === true))
    .sort((a, b) => {
      const ai = nodeShotIndexForPlan(a, planShotByIndex, nodes, planIndexByShotId)
      const bi = nodeShotIndexForPlan(b, planShotByIndex, nodes, planIndexByShotId)
      if (ai !== null && bi !== null && ai !== bi) return ai - bi
      if (ai !== null && bi === null) return -1
      if (ai === null && bi !== null) return 1
      const ay = a.position?.y ?? 0
      const by = b.position?.y ?? 0
      if (ay !== by) return ay - by
      const ax = a.position?.x ?? 0
      const bx = b.position?.x ?? 0
      if (ax !== bx) return ax - bx
      return a.id.localeCompare(b.id)
    })
}

function collectReferences(
  targets: readonly GenerationCanvasNode[],
  nodesById: ReadonlyMap<string, GenerationCanvasNode>,
  edges: readonly GenerationCanvasEdge[],
): StoryboardScriptReference[] {
  const targetIds = new Set(targets.map((node) => node.id))
  const seen = new Set<string>()
  const refs: StoryboardScriptReference[] = []
  for (const edge of edges) {
    if (!targetIds.has(edge.target)) continue
    const source = nodesById.get(edge.source)
    const url = generationResultUrl(source?.result)
    if (!source || !url || seen.has(source.id)) continue
    seen.add(source.id)
    refs.push({
      nodeId: source.id,
      title: source.title || '参考图',
      url,
    })
  }
  return refs
}

export function buildStoryboardScriptRows(
  plan: StoryboardPlan | null,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): StoryboardScriptRow[] {
  const anchorById = new Map((plan?.anchors ?? []).map((anchor) => [anchor.id, anchor]))
  const planShotByIndex = new Map((plan?.shots ?? []).map((shot) => [shot.index, shot]))
  const planIndexByShotId = new Map((plan?.shots ?? []).map((shot) => [shot.shotId?.trim() || `shot-${shot.index}`, shot.index]))
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const shotNodesByIndex = new Map<number, GenerationCanvasNode[]>()

  const orderedCanvasShotNodes = sortedShotNodes(nodes, planShotByIndex, planIndexByShotId)
  let fallbackIndex = 1
  for (const node of orderedCanvasShotNodes) {
    const index = nodeShotIndexForPlan(node, planShotByIndex, nodes, planIndexByShotId) ?? fallbackIndex++
    const current = shotNodesByIndex.get(index) ?? []
    current.push(node)
    shotNodesByIndex.set(index, current)
  }

  const shots: PlanShot[] = plan
    ? [...plan.shots]
    : [...shotNodesByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, shotNodes]) => {
        const primary = pickNodeWithResult(shotNodes.filter(isImageNode)) ?? pickNodeWithResult(shotNodes)
        const isVideoShot = Boolean(primary && isVideoNode(primary))
        return {
          index,
          shotKind: isVideoShot ? 'video' : 'image',
          durationSec: isVideoShot && typeof primary?.result?.durationSeconds === 'number' ? primary.result.durationSeconds : 0,
          anchorIds: [],
          prompt: primary?.prompt || '',
          imagePrompt: isVideoShot ? '' : primary?.prompt || '',
          videoPrompt: isVideoShot ? primary?.prompt || '' : '',
        }
      })

  return shots
    .sort((a, b) => a.index - b.index)
    .map((shot) => {
      const shotNodes = shotNodesByIndex.get(shot.index) ?? []
      const imageNode = pickNodeWithResult(shotNodes.filter(isImageNode))
      const videoNode = pickNodeWithResult(shotNodes.filter(isVideoNode))
      const primaryNode = hasResult(imageNode) ? imageNode : hasResult(videoNode) ? videoNode : pickNodeWithResult(shotNodes)
      const primaryUrl = generationResultUrl(primaryNode?.result)
      return {
        shot,
        title: shotNodes[0]?.title || `镜头 ${shot.index}`,
        anchors: shot.anchorIds.map((id) => anchorById.get(id)).filter((anchor): anchor is PlanAnchor => Boolean(anchor)),
        nodes: shotNodes,
        imageNode,
        videoNode,
        primaryNode,
        primaryUrl,
        primaryType: primaryNode?.result?.type ?? null,
        references: collectReferences(shotNodes, nodesById, edges),
        status: rowStatus(shotNodes),
      }
    })
}
