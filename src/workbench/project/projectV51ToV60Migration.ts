/**
 * Migration v0.5.1 → v0.6.0
 *
 * 触发时机：projectPersistenceService.hydrateProject 里、projectCategoryMigration 之后。
 * 幂等：对已是 v0.6 的数据再跑一次不应改变结果。
 *
 * 变更：
 * 1. 节点 renderKind 补齐 — 按 categoryId 推断默认值（spec §5.1 决策 4）
 * 2. derivedFrom 语义分流 — 同分类源 → regeneratedFrom；不同分类源 → 保留为 derivedFrom；
 *    源不存在 → 清空（孤立副本，日志记录）（spec §5.3 + 决策 3）
 * 3. 分镜节点 shotIndex 修复/补齐 — 清掉参考卡误编号，按 storyboardPlan 纠偏，
 *    再只给真正的镜头内容节点补号（spec §6.4）
 * 4. 数组参考 meta→有序边 — 旧 meta.referenceImageUrls（有序、不画线）反查源节点建成
 *    有序 character_ref 边（audit 2026-06-16 §1d「数组参考收口到有序边」）；反查不到源的
 *    URL 保留在 meta，绝不丢已存参考。**这一步动 edges**。
 *
 * 注意：本 migration **不动** categoryId（projectCategoryMigration 已处理），不动 groups。
 * 旧持久化数据中不存在的字段保持 undefined，让 zod schema 在解析时 fallback。
 */
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { migrateReferenceImageUrlsToEdges } from '../generationCanvas/model/referenceImageUrlsToEdges'
import { isShotNumberedNode, nextShotIndex } from '../generationCanvas/model/shotNumbering'
import type { PlanShot, StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
import {
  BUILTIN_CATEGORIES,
  type NodeRenderKind,
} from './projectCategories'

const DEFAULT_RENDER_KIND_BY_CATEGORY: Record<string, NodeRenderKind> = (() => {
  const map: Record<string, NodeRenderKind> = {}
  for (const cat of BUILTIN_CATEGORIES) {
    map[cat.id] = cat.defaultNodeRenderKind
  }
  return map
})()

export type V51ToV60Diagnostic = {
  alreadyMigrated: boolean
  renderKindBackfilled: number
  derivedFromKeptCrossCategory: number
  derivedFromMovedToRegeneratedFrom: number
  derivedFromClearedOrphan: number
  shotIndicesAssigned: number
  /** 清掉旧迁移误写到角色/场景/参考卡上的 shotIndex。 */
  shotIndicesCleared: number
  /** 按 storyboardPlan + 标题镜号修正旧项目里被参考卡整体挤偏的 shotIndex。 */
  shotIndicesRepaired: number
  /** 数组参考 meta.referenceImageUrls 反查源建成的有序 character_ref 边数。 */
  referenceEdgesCreated: number
}

const EMPTY_DIAGNOSTIC: V51ToV60Diagnostic = {
  alreadyMigrated: true,
  renderKindBackfilled: 0,
  derivedFromKeptCrossCategory: 0,
  derivedFromMovedToRegeneratedFrom: 0,
  derivedFromClearedOrphan: 0,
  shotIndicesAssigned: 0,
  shotIndicesCleared: 0,
  shotIndicesRepaired: 0,
  referenceEdgesCreated: 0,
}

function inferRenderKind(categoryId: string | undefined): NodeRenderKind | undefined {
  if (!categoryId) return undefined
  return DEFAULT_RENDER_KIND_BY_CATEGORY[categoryId]
}

function titleShotIndex(node: GenerationCanvasNode): number | null {
  const match = String(node.title || '').match(/^镜头\s*([0-9]+)/)
  if (!match) return null
  const index = Number(match[1])
  return Number.isFinite(index) ? index : null
}

function compactPrompt(value: string | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function promptLooksLikePlanShot(node: GenerationCanvasNode, shot: PlanShot): boolean {
  const shotPrompt = compactPrompt(shot.prompt)
  if (!shotPrompt) return true
  const nodePrompt = compactPrompt(node.prompt)
  if (!nodePrompt) return true
  const probe = shotPrompt.slice(0, Math.min(40, shotPrompt.length))
  return Boolean(probe) && nodePrompt.includes(probe)
}

function repairIndexFromStoryboardTitle(
  node: GenerationCanvasNode,
  nodes: readonly GenerationCanvasNode[],
  plan: StoryboardPlan | null | undefined,
): number | null {
  if (!plan || !isShotNumberedNode(node)) return null
  const titleIndex = titleShotIndex(node)
  if (titleIndex === null || node.shotIndex === titleIndex) return null

  const shot = plan.shots.find((candidate) => candidate.index === titleIndex)
  if (!shot || !promptLooksLikePlanShot(node, shot)) return null

  // 已有可信节点占着这个镜号时，不把副本/变体强行折回原镜号。
  const hasTrustedOccupant = nodes.some(
    (candidate) =>
      candidate.id !== node.id &&
      isShotNumberedNode(candidate) &&
      candidate.shotIndex === titleIndex &&
      titleShotIndex(candidate) === titleIndex,
  )
  return hasTrustedOccupant ? null : titleIndex
}

function recordNeedsV51ToV60Migration(
  nodes: readonly GenerationCanvasNode[],
  storyboardPlan: StoryboardPlan | null | undefined,
): boolean {
  const derivedFromCandidates: GenerationCanvasNode[] = []
  for (const node of nodes) {
    if (!node.renderKind && inferRenderKind(node.categoryId)) return true
    if (isShotNumberedNode(node) && typeof node.shotIndex !== 'number') return true
    if (!isShotNumberedNode(node) && typeof node.shotIndex === 'number') return true
    if (repairIndexFromStoryboardTitle(node, nodes, storyboardPlan) !== null) return true
    if (node.derivedFrom && !node.regeneratedFrom) derivedFromCandidates.push(node)
  }
  if (!derivedFromCandidates.length) return false

  const categoryById = new Map<string, string | undefined>()
  for (const node of nodes) categoryById.set(node.id, node.categoryId)
  for (const node of derivedFromCandidates) {
    const sourceCategoryId = categoryById.get(node.derivedFrom || '')
    if (!sourceCategoryId || sourceCategoryId === node.categoryId) return true
  }
  return false
}

export function migrateProjectV51ToV60(record: WorkbenchProjectRecordV1): {
  record: WorkbenchProjectRecordV1
  diagnostic: V51ToV60Diagnostic
} {
  const canvas = record.payload?.generationCanvas
  if (!canvas || !Array.isArray(canvas.nodes) || canvas.nodes.length === 0) {
    return { record, diagnostic: EMPTY_DIAGNOSTIC }
  }
  const storyboardPlan = record.payload?.storyboardPlan
  if (!recordNeedsV51ToV60Migration(canvas.nodes as GenerationCanvasNode[], storyboardPlan)) {
    return { record, diagnostic: EMPTY_DIAGNOSTIC }
  }

  const nodesById = new Map<string, GenerationCanvasNode>()
  for (const node of canvas.nodes) {
    if (node && typeof node === 'object' && 'id' in node) {
      nodesById.set(node.id, node as GenerationCanvasNode)
    }
  }

  let renderKindBackfilled = 0
  let derivedFromKeptCrossCategory = 0
  let derivedFromMovedToRegeneratedFrom = 0
  let derivedFromClearedOrphan = 0
  let shotIndicesAssigned = 0
  let shotIndicesCleared = 0
  let shotIndicesRepaired = 0

  const upgradedNodes: GenerationCanvasNode[] = canvas.nodes.map((rawNode) => {
    const node = rawNode as GenerationCanvasNode
    let next: GenerationCanvasNode = node

    // 1. renderKind 补齐——kind 自带专属卡的节点（画板/声音/角色/场景）不吃分类默认值：
    //    盖章 shot-frame 会顶掉它们的专属 body（画板「打开」入口消失，2026-07-29 真机复现）。
    if (!next.renderKind && !['whiteboard', 'audio', 'character', 'scene'].includes(next.kind)) {
      const inferred = inferRenderKind(next.categoryId)
      if (inferred) {
        next = { ...next, renderKind: inferred }
        renderKindBackfilled += 1
      }
    }

    // 2. derivedFrom 语义分流
    if (next.derivedFrom && !next.regeneratedFrom) {
      const source = nodesById.get(next.derivedFrom)
      if (!source) {
        // 源已不存在 → 孤立副本，清空
        const { derivedFrom: _, ...rest } = next
        next = rest as GenerationCanvasNode
        derivedFromClearedOrphan += 1
      } else if (source.categoryId === next.categoryId) {
        // 同分类 → 移到 regeneratedFrom
        const { derivedFrom: prevSource, ...rest } = next
        next = { ...rest, regeneratedFrom: prevSource } as GenerationCanvasNode
        derivedFromMovedToRegeneratedFrom += 1
      } else {
        // 跨分类 → 保留 derivedFrom 语义（独立副本）
        derivedFromKeptCrossCategory += 1
      }
    }

    // 旧迁移曾只看 categoryId='shots'，把角色/场景/参考卡也写上 shotIndex。
    // 这些编号会把真正镜头整体挤偏，必须在后续补号/排片前清掉。
    if (!isShotNumberedNode(next) && typeof next.shotIndex === 'number') {
      const { shotIndex: _shotIndex, ...rest } = next
      next = rest as GenerationCanvasNode
      shotIndicesCleared += 1
    }

    return next
  })

  // 3a. storyboard 旧项目纠偏：真实镜头标题仍是「镜头 N」，但 shotIndex 被参考卡挤成 N+k。
  const repairedStoryboardNodes = upgradedNodes.map((node) => {
    const repairedIndex = repairIndexFromStoryboardTitle(node, upgradedNodes, storyboardPlan)
    if (repairedIndex === null) return node
    shotIndicesRepaired += 1
    return { ...node, shotIndex: repairedIndex }
  })

  // 3b. shotIndex 补齐（仅真正的镜头内容节点；参考卡不参与）
  const missingShotNodes = repairedStoryboardNodes
    .map((node, idx) => ({ node, idx }))
    .filter(({ node }) => isShotNumberedNode(node) && typeof node.shotIndex !== 'number')
    .sort((a, b) => {
      const ay = a.node.position?.y ?? 0
      const by = b.node.position?.y ?? 0
      if (ay !== by) return ay - by
      // tie-break by id for determinism
      return a.node.id.localeCompare(b.node.id)
    })

  let nextMissingShotIndex = nextShotIndex(repairedStoryboardNodes)
  missingShotNodes.forEach(({ node, idx }) => {
    repairedStoryboardNodes[idx] = { ...node, shotIndex: nextMissingShotIndex++ }
    shotIndicesAssigned += 1
  })

  // 4. 数组参考 meta.referenceImageUrls → 有序 character_ref 边（反查不到源的 URL 保留 meta）。
  const existingEdges = Array.isArray(canvas.edges) ? canvas.edges : []
  const refEdgeResult = migrateReferenceImageUrlsToEdges(repairedStoryboardNodes, existingEdges)
  const referenceEdgesCreated = refEdgeResult.edgesCreated
  // 节点 meta 被参考迁移改过（清掉已表达成边的 URL）——即便 edgesCreated=0（边已存在、纯去重）也算变化，
  // 否则 meta 残留的旧 URL 会和边重复显示。
  const referenceMetaChanged = refEdgeResult.nodes !== upgradedNodes

  const anyChange =
    renderKindBackfilled +
      derivedFromMovedToRegeneratedFrom +
      derivedFromClearedOrphan +
      shotIndicesAssigned +
      shotIndicesCleared +
      shotIndicesRepaired +
      referenceEdgesCreated >
      0 || referenceMetaChanged

  if (!anyChange) {
    return {
      record,
      diagnostic: derivedFromKeptCrossCategory > 0
        ? {
            ...EMPTY_DIAGNOSTIC,
            derivedFromKeptCrossCategory,
          }
        : EMPTY_DIAGNOSTIC,
    }
  }

  const upgradedRecord: WorkbenchProjectRecordV1 = {
    ...record,
    payload: {
      ...record.payload,
      generationCanvas: {
        ...canvas,
        // 参考迁移可能改了节点 meta（清掉已建边的 referenceImageUrls）+ 加了边。
        nodes: refEdgeResult.nodes,
        edges: refEdgeResult.edges,
      },
    },
  }

  return {
    record: upgradedRecord,
    diagnostic: {
      alreadyMigrated: false,
      renderKindBackfilled,
      derivedFromKeptCrossCategory,
      derivedFromMovedToRegeneratedFrom,
      derivedFromClearedOrphan,
      shotIndicesAssigned,
      shotIndicesCleared,
      shotIndicesRepaired,
      referenceEdgesCreated,
    },
  }
}
