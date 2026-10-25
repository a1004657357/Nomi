/**
 * 电影级领域模型 v1 的 zod schema（目标架构 §9）。
 *
 * 与 `./cinematicTypes.ts` 手写类型**同形并存**：手写类型带字段级 JSDoc（语义文档，z.infer 会丢），
 * zod schema 负责运行时校验/持久化往返（round-trip）。下方编译期漂移守卫保证二者互相赋值兼容，
 * 防 schema 与类型漂移——沿用 `storyboardPlan.ts:187-190` 既有模式（P1 单一真相源的轻量落地）。
 *
 * 迁移期策略（Slice 1）：所有 schema 宽松——除 id/version/index 外字段尽量 optional，
 * 让既有 PlanShot/GenerationNodeResult 可无损 parse。严格的"必填"约束在各 Slice 迁移稳定后收紧。
 */
import { z } from 'zod'
import { ASSET_REVISION_STATUSES, SHOT_STATUSES } from './cinematicTypes'
import type {
  AssetRevisionKind,
  AssetRevisionStatus,
  AssetRevisionV1,
  ContinuityConstraintV1,
  ContinuityKind,
  FilmBibleV1,
  GenerationIntentV1,
  GenerationMode,
  GenerationStrategyV1,
  MediaKind,
  ReferenceBindingV1,
  ReferenceRole,
  ShotSpecV1,
  ShotStatus,
} from './cinematicTypes'

// ─────────────────────────────────────────────────────────────────────────────
// 枚举（与手写联合同形）
// ─────────────────────────────────────────────────────────────────────────────

export const referenceRoleSchema = z.enum([
  // 目标 §9.2 核心角色
  'identity',
  'character',
  'scene',
  'prop',
  'costume',
  'style',
  'composition',
  'first-frame',
  'last-frame',
  'motion',
  'video-reference',
  // 既有边 mode（迁移期保留）
  'reference',
  'first_frame',
  'last_frame',
  'style_ref',
  'character_ref',
  'composition_ref',
  // 既有 archetype slot（迁移期保留）
  'image_ref',
  'video_ref',
  'audio_ref',
  'source_video',
])

export const generationModeSchema = z.enum([
  'text-to-image',
  'image-to-image',
  'text-to-video',
  'first-frame',
  'first-last-frame',
  'omni-reference',
  'subject-reference',
  'video-reference',
  'video-extension',
])

export const mediaKindSchema = z.enum(['image', 'video', 'model3d', 'audio'])

export const continuityKindSchema = z.enum([
  'identity',
  'costume',
  'prop-state',
  'screen-direction',
  'space',
  'time',
  'light',
])

export const shotStatusSchema = z.enum(SHOT_STATUSES)

export const assetRevisionKindSchema = z.enum([
  'imported',
  'generated',
  'edited',
  'blender-preview',
  'exported',
])

export const assetRevisionStatusSchema = z.enum(ASSET_REVISION_STATUSES)

// ─────────────────────────────────────────────────────────────────────────────
// 子对象 schema
// ─────────────────────────────────────────────────────────────────────────────

export const referenceBindingSchema = z.object({
  assetId: z.string().min(1),
  revisionId: z.string().optional(),
  role: referenceRoleSchema,
  strength: z.number().min(0).max(1).optional(),
  required: z.boolean(),
})

export const generationStrategySchema = z.object({
  mediaKind: mediaKindSchema,
  mode: generationModeSchema,
  rationale: z.string(),
  vendorKey: z.string().optional(),
  providerId: z.string().optional(),
  modelKey: z.string().optional(),
  variantId: z.string().optional(),
  overrides: z.record(z.unknown()).optional(),
})

export const generationIntentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  shotId: z.string().optional(),
  mediaKind: mediaKindSchema,
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  references: z.array(referenceBindingSchema),
  target: z.object({
    aspectRatio: z.string(),
    resolution: z.string().optional(),
    durationSeconds: z.number().optional(),
    outputCount: z.number().int().min(1),
  }),
  budget: z.object({
    maxCostCny: z.number().optional(),
    maxSubmissions: z.number().int().min(1),
  }),
})

export const continuityConstraintSchema = z.object({
  kind: continuityKindSchema,
  rule: z.string(),
  sourceShotId: z.string().optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// ShotSpec v1（§9.1）
// ─────────────────────────────────────────────────────────────────────────────

export const shotSpecSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  projectId: z.string().min(1),
  sceneId: z.string().optional(),
  index: z.number().int(),
  title: z.string(),

  narrative: z.object({
    intent: z.string().optional(),
    beat: z.string().optional(),
    conflict: z.string().optional(),
    informationRevealed: z.array(z.string()).optional(),
  }),
  // 注：迁移期 narrative.intent/beat 宽松（optional），稳定后收紧为必填。

  time: z.object({
    durationSeconds: z.number(),
    startState: z.string().optional(),
    endState: z.string().optional(),
  }),

  subjects: z.array(
    z.object({
      assetId: z.string().optional(),
      role: z.enum(['primary', 'secondary', 'background']),
      performance: z.string().optional(),
      dialogue: z.string().optional(),
    }),
  ),

  environment: z.object({
    sceneAssetId: z.string().optional(),
    propAssetIds: z.array(z.string()),
    costumeAssetIds: z.array(z.string()),
    spatialRelations: z.array(z.string()),
  }),

  cinematography: z.object({
    shotScale: z.string().optional(),
    cameraAngle: z.string().optional(),
    lensMm: z.number().optional(),
    apertureIntent: z.string().optional(),
    cameraMotion: z.object({
      type: z.string().optional(),
      direction: z.string().optional(),
      amount: z.string().optional(),
      speed: z.string().optional(),
    }),
    composition: z.string().optional(),
    blocking: z.string().optional(),
    screenDirection: z.string().optional(),
    lighting: z.string().optional(),
    color: z.string().optional(),
  }),

  actionChain: z.array(z.string()),
  sound: z.object({
    dialogue: z.string().optional(),
    ambience: z.string().optional(),
    sfx: z.array(z.string()),
    musicIntent: z.string().optional(),
  }),
  continuity: z.array(continuityConstraintSchema),
  references: z.array(referenceBindingSchema),
  generationStrategy: generationStrategySchema,
  acceptanceCriteria: z.array(z.string()),
  selectedImageRevisionId: z.string().optional(),
  selectedVideoRevisionId: z.string().optional(),
  status: shotStatusSchema,
})

// ─────────────────────────────────────────────────────────────────────────────
// Film Bible v1（§8.1）
// ─────────────────────────────────────────────────────────────────────────────

export const filmBibleSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  theme: z.string().optional(),
  audience: z.string().optional(),
  era: z.string().optional(),
  place: z.string().optional(),
  worldRules: z.array(z.string()).optional(),
  aspectRatio: z.string().optional(),
  fps: z.number().optional(),
  targetDurationSeconds: z.number().optional(),
  photographyStrategy: z.string().optional(),
  colorStrategy: z.string().optional(),
  characters: z
    .array(z.object({ assetId: z.string(), name: z.string(), relations: z.string().optional() }))
    .optional(),
  scenes: z
    .array(z.object({ assetId: z.string().optional(), name: z.string(), spatialRelation: z.string().optional() }))
    .optional(),
  props: z
    .array(z.object({ assetId: z.string().optional(), name: z.string(), belongsTo: z.string().optional(), state: z.string().optional() }))
    .optional(),
  costumes: z
    .array(z.object({ assetId: z.string().optional(), characterName: z.string(), change: z.string().optional() }))
    .optional(),
  soundPrinciples: z
    .object({ music: z.string().optional(), ambience: z.string().optional(), dialogue: z.string().optional() })
    .optional(),
  forbiddenContent: z.array(z.string()).optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// AssetRevision v1（§9.6）
// ─────────────────────────────────────────────────────────────────────────────

export const assetRevisionSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  parentRevisionId: z.string().optional(),
  kind: assetRevisionKindSchema.optional(),
  localPath: z.string().optional(),
  sha256: z.string().optional(),
  mimeType: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationSeconds: z.number().optional(),
  providerTaskId: z.string().optional(),
  promptSnapshot: z.string().optional(),
  requestSnapshotPath: z.string().optional(),
  evaluationReportId: z.string().optional(),
  costCny: z.number().optional(),
  createdAt: z.string(),
  status: assetRevisionStatusSchema,
})

// ─────────────────────────────────────────────────────────────────────────────
// 编译期漂移守卫（零运行时）：z.infer ⟺ 手写类型 互相可赋值才编译通过
// 沿用 storyboardPlan.ts:187-190 模式。
// ─────────────────────────────────────────────────────────────────────────────

const _refBindingDrift = (x: z.infer<typeof referenceBindingSchema>): ReferenceBindingV1 => x
const _strategyDrift = (x: z.infer<typeof generationStrategySchema>): GenerationStrategyV1 => x
const _intentDrift = (x: z.infer<typeof generationIntentSchema>): GenerationIntentV1 => x
const _continuityDrift = (x: z.infer<typeof continuityConstraintSchema>): ContinuityConstraintV1 => x
const _shotSpecDrift = (x: z.infer<typeof shotSpecSchema>): ShotSpecV1 => x
const _filmBibleDrift = (x: z.infer<typeof filmBibleSchema>): FilmBibleV1 => x
const _revisionDrift = (x: z.infer<typeof assetRevisionSchema>): AssetRevisionV1 => x
void _refBindingDrift
void _strategyDrift
void _intentDrift
void _continuityDrift
void _shotSpecDrift
void _filmBibleDrift
void _revisionDrift

// 枚举漂移守卫
const _roleDrift = (x: z.infer<typeof referenceRoleSchema>): ReferenceRole => x
const _modeDrift = (x: z.infer<typeof generationModeSchema>): GenerationMode => x
const _mediaDrift = (x: z.infer<typeof mediaKindSchema>): MediaKind => x
const _continuityKindDrift = (x: z.infer<typeof continuityKindSchema>): ContinuityKind => x
const _shotStatusDrift = (x: z.infer<typeof shotStatusSchema>): ShotStatus => x
const _revKindDrift = (x: z.infer<typeof assetRevisionKindSchema>): AssetRevisionKind => x
const _revStatusDrift = (x: z.infer<typeof assetRevisionStatusSchema>): AssetRevisionStatus => x
void _roleDrift
void _modeDrift
void _mediaDrift
void _continuityKindDrift
void _shotStatusDrift
void _revKindDrift
void _revStatusDrift

// ─────────────────────────────────────────────────────────────────────────────
// 便捷 parse 入口
// ─────────────────────────────────────────────────────────────────────────────

export function parseShotSpec(raw: unknown): ShotSpecV1 {
  return shotSpecSchema.parse(raw)
}
export function parseFilmBible(raw: unknown): FilmBibleV1 {
  return filmBibleSchema.parse(raw)
}
export function parseAssetRevision(raw: unknown): AssetRevisionV1 {
  return assetRevisionSchema.parse(raw)
}
