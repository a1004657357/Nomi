import type { GenerationCanvasNode, GenerationNodeResult } from './generationCanvasTypes'

export type NodeResultLifecyclePatch = Pick<GenerationCanvasNode, 'result' | 'history' | 'status' | 'error'>

export function resultIdentity(result: GenerationNodeResult): string {
  return String(
    result.id ||
      result.url ||
      result.thumbnailUrl ||
      result.assetRefId ||
      result.assetId ||
      result.text ||
      '',
  )
}

function isMediaResult(result: GenerationNodeResult | undefined): result is GenerationNodeResult {
  if (!result || (result.type !== 'image' && result.type !== 'video')) return false
  return Boolean(String(result.url || result.thumbnailUrl || '').trim())
}

function listNodeResults(node: Pick<GenerationCanvasNode, 'result' | 'history'>): GenerationNodeResult[] {
  const results: GenerationNodeResult[] = []
  const seen = new Set<string>()
  for (const result of [node.result, ...(node.history ?? [])]) {
    if (!result) continue
    const identity = resultIdentity(result)
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    results.push(result)
  }
  return results
}

export function listNodeMediaResults(node: Pick<GenerationCanvasNode, 'result' | 'history'>): GenerationNodeResult[] {
  return listNodeResults(node).filter(isMediaResult)
}

export function promoteNodeResult(
  node: Pick<GenerationCanvasNode, 'result' | 'history'>,
  identity: string,
): NodeResultLifecyclePatch | null {
  const results = listNodeResults(node)
  const nextResult = results.find((result) => resultIdentity(result) === identity)
  if (!nextResult || !isMediaResult(nextResult)) return null
  const ordered = [nextResult, ...results.filter((result) => resultIdentity(result) !== identity)]
  return {
    result: nextResult,
    history: ordered,
    status: 'success',
    error: undefined,
  }
}

export function removeNodeResult(
  node: Pick<GenerationCanvasNode, 'result' | 'history'>,
  identity: string,
): NodeResultLifecyclePatch | null {
  const results = listNodeResults(node)
  const target = results.find((result) => resultIdentity(result) === identity)
  if (!target || !isMediaResult(target)) return null
  const remaining = results.filter((result) => resultIdentity(result) !== identity)
  if (remaining.length === 0) {
    return { result: undefined, history: [], status: 'idle', error: undefined }
  }
  const currentIdentity = node.result ? resultIdentity(node.result) : ''
  const currentResult = currentIdentity && currentIdentity !== identity
    ? remaining.find((result) => resultIdentity(result) === currentIdentity)
    : undefined
  const nextResult = currentResult ?? remaining.find(isMediaResult)
  if (!nextResult) {
    return { result: undefined, history: remaining, status: 'idle', error: undefined }
  }
  return {
    result: nextResult,
    history: [nextResult, ...remaining.filter((result) => resultIdentity(result) !== resultIdentity(nextResult))],
    status: 'success',
    error: undefined,
  }
}
