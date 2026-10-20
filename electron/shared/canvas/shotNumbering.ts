/** Shot numbers are stable domain identities, shared by renderer, headless writes and Agent reads. */
export type ShotNumberedNode = {
  id: string
  kind: string
  categoryId?: string
  meta?: Record<string, unknown>
  shotIndex?: number
  position?: { x: number; y: number }
}
type ShotEdge = { source: string; target: string; mode?: string }
export type ShotIdentity = {
  shotIndex?: number
  shotRole?: 'first_frame' | 'video' | 'image'
  shotOwnerNodeIds?: string[]
}
const SHOT_NUMBERED_KINDS = new Set(['image', 'video', 'shot', 'keyframe'])

export function isValidShotIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function isShotNumberedNode(node: Pick<ShotNumberedNode, 'kind' | 'categoryId' | 'meta'>): boolean {
  return (node.categoryId ?? 'shots') === 'shots' && SHOT_NUMBERED_KINDS.has(node.kind)
    && node.meta?.referenceSheet !== true && node.meta?.storyboardKeyframe !== true && node.meta?.excludeFromShotNumbering !== true
}

export function nextShotIndex(nodes: readonly Partial<ShotNumberedNode>[]): number {
  const max = nodes.reduce((value, node) => typeof node.kind === 'string' && isShotNumberedNode({ ...node, kind: node.kind })
    && isValidShotIndex(node.shotIndex) ? Math.max(value, node.shotIndex) : value, 0)
  if (max === Number.MAX_SAFE_INTEGER) throw new RangeError('Shot number space exhausted')
  return max + 1
}

function convertedShotTargets(nodes: readonly ShotNumberedNode[], edges: readonly ShotEdge[]): Map<string, Set<string>> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const targets = new Map<string, Set<string>>()
  for (const edge of edges) {
    const source = byId.get(edge.source)
    const video = byId.get(edge.target)
    if (!source || source.kind !== 'image' || (source.categoryId ?? 'shots') !== 'shots' || source.meta?.referenceSheet === true
      || video?.kind !== 'video' || !isShotNumberedNode(video) || video.meta?.sourceNodeId !== source.id
      || (edge.mode !== 'composition_ref' && edge.mode !== 'first_frame')) continue
    const ids = targets.get(source.id) ?? new Set<string>()
    ids.add(video.id)
    targets.set(source.id, ids)
  }
  return targets
}

/** Clone relationships only within the copied graph; never retain a source-project node ID. */
export function remapShotNodeReferences<T extends ShotNumberedNode>(node: T, ids: ReadonlyMap<string, string>): T {
  if (!node.meta) return node
  const { storyboardVideoOwnerNodeId: legacyOwner, ...meta } = node.meta
  if (node.kind === 'video' && typeof meta.sourceNodeId === 'string') {
    const source = ids.get(meta.sourceNodeId)
    if (source) meta.sourceNodeId = source
    else delete meta.sourceNodeId
  }
  if (legacyOwner !== undefined && node.kind === 'image') meta.excludeFromShotNumbering = true
  return { ...node, meta }
}

/** Preserve the first valid owner; repair missing/invalid/conflicting identities deterministically. */
export function backfillShotIndexes<T extends ShotNumberedNode>(input: readonly T[], edges: readonly ShotEdge[] = []): { nodes: T[]; changed: boolean } {
  // Migrate old conversion graphs before duplicate-number repair can separate the two stages.
  let nodes = input.map(node => {
    if (!node.meta || !('storyboardVideoOwnerNodeId' in node.meta)) return node
    const { storyboardVideoOwnerNodeId: _legacy, ...meta } = node.meta
    return { ...node, meta: { ...meta, ...(node.kind === 'image' ? { excludeFromShotNumbering: true } : {}) } }
  })
  const targets = convertedShotTargets(nodes, edges)
  const inherited = new Map<string, number>()
  for (const source of nodes) {
    const ids = targets.get(source.id)
    if (ids?.size !== 1 || !isValidShotIndex(source.shotIndex)) continue
    const target = [...ids][0]
    if (!nodes.some(node => node.id !== source.id && node.id !== target && !targets.has(node.id)
      && isShotNumberedNode(node) && node.shotIndex === source.shotIndex)) inherited.set(target, source.shotIndex)
  }
  nodes = nodes.map(node => {
    const meta = targets.has(node.id) && !node.meta?.excludeFromShotNumbering && !node.meta?.storyboardKeyframe
      ? { ...node.meta, excludeFromShotNumbering: true } : node.meta
    const shotIndex = inherited.get(node.id) ?? node.shotIndex
    return meta !== node.meta || shotIndex !== node.shotIndex ? { ...node, meta, shotIndex } : node
  })
  const used = new Set<number>()
  const pending: { node: T; index: number }[] = []
  const owners = nodes.filter(isShotNumberedNode)
  nodes.forEach((node, index) => {
    if (!isShotNumberedNode(node)) return
    if (isValidShotIndex(node.shotIndex) && !used.has(node.shotIndex)) used.add(node.shotIndex)
    else pending.push({ node, index })
  })
  // Number repair must remain idempotent even when an imported graph has duplicate IDs.
  // Array positions identify individual entries without deciding which graph node to discard.
  const assigned = new Map<number, number>()
  if (pending.length) {
    let next = nextShotIndex(owners)
    pending.sort(({ node: a }, { node: b }) => (a.position?.y ?? 0) - (b.position?.y ?? 0) ||
      (a.position?.x ?? 0) - (b.position?.x ?? 0) || a.id.localeCompare(b.id))
    for (const { index } of pending) {
      if (!Number.isSafeInteger(next)) throw new RangeError('Shot number space exhausted')
      assigned.set(index, next++)
    }
  }
  let changed = nodes.some((node, index) => node !== input[index])
  const result = nodes.map((node, index) => {
    const number = isShotNumberedNode(node) ? assigned.get(index) ?? node.shotIndex : undefined
    if (node.shotIndex === number) return node
    changed = true
    if (number !== undefined) return { ...node, shotIndex: number }
    const { shotIndex: _removed, ...rest } = node
    return rest as T
  })
  return { nodes: result, changed }
}

/** A clone is a new owner, even if the old owner was deleted. Paired frames derive their label from edges. */
export function assignClonedShotIndexes<T extends ShotNumberedNode>(existing: readonly T[], incoming: readonly T[], edges: readonly ShotEdge[] = []): T[] {
  let next: number | undefined
  const unnumbered = incoming.map(({ shotIndex: _old, ...node }) => node as T)
  return backfillShotIndexes(unnumbered, edges).nodes.map(node => {
    const { shotIndex: _old, ...rest } = node
    if (!isShotNumberedNode(node)) return rest as T
    next ??= nextShotIndex(existing)
    if (!Number.isSafeInteger(next)) throw new RangeError('Shot number space exhausted')
    return { ...rest, shotIndex: next++ } as T
  })
}

/** No numbering side effects in a reader. Multiple frame owners stay explicit, never guessed. */
export function resolveShotIdentities(nodes: readonly ShotNumberedNode[], edges: readonly ShotEdge[]): Map<string, ShotIdentity> {
  const identities = new Map<string, ShotIdentity>()
  const convertedTargets = convertedShotTargets(nodes, edges)
  const owners = new Map(nodes.filter(node => isShotNumberedNode(node) && isValidShotIndex(node.shotIndex)).map(node => [node.id, node]))
  const frameTargets = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (edge.mode !== 'first_frame' || owners.get(edge.target)?.kind !== 'video') continue
    const targets = frameTargets.get(edge.source) ?? new Set<string>()
    targets.add(edge.target)
    frameTargets.set(edge.source, targets)
  }
  for (const node of nodes) {
    if ((node.categoryId ?? 'shots') !== 'shots' || node.meta?.referenceSheet === true) continue
    const converted = convertedTargets.get(node.id)
    if ((node.meta?.storyboardKeyframe === true || node.meta?.excludeFromShotNumbering === true || converted)
      && (node.kind === 'image' || node.kind === 'keyframe')) {
      const frames = [...(frameTargets.get(node.id) ?? [])]
      const ids = [...new Set([...frames, ...(converted ?? [])])].filter(id => owners.has(id))
      const firstFrame = frames.length > 0 || (node.meta?.storyboardKeyframe === true && !converted?.size)
      identities.set(node.id, { shotRole: firstFrame ? 'first_frame' : 'image', shotOwnerNodeIds: ids,
        ...(ids.length === 1 ? { shotIndex: owners.get(ids[0])!.shotIndex } : {}) })
    } else if (owners.has(node.id)) {
      identities.set(node.id, { shotIndex: node.shotIndex, shotRole: node.kind === 'video' ? 'video' : 'image' })
    }
  }
  return identities
}

/** Only identity edits need whole-batch numbering; prompt/runtime edits retain compact events. */
export function changesShotIdentity(node: Pick<ShotNumberedNode, 'meta'>, patch: Partial<ShotNumberedNode>): boolean {
  return 'shotIndex' in patch || 'kind' in patch || 'categoryId' in patch ||
    ('meta' in patch && (patch.meta?.referenceSheet !== node.meta?.referenceSheet || patch.meta?.storyboardKeyframe !== node.meta?.storyboardKeyframe || patch.meta?.excludeFromShotNumbering !== node.meta?.excludeFromShotNumbering
      || patch.meta?.sourceNodeId !== node.meta?.sourceNodeId || patch.meta?.storyboardVideoOwnerNodeId !== node.meta?.storyboardVideoOwnerNodeId))
}
