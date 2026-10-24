/**
 * Gate 2 Slice 3 — ShotSpec 投影便捷读取器（§11.2 read_* 工具的运行时支撑）。
 *
 * 对应目标架构 §11.2 只读工具集 + §11.4「Agent 重新读取当前对象」。
 *
 * 现状（Gate 0 §1.3/§1.6 证据）：Agent 的 read_canvas_state 返回裸画布节点（id/kind/title/prompt），
 * 没有 ShotSpec 视图；Agent 要理解镜头得自己从 PlanShot 扁平字段拼。本 Slice 提供**只读投影读取器**，
 * 把既有数据（画布节点 + storyboardPlan + history）派生成 ShotSpec / Film Bible 视图给 Agent 读。
 *
 * 设计（不破坏既有）：
 * - **纯函数、只读**：不修改画布/方案/节点。Agent 工具 read_shot_spec/read_storyboard/read_film_bible
 *   调用这些读取器，得到领域视图。
 * - **派生非复制**：ShotSpec 是 PlanShot + 画布节点的派生投影（Gate 1 planShotToShotSpec 的运行时入口），
 *   不成为第二份真相源（§4.3）。revision 状态从节点 history 的 revisionStatus 读。
 * - **保守降级**：缺数据（旧项目无 storyboardPlan / 节点无 history）返回空视图，不抛错。
 */
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { PlanAnchor, StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
import type { FilmBibleV1, ShotSpecV1 } from './cinematicTypes'
import { migrateStoryboardPlanShots, planShotToShotSpec } from './shotSpecMigration'

/** read_shot_spec / read_storyboard 的返回视图：ShotSpec + 当前选中 revision 摘要。 */
export type ShotSpecView = {
  spec: ShotSpecV1
  /** 当前选中的图片/视频 revision（从节点 history 的 revisionStatus=selected 派生）。 */
  selectedImageRevisionId?: string
  selectedVideoRevisionId?: string
  /** 该镜头对应画布节点 id（供 Agent 引用）。 */
  nodeId?: string
}

/**
 * 从 storyboardPlan + 画布节点投影出所有镜头的 ShotSpecView 列表。
 *
 * 镜头 id（shotSpecIdFromIndex）↔ 画布节点 id 的关联：迁移期按 shot index 匹配画布里
 * 的镜头类节点（kind=image/video/panorama）。找不到节点时 nodeId 为 undefined（仍返回 spec）。
 *
 * @param plan 项目分镜方案（旧项目可为 null → 返回空数组）。
 * @param nodes 画布节点（用于派生 revision 选中状态）。
 * @param projectId 项目 id（生成 ShotSpec 稳定 id）。
 */
export function readStoryboardAsShotSpecs(
  plan: StoryboardPlan | null | undefined,
  nodes: GenerationCanvasNode[],
  projectId: string,
): ShotSpecView[] {
  if (!plan || !plan.shots || plan.shots.length === 0) return []
  const anchorsById = new Map<string, PlanAnchor>(plan.anchors.map((a) => [a.id, a]))
  // 镜头节点候选：按画布位置/类别筛 image/video/panorama（排除 character/scene 等资产卡）
  const shotNodes = nodes.filter((n) => isShotLikeNode(n))
  return plan.shots.map((shot, i) => {
    const spec = planShotToShotSpec(shot, projectId, anchorsById, plan)
    // 按 index 关联画布节点（shotNumbering 的顺序约定：镜头节点按出现序对应 shot.index）
    const node = shotNodes[i]
    const view: ShotSpecView = { spec }
    if (node) {
      view.nodeId = node.id
      const selected = findSelectedRevision(node)
      if (selected) {
        if (shot.shotKind === 'image') view.selectedImageRevisionId = selected
        else view.selectedVideoRevisionId = selected
      }
    }
    return view
  })
}

/**
 * 读取单个镜头的 ShotSpecView（按 shotId 或 index）。
 * shotId 形如 `${projectId}:shot-${index}`（shotSpecIdFromIndex 约定）。
 */
export function readShotSpec(
  shotIdOrIndex: string | number,
  plan: StoryboardPlan | null | undefined,
  nodes: GenerationCanvasNode[],
  projectId: string,
): ShotSpecView | null {
  if (!plan || !plan.shots.length) return null
  const index = typeof shotIdOrIndex === 'number' ? shotIdOrIndex : parseShotIndex(shotIdOrIndex)
  if (index == null) return null
  const shot = plan.shots.find((s) => s.index === index)
  if (!shot) return null
  const all = readStoryboardAsShotSpecs(plan, nodes, projectId)
  return all.find((v) => v.spec.index === index) ?? null
}

/**
 * 派生项目级 Film Bible 视图（迁移期：从 storyboardPlan 的 anchors 派生最小 Film Bible）。
 * Gate 1 FilmBibleV1 类型就位；完整持久化字段（projectRecordSchema 接入）留 Slice 4。
 */
export function readFilmBibleView(
  plan: StoryboardPlan | null | undefined,
  projectId: string,
  projectMeta?: { aspectRatio?: string; fps?: number; targetDurationSeconds?: number },
): FilmBibleV1 | null {
  if (!plan) return null
  const characters = (plan.anchors ?? [])
    .filter((a) => a.kind === 'character')
    .map((a) => ({ assetId: a.id, name: a.name, relations: a.description }))
  const scenes = (plan.anchors ?? [])
    .filter((a) => a.kind === 'scene')
    .map((a) => ({ name: a.name, spatialRelation: a.description }))
  const props = (plan.anchors ?? [])
    .filter((a) => a.kind === 'prop')
    .map((a) => ({ name: a.name, state: a.description }))
  const styles = (plan.anchors ?? []).filter((a) => a.kind === 'style')
  return {
    version: 1,
    projectId,
    ...(characters.length > 0 ? { characters } : {}),
    ...(scenes.length > 0 ? { scenes } : {}),
    ...(props.length > 0 ? { props } : {}),
    ...(styles.length > 0 ? { photographyStrategy: styles.map((s) => s.name).join('；') } : {}),
    ...(projectMeta?.aspectRatio ? { aspectRatio: projectMeta.aspectRatio } : {}),
    ...(projectMeta?.fps ? { fps: projectMeta.fps } : {}),
    ...(projectMeta?.targetDurationSeconds ? { targetDurationSeconds: projectMeta.targetDurationSeconds } : {}),
  }
}

/**
 * 读取项目摘要（read_project_summary 的支撑）：节点数、分镜数、资产卡数、有结果的镜头数。
 */
export function readProjectSummary(
  plan: StoryboardPlan | null | undefined,
  nodes: GenerationCanvasNode[],
): {
  totalNodes: number
  shotCount: number
  assetCardCount: number
  shotsWithResult: number
} {
  const shotNodes = nodes.filter(isShotLikeNode)
  const assetCards = nodes.filter((n) => !isShotLikeNode(n) && n.kind !== 'text')
  const shotsWithResult = shotNodes.filter((n) => Boolean(n.result)).length
  return {
    totalNodes: nodes.length,
    shotCount: plan?.shots.length ?? shotNodes.length,
    assetCardCount: assetCards.length,
    shotsWithResult,
  }
}

// ── 辅助 ───────────────────────────────────────────────────────

function isShotLikeNode(node: GenerationCanvasNode): boolean {
  // 镜头类：image/video/panorama（character/scene/prop/text/model3d 不是镜头）
  return ['image', 'video', 'panorama'].includes(node.kind)
}

/** 从节点 history 找当前 selected revision 的 id（Gate 1 Slice 3 revisionStatus 字段）。 */
function findSelectedRevision(node: GenerationCanvasNode): string | undefined {
  const history = node.history ?? []
  // 显式 selected
  const explicit = history.find((h) => h.revisionStatus === 'selected')
  if (explicit) return explicit.id
  // 节点 result 指向的即当前选中（迁移期：无 revisionStatus 时 result 指针 = selected）
  return node.result?.id
}

/** 解析 shotId（形如 `proj-1:shot-7` 或 `shot-7`）→ index（7）。 */
function parseShotIndex(shotId: string): number | null {
  const match = shotId.match(/shot-(\d+)$/)
  if (!match) return null
  const n = Number.parseInt(match[1], 10)
  return Number.isFinite(n) ? n : null
}

// 防止未用 import 警告（migrateStoryboardPlanShots 供批量和未来 Slice 4 用）
void migrateStoryboardPlanShots
