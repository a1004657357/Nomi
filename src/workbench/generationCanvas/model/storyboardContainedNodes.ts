import type { GenerationCanvasEdge, GenerationCanvasNode } from './generationCanvasTypes'

export type StoryboardContainedRole = 'image' | 'video'

export type StoryboardContainedMetaInput = {
  tableNodeId: string
  rowIndex: number
  role: StoryboardContainedRole
  expanded?: boolean
}

function metaRecord(meta: GenerationCanvasNode['meta']): Record<string, unknown> {
  return meta && typeof meta === 'object' ? meta : {}
}

export function storyboardContainedMeta(
  input: StoryboardContainedMetaInput,
): Record<string, unknown> {
  return {
    storyboardContainedByNodeId: input.tableNodeId,
    storyboardContainedRowIndex: input.rowIndex,
    storyboardContainedRole: input.role,
    storyboardContainedExpanded: Boolean(input.expanded),
  }
}

export function withStoryboardContainedMeta(
  meta: GenerationCanvasNode['meta'],
  input: StoryboardContainedMetaInput,
): Record<string, unknown> {
  return {
    ...metaRecord(meta),
    ...storyboardContainedMeta(input),
  }
}

export function storyboardContainerNodeId(node: Pick<GenerationCanvasNode, 'meta'>): string {
  const value = metaRecord(node.meta).storyboardContainedByNodeId
  return typeof value === 'string' ? value : ''
}

export function storyboardContainedRowIndex(node: Pick<GenerationCanvasNode, 'meta'>): number | null {
  const value = metaRecord(node.meta).storyboardContainedRowIndex
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function storyboardContainedRole(node: Pick<GenerationCanvasNode, 'meta'>): StoryboardContainedRole | null {
  const value = metaRecord(node.meta).storyboardContainedRole
  return value === 'image' || value === 'video' ? value : null
}

export function isStoryboardContainedNode(node: Pick<GenerationCanvasNode, 'meta'>): boolean {
  return Boolean(storyboardContainerNodeId(node))
}

export function isStoryboardContainedNodeExpanded(node: Pick<GenerationCanvasNode, 'meta'>): boolean {
  return metaRecord(node.meta).storyboardContainedExpanded === true
}

export function isStoryboardContainedNodeHidden(node: Pick<GenerationCanvasNode, 'meta'>): boolean {
  return isStoryboardContainedNode(node) && !isStoryboardContainedNodeExpanded(node)
}

export function shouldRenderEdgeInStoryboardContainment(
  edge: Pick<GenerationCanvasEdge, 'source' | 'target'>,
  nodesById: ReadonlyMap<string, Pick<GenerationCanvasNode, 'meta'>>,
): boolean {
  const source = nodesById.get(edge.source)
  const target = nodesById.get(edge.target)
  if (!source || !target) return false
  return !isStoryboardContainedNodeHidden(source) && !isStoryboardContainedNodeHidden(target)
}
