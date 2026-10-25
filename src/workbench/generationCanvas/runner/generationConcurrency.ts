import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const DEFAULT_BATCH_CONCURRENCY = 6
const MAX_BATCH_CONCURRENCY = 8
export const CODEX_IMG2_MAX_CONCURRENCY = 2

function readMetaString(meta: Record<string, unknown> | undefined, key: string): string {
  const value = meta?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeGenerationConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BATCH_CONCURRENCY
  return Math.max(1, Math.min(MAX_BATCH_CONCURRENCY, Math.floor(value)))
}

export function isCodexImg2Node(node: GenerationCanvasNode | undefined): boolean {
  const meta = node?.meta
  const vendor =
    readMetaString(meta, 'modelVendor') || readMetaString(meta, 'vendor') || readMetaString(meta, 'imageModelVendor')
  const modelKey =
    readMetaString(meta, 'modelKey') || readMetaString(meta, 'modelAlias') || readMetaString(meta, 'imageModel')
  return vendor === 'codex' || modelKey === 'codex-img2' || modelKey === 'codex-imagegen-img2'
}

export function generationBatchConcurrency(
  nodeIds: readonly string[],
  nodes: readonly GenerationCanvasNode[],
  requested: unknown,
): number {
  void nodeIds
  void nodes
  // Provider-specific limits are enforced by the global scheduler. Keeping the
  // batch worker count independent prevents one Codex node from throttling KIE,
  // AGNES, or other providers in the same selection.
  return normalizeGenerationConcurrency(requested)
}
