import { connectNodes, type CanvasSnapshot, type ConnectionSpec } from './canvasGraph'

function resultAssetUrls(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const result = value as Record<string, unknown>
  const urls = [result.url, result.thumbnailUrl, result.providerUrl]
    .filter((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()))
    .map((candidate) => candidate.trim())
  if (Array.isArray(result.alternatives)) {
    for (const alternative of result.alternatives) urls.push(...resultAssetUrls(alternative))
  }
  return urls
}

function nodeAssetUrls(node: CanvasSnapshot['nodes'][number]): string[] {
  const urls = [
    ...(typeof node.url === 'string' && node.url.trim() ? [node.url.trim()] : []),
    ...resultAssetUrls(node.result),
  ]
  if (Array.isArray(node.history)) {
    for (const historyItem of node.history) urls.push(...resultAssetUrls(historyItem))
  }
  return Array.from(new Set(urls))
}

/**
 * 显式参考 URL 既是 Provider 输入，也是画布血缘。只有 URL 在同一画布中唯一命中来源节点时才自动连边；
 * 多节点共享同一资产时保持 references 但不猜来源，避免把复制节点误认成原始资产。
 */
export function bindReferencesToNode(snapshot: CanvasSnapshot, nodeId: string, references: string[]): CanvasSnapshot {
  const normalizedReferences = Array.from(new Set(references.map((value) => value.trim()).filter(Boolean)))
  if (!normalizedReferences.length) return snapshot
  const nodes = snapshot.nodes.map((node) => (
    node.id === nodeId ? { ...node, references: normalizedReferences } : node
  ))
  let next: CanvasSnapshot = { ...snapshot, nodes }
  const connections: ConnectionSpec[] = []
  for (const reference of normalizedReferences) {
    const sourceIds = nodes
      .filter((node) => node.id !== nodeId && nodeAssetUrls(node).includes(reference))
      .map((node) => node.id)
    if (sourceIds.length === 1) connections.push({ source: sourceIds[0], target: nodeId, mode: 'reference' })
  }
  if (connections.length) next = connectNodes(next, connections).snapshot
  return next
}
