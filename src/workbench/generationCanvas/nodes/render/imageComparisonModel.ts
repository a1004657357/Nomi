import i18n from "../../../../i18n"
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
} from '../../model/generationCanvasTypes'

export type ImageComparisonInput = {
  nodeId: string
  title: string
  url: string
}

function imageUrl(node: GenerationCanvasNode): string {
  if (node.result?.type !== 'image') return ''
  return node.result.url || node.result.thumbnailUrl || node.result.providerUrl || ''
}

export function resolveImageComparisonInputs(
  targetNodeId: string,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): ImageComparisonInput[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  return edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.target === targetNodeId)
    .sort((a, b) => {
      const ao = a.edge.order ?? Number.POSITIVE_INFINITY
      const bo = b.edge.order ?? Number.POSITIVE_INFINITY
      return ao === bo ? a.index - b.index : ao - bo
    })
    .map(({ edge }) => nodeById.get(edge.source))
    .filter((node): node is GenerationCanvasNode => Boolean(node))
    .map((node) => ({
      nodeId: node.id,
      title: node.title || i18n.t("customWorkflow.image"),
      url: imageUrl(node),
    }))
    .filter((input) => Boolean(input.url))
    .slice(0, 2)
}
