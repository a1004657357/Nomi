import { canvasSourceDefaults, generationModeRationale } from '../../../electron/shared/canvas/sourceDefaults'
/**
 * Slice 2 — PlanShot ↔ ShotSpecV1 适配层（迁移起点，双向兼容）。
 *
 * 对应 Gate 1 实施计划 Slice 2。目标架构 §9.1 的 `ShotSpecV1` 是镜头唯一真相源（P1），
 * 但既有 `PlanShot`（`storyboardPlan.ts:39-96`）是迁移起点且被 270+ 测试与落画布转换器依赖。
 *
 * 策略（来自 Gate 0 证据 + 计划）：
 * - **不破坏 PlanShot**：既有扁平字段（shotSize/cameraAngle/cameraMove/characters/performance/...）
 *   全部保留，成为 ShotSpec 子对象的"扁平别名"。
 * - **投影而非复制真相**：`planShotToShotSpec` 把扁平字段**派生**进 ShotSpec 子对象
 *   （shotSize→cinematography.shotScale、cameraMove→cinematography.cameraMotion.type、
 *   characters/performance/dialogue→subjects[]、anchorIds→references）。
 *   ShotSpec 是**派生产物**，不成为第二份独立真相（避免 §4.3 平行真相源）。
 * - **旧项目无损打开**：迁移函数对缺失字段给安全默认（空数组/undefined），不抛错。
 * - **round-trip 等价**：`planShotToShotSpec → shotSpecToPlanShotPlanFields` 往返不丢扁平字段。
 *
 * 集成点：`projectNormalize.ts:123` 的 `storyboardPlan` 归一化处可调用
 * `migrateStoryboardPlanShots` 让旧项目加载即迁移（见本文件末导出）。
 */
import type { PlanAnchor, PlanShot, StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
import { resolveShotParams } from '../generationCanvas/agent/storyboardShotScope'
import type {
  GenerationMode,
  GenerationStrategyV1,
  MediaKind,
  ReferenceBindingV1,
  ReferenceRole,
  ShotSpecV1,
  ShotStatus,
} from './cinematicTypes'

// ─────────────────────────────────────────────────────────────────────────────
// 单镜投影：PlanShot → ShotSpecV1
// ─────────────────────────────────────────────────────────────────────────────

/** 旧 PlanShot 无稳定 id → 按 index 生成确定性 id（迁移期约定）。 */
export function shotSpecIdFromIndex(index: number, projectId?: string): string {
  return projectId ? `${projectId}:shot-${index}` : `shot-${index}`
}

/**
 * PlanShot.shotKind → ShotSpec.mediaKind（image/video）。
 * 注：PlanShot.shotKind 缺省按 'video' 兜底（见 storyboardPlan.ts 注释），但目标架构
 * 区分 image/video；迁移期尊重既有兜底。
 */
function mediaKindFromShot(shot: PlanShot): MediaKind {
  return shot.shotKind === 'image' ? 'image' : 'video'
}

/**
 * PlanShot 的 modelKey/variantId/modeId + 是否有 keyframe → GenerationMode（§15.4 规则）。
 * 迁移期近似推断（无显式 mode 字段）；Gate 3 起 Provider Compiler 精确决定。
 */
function inferGenerationMode(shot: PlanShot): GenerationMode {
  const kind = mediaKindFromShot(shot)
  if (kind === 'image') {
    // 图片镜头：有锚参考 → image-to-image，否则 text-to-image
    return shot.anchorIds.length > 0 ? 'image-to-image' : 'text-to-image'
  }
  // 视频镜头
  if (shot.keyframe?.enabled) return 'first-frame'
  if (shot.anchorIds.length > 0) return 'omni-reference'
  return 'text-to-video'
}

function inferGenerationStrategy(shot: PlanShot, plan: StoryboardPlan): GenerationStrategyV1 {
  const mode = inferGenerationMode(shot)
  const rationale = generationModeRationale(mode)
  const strategy: GenerationStrategyV1 = {
    mediaKind: mediaKindFromShot(shot),
    mode,
    rationale,
  }
  if (shot.modelKey) strategy.modelKey = shot.modelKey
  if (shot.modelKey && shot.modelVendor) strategy.vendorKey = shot.modelVendor
  if (shot.variantId) strategy.variantId = shot.variantId
  if (shot.modeId) strategy.overrides = { modeId: shot.modeId }
  const params = resolveShotParams(plan, shot)
  if (Object.keys(params).length > 0) {
    strategy.overrides = { ...(strategy.overrides ?? {}), ...params }
  }
  return strategy
}


/**
 * PlanShot.anchorIds → ReferenceBindingV1[]。
 * 需锚类型信息（PlanAnchor.kind → role）。找不到锚定义的 anchorId 退化为 'reference'。
 */
function referencesFromAnchors(shot: PlanShot, anchorsById: Map<string, PlanAnchor>): ReferenceBindingV1[] {
  return shot.anchorIds.map((assetId) => {
    const anchor = anchorsById.get(assetId)
    const role: ReferenceRole = anchor ? anchorKindToRole(anchor.kind) : 'reference'
    return {
      assetId,
      role,
      required: anchor?.scope === 'all',
    }
  })
}

function anchorKindToRole(kind: PlanAnchor['kind']): ReferenceRole {
  switch (kind) {
    case 'character':
      return 'character_ref'
    case 'scene':
      return 'style_ref'
    case 'prop':
      return 'reference'
    case 'style':
      return 'style_ref'
    default:
      return 'reference'
  }
}

/**
 * PlanShot.characters/performance/dialogue → subjects[]。
 * 旧字段是自由文本；迁移期近似拆分（逗号/顿号）。
 */
function subjectsFromShot(shot: PlanShot): ShotSpecV1['subjects'] {
  const text = (shot.characters ?? '').trim()
  if (!text) {
    // 仍有 performance/dialogue 时给一个空主体的槽
    if (!(shot.performance ?? '').trim() && !(shot.dialogue ?? '').trim()) return []
    return [{ role: 'primary', performance: shot.performance, dialogue: shot.dialogue }]
  }
  const names = text.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
  return names.map((name, i) => ({
    assetId: undefined, // 旧 PlanShot 无 assetId 概念
    role: i === 0 ? ('primary' as const) : ('secondary' as const),
    performance: i === 0 ? shot.performance : undefined,
    dialogue: i === 0 ? shot.dialogue : undefined,
  }))
}

/** 推断镜头状态（迁移期：未生成=draft，已落画布的由节点 status 驱动，此处只给初始）。 */
function inferShotStatus(shot: PlanShot): ShotStatus {
  // PlanShot 无生成态字段；迁移期一律 draft，Slice 3 起由 revision 状态驱动
  void shot
  return 'draft'
}

/**
 * 把一个 PlanShot 投影成 ShotSpecV1。
 * projectId 用于生成稳定 id；anchorsById 用于把 anchorIds 翻译成有 role 的 references。
 */
export function planShotToShotSpec(
  shot: PlanShot,
  projectId: string,
  anchorsById: Map<string, PlanAnchor>,
  plan: StoryboardPlan = { title: '', anchors: [], shots: [shot] },
): ShotSpecV1 {
  return {
    version: 1,
    id: shotSpecIdFromIndex(shot.index, projectId),
    projectId,
    index: shot.index,
    title: shot.scene ?? canvasSourceDefaults.shotTitle(shot.index),
    narrative: {},
    time: {
      durationSeconds: shot.shotKind === 'image' ? 0 : shot.durationSec,
    },
    subjects: subjectsFromShot(shot),
    environment: {
      propAssetIds: [],
      costumeAssetIds: [],
      spatialRelations: [],
      ...(shot.scene ? { sceneAssetId: undefined } : {}),
    },
    cinematography: {
      ...(shot.shotSize ? { shotScale: shot.shotSize } : {}),
      ...(shot.cameraAngle ? { cameraAngle: shot.cameraAngle } : {}),
      cameraMotion: {
        ...(shot.cameraMove ? { type: shot.cameraMove } : {}),
      },
    },
    actionChain: [],
    sound: {
      ...(shot.dialogue ? { dialogue: shot.dialogue } : {}),
      ...(shot.sound ? { ambience: shot.sound } : {}),
      sfx: [],
    },
    continuity: [],
    references: referencesFromAnchors(shot, anchorsById),
    generationStrategy: inferGenerationStrategy(shot, plan),
    acceptanceCriteria: [],
    status: inferShotStatus(shot),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 反向投影：ShotSpec 子字段 → PlanShot 扁平字段（round-trip 守恒）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把 ShotSpec 的结构化字段**回填**到既有 PlanShot 的扁平字段（就地合并）。
 * 用于用户在 ShotSpec 视图编辑后，同步回 PlanShot（落画布转换器仍读扁平字段）。
 * 只覆盖 ShotSpec 里非空的字段；PlanShot 既有的扁平字段不被 undefined 覆盖。
 */
export function mergeShotSpecIntoPlanShot(shot: PlanShot, spec: ShotSpecV1): PlanShot {
  const merged: PlanShot = { ...shot }
  if (spec.cinematography.shotScale) merged.shotSize = spec.cinematography.shotScale
  if (spec.cinematography.cameraAngle) merged.cameraAngle = spec.cinematography.cameraAngle
  if (spec.cinematography.cameraMotion.type) merged.cameraMove = spec.cinematography.cameraMotion.type
  const primary = spec.subjects.find((s) => s.role === 'primary')
  if (primary) {
    if (primary.performance) merged.performance = primary.performance
    if (primary.dialogue) merged.dialogue = primary.dialogue
  }
  const subjectNames = spec.subjects.map((s) => s.assetId ?? '').filter(Boolean)
  if (subjectNames.length > 0) merged.characters = subjectNames.join('，')
  if (spec.sound.dialogue) merged.dialogue = spec.sound.dialogue
  if (spec.sound.ambience) merged.sound = spec.sound.ambience
  if (spec.time.durationSeconds && spec.time.durationSeconds > 0) {
    merged.durationSec = spec.time.durationSeconds
  }
  const strategy = spec.generationStrategy
  if (strategy.modelKey) {
    const identityChanged = strategy.modelKey !== shot.modelKey
      || Boolean(strategy.vendorKey && strategy.vendorKey !== shot.modelVendor)
    if (identityChanged) {
      delete merged.modelVendor
      delete merged.variantId
    }
    merged.modelKey = strategy.modelKey
    if (strategy.vendorKey) merged.modelVendor = strategy.vendorKey
    if (strategy.variantId) merged.variantId = strategy.variantId
  }
  return merged
}

// ─────────────────────────────────────────────────────────────────────────────
// 批量迁移：StoryboardPlan → anchorsById + shots → ShotSpec[]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 给一个 StoryboardPlan 的所有 shots 计算 ShotSpec 投影。
 * 不修改原 plan（纯函数）；返回 index → ShotSpec 映射，供 normalize 期持久化或 UI 读。
 */
export function migrateStoryboardPlanShots(
  plan: StoryboardPlan,
  projectId: string,
): Map<number, ShotSpecV1> {
  const anchorsById = new Map<string, PlanAnchor>(plan.anchors.map((a) => [a.id, a]))
  const result = new Map<number, ShotSpecV1>()
  for (const shot of plan.shots) {
    result.set(shot.index, planShotToShotSpec(shot, projectId, anchorsById, plan))
  }
  return result
}
