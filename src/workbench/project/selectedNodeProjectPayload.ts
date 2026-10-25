import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationCanvasSnapshot,
  NodeGroup,
} from '../generationCanvas/model/generationCanvasTypes'
import { createDefaultWorkbenchProjectPayload, type WorkbenchProjectPayload } from './projectRecordSchema'

const TARGET_ORIGIN = { x: 240, y: 180 }

export type SelectedNodeProjectPayloadResult = {
  payload: WorkbenchProjectPayload
  nodeCount: number
  edgeCount: number
  groupCount: number
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function normalizeNodePositions(nodes: GenerationCanvasNode[], groups: NodeGroup[]): void {
  if (!nodes.length) return
  const minX = Math.min(...nodes.map((node) => node.position.x))
  const minY = Math.min(...nodes.map((node) => node.position.y))
  const dx = Math.round(TARGET_ORIGIN.x - minX)
  const dy = Math.round(TARGET_ORIGIN.y - minY)
  if (dx === 0 && dy === 0) return
  for (const node of nodes) {
    node.position = {
      x: Math.round(node.position.x + dx),
      y: Math.round(node.position.y + dy),
    }
  }
  for (const group of groups) {
    if (!group.frameBounds) continue
    group.frameBounds = {
      ...group.frameBounds,
      x: Math.round(group.frameBounds.x + dx),
      y: Math.round(group.frameBounds.y + dy),
    }
  }
}

function selectedCanvasSnapshot(
  source: GenerationCanvasSnapshot,
  selectedNodeIds: readonly string[],
): GenerationCanvasSnapshot | null {
  const ids = uniqueIds(selectedNodeIds)
  const selected = new Set(ids)
  if (!selected.size) return null

  const nodes = cloneJson(source.nodes.filter((node) => selected.has(node.id)))
  if (!nodes.length) return null

  const edges = cloneJson(
    (source.edges || []).filter((edge) => selected.has(edge.source) && selected.has(edge.target)),
  ) as GenerationCanvasEdge[]
  const groups = cloneJson(
    (source.groups || [])
      .map((group) => ({
        ...group,
        nodeIds: group.nodeIds.filter((nodeId) => selected.has(nodeId)),
      }))
      .filter((group) => group.nodeIds.length > 0),
  ) as NodeGroup[]
  const groupIds = new Set(groups.map((group) => group.id))
  for (const node of nodes) {
    if (node.groupId && !groupIds.has(node.groupId)) delete node.groupId
  }
  normalizeNodePositions(nodes, groups)
  return {
    nodes,
    edges,
    groups,
    selectedNodeIds: [],
  }
}

export function buildSelectedNodeProjectPayload(
  sourcePayload: WorkbenchProjectPayload,
  selectedNodeIds: readonly string[],
): SelectedNodeProjectPayloadResult | null {
  const generationCanvas = selectedCanvasSnapshot(sourcePayload.generationCanvas, selectedNodeIds)
  if (!generationCanvas) return null
  const defaults = createDefaultWorkbenchProjectPayload()
  const payload: WorkbenchProjectPayload = {
    ...defaults,
    categories: sourcePayload.categories ?? defaults.categories,
    generationCanvas,
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  }
  return {
    payload,
    nodeCount: generationCanvas.nodes.length,
    edgeCount: generationCanvas.edges.length,
    groupCount: generationCanvas.groups?.length ?? 0,
  }
}

export function defaultSelectedNodeProjectName(sourceProjectName: string | null | undefined, mode: 'copy' | 'move'): string {
  const base = String(sourceProjectName || '').trim() || '未命名项目'
  return `${base} · ${mode === 'move' ? '移出节点' : '复制节点'}`
}
