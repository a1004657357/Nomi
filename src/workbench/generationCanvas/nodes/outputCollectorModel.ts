import i18n from "../../../i18n"
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationNodeResult,
} from '../model/generationCanvasTypes'

export type OutputCollectorItem = {
  id: string
  sourceNodeId: string
  title: string
  result: GenerationNodeResult & { url: string }
}

export function resolveOutputCollectorItems(
  collectorId: string,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): OutputCollectorItem[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return edges
    .filter((edge) => edge.target === collectorId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .flatMap((edge): OutputCollectorItem[] => {
      const source = byId.get(edge.source)
      const result = source?.result
      if (!source || !result?.url || !['image', 'video', 'audio', 'model3d'].includes(result.type)) return []
      return [{
        id: `${source.id}:${result.id}`,
        sourceNodeId: source.id,
        title: source.title || i18n.t("customWorkflow.output"),
        result: result as GenerationNodeResult & { url: string },
      }]
    })
}

export function resolveOutputCollectorSelection(
  node: Pick<GenerationCanvasNode, 'meta'>,
  items: readonly OutputCollectorItem[],
): Set<string> {
  const initialized = node.meta?.outputCollectorSelectionInitialized === true
  if (!initialized) return new Set(items.map((item) => item.id))
  const stored = Array.isArray(node.meta?.outputCollectorSelectedIds)
    ? node.meta.outputCollectorSelectedIds.filter((value): value is string => typeof value === 'string')
    : []
  const available = new Set(items.map((item) => item.id))
  return new Set(stored.filter((id) => available.has(id)))
}
