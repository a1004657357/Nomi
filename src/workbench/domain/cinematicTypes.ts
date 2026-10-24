/**
 * 电影级创作领域模型 v1（目标架构 §9）。
 *
 * 本文件定义 Nomi 电影级 Agent 创作平台的**领域真相源类型**，对应
 * `docs/architecture/nomi-cinematic-agent-platform-target-architecture-2026-08-02.md` §9。
 *
 * 设计原则（来自 Gate 1 实施计划 Slice 1）：
 * - **version:1**：所有类型带 `version` 钉死版本，未来 `v2` 走显式迁移，绝不原地改义。
 * - **渐进迁移友好**：除 id/version 外字段尽量 optional，让既有 `PlanShot`/`GenerationNodeResult`
 *   可无损升级，旧项目加载即迁移（见 Slice 2 `migratePlanShotToShotSpec`）。
 * - **P1 单一真相源**：`ShotSpecV1` 是镜头意图的唯一真相源；图片/视频 prompt、Blender 相机、
 *   Provider 参数、验收规则都从它派生，不互相复制为独立真相。
 * - **P3 规划免费、执行确认才花费**：本文件只定义结构，不触发任何付费副作用。
 * - **P8 最小权限**：类型注释显式标注**禁止存储**项（API Key/Cookie/模型私有配置）。
 *
 * 与既有结构的关系：
 * - `PlanShot`（`src/workbench/generationCanvas/agent/storyboardPlan.ts`）是 ShotSpec v1 的迁移起点；
 *   旧扁平字段（shotSize/cameraAngle/...）→ ShotSpec 子对象（cinematography.shotScale/...）由
 *   `migratePlanShotToShotSpec` 双向映射（Slice 2）。Slice 1 只定义类型，不改 PlanShot。
 * - `GenerationNodeResult`（`src/workbench/generationCanvas/model/generationCanvasTypes.ts`）的
 *   `history[]`+`resultId` 是 AssetRevision v1 的迁移起点（Slice 3）。
 *
 * zod schema 见 `./cinematicSchema.ts`（与手写类型同形并存，编译期漂移守卫保证一致）。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 参考绑定（§9.2）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 参考图语义角色。
 *
 * 联合三处来源（Gate 0 §1.2/§1.4 证据）：
 * - 既有画布边 mode（`canvasGraph.ts:64`）：reference/first_frame/last_frame/style_ref/character_ref/composition_ref
 * - 既有 archetype slot（`modelArchetypes/types.ts:14`）：image_ref/video_ref/audio_ref/source_video
 * - **新增**（目标 §9.2）：identity/scene/prop/costume/motion/video-reference
 *
 * 规则（§9.2）：不能向 Provider 发送没有 role 的图片数组。Provider 不支持某类 reference 时，
 * Provider Compiler 必须明确降级或阻止，不能静默丢弃。
 */
export type ReferenceRole =
  // 目标 §9.2 核心角色
  | 'identity'
  | 'character'
  | 'scene'
  | 'prop'
  | 'costume'
  | 'style'
  | 'composition'
  | 'first-frame'
  | 'last-frame'
  | 'motion'
  | 'video-reference'
  // 既有边 mode（迁移期保留，Slice 7 清理时收敛）
  | 'reference'
  | 'first_frame'
  | 'last_frame'
  | 'style_ref'
  | 'character_ref'
  | 'composition_ref'
  // 既有 archetype slot（迁移期保留）
  | 'image_ref'
  | 'video_ref'
  | 'audio_ref'
  | 'source_video'

/**
 * 一张参考资产与镜头/生成意图的语义绑定（§9.2）。
 *
 * 这是 ReferenceBinding 的**领域定义**；既有画布边 mode 与 archetype slot 在 Slice 2/4
 * 投影成此类型。迁移期 `revisionId` 可空（既有资产无 revision 概念时）。
 */
export type ReferenceBindingV1 = {
  /** 引用的资产稳定 id（Asset Registry，Slice 3 起 = GenerationNodeResult.id 派生）。 */
  assetId: string
  /** 选中的 revision；空=用资产当前 selected 指针。 */
  revisionId?: string
  /** 参考用途；禁止无 role 的裸图片数组（§9.2 规则）。 */
  role: ReferenceRole
  /** 参考强度（0–1，Provider 不支持时由 Compiler 降级）。 */
  strength?: number
  /** 是否必需；缺 required reference 时镜头不能进入 ready（§10.1）。 */
  required: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 生成意图与策略（§9.3, §9.5）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 生成模式（§9.3）。模型无关：选哪个 mode 由 `GenerationStrategy.rationale` +
 * ProviderCapabilities.modes 共同决定（§15.4），不由模型显示名猜（§4.3 禁止项）。
 */
export type GenerationMode =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'first-frame'
  | 'first-last-frame'
  | 'omni-reference'
  | 'subject-reference'
  | 'video-reference'
  | 'video-extension'

/** 媒体类型。 */
export type MediaKind = 'image' | 'video' | 'model3d' | 'audio'

/**
 * 镜头生成策略（§9.3）。
 * 模型无关；`vendorKey`/`modelKey` 可空（用户/Agent 未定时回落到项目默认）。
 */
export type GenerationStrategyV1 = {
  mediaKind: MediaKind
  mode: GenerationMode
  /** 为什么选这个 mode（§15.4 规则 + Agent 理由，用户可覆盖）。 */
  rationale: string
  /** Canonical supplier identity, paired with modelKey; never a model variant. */
  vendorKey?: string
  modelKey?: string
  variantId?: string
  /** @deprecated Opaque legacy value: old migrations also stored variant IDs here. Never infer routing from it. */
  providerId?: string
  /** Provider 特定覆盖（archetype 控件键 → 值）。 */
  overrides?: Record<string, unknown>
}

/**
 * 用户表达的"要什么"（§9.5），模型无关。
 * Provider Compiler 决定"怎么调用"（Gate 3）；更换 Provider 不应重写分镜（P2）。
 */
export type GenerationIntentV1 = {
  id: string
  projectId: string
  shotId?: string
  mediaKind: MediaKind
  prompt: string
  negativePrompt?: string
  references: ReferenceBindingV1[]
  target: {
    aspectRatio: string
    resolution?: string
    durationSeconds?: number
    outputCount: number
  }
  budget: {
    /** 人民币预算上限（可选；Provider 未返回费用时只统计提交次数）。 */
    maxCostCny?: number
    /** 最大提交次数（含重试）；超限立即停止新提交。 */
    maxSubmissions: number
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 连续性约束（§9.1 continuity）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 跨镜连续性约束类型（§9.1）。Gate D（§18.1）据此检查。
 */
export type ContinuityKind =
  | 'identity'
  | 'costume'
  | 'prop-state'
  | 'screen-direction'
  | 'space'
  | 'time'
  | 'light'

export type ContinuityConstraintV1 = {
  kind: ContinuityKind
  /** 规则描述（自然语言 + 可机检条件，Gate 5 起结构化）。 */
  rule: string
  /** 约束来源镜头（接戏/屏向匹配时必填）。 */
  sourceShotId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 镜头状态（§10.1）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 镜头状态机（§10.1）。
 *
 * 约束：
 * - 缺少 required reference 时不能进入 `ready`。
 * - `generating` 只能由持久任务驱动，不能由 UI 临时 loading 驱动。
 * - `accepted` 必须指向选中的 revision 和验收报告。
 * - 用户可手动接受带警告结果，但必须记录 override 原因。
 */
export const SHOT_STATUSES = [
  'draft', 'planned', 'asset-blocked', 'ready', 'generating', 'candidate-ready',
  'evaluating', 'needs-revision', 'accepted', 'placed-on-timeline',
] as const
export type ShotStatus = (typeof SHOT_STATUSES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// ShotSpec v1（§9.1）—— 镜头唯一真相源
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 镜头规格 v1（§9.1）—— P1 单一真相源。
 *
 * 图片 prompt、视频 prompt、Blender 相机、Provider 参数、验收规则都从它派生。
 *
 * **迁移期**（Slice 2）：既有 `PlanShot` 的扁平字段经 `migratePlanShotToShotSpec` 填进此结构；
 * 旧字段保留为别名直到 Slice 7 清理。所有新增子对象字段 optional，保证旧项目无损打开。
 */
export type ShotSpecV1 = {
  version: 1
  /** 镜头稳定 id（落画布后即 nodeId 派生；迁移期旧 PlanShot 无 id → 按 index 生成）。 */
  id: string
  projectId: string
  /** 场景 id（Film Bible 场景事实的引用；空=未绑定）。 */
  sceneId?: string
  /** 镜号（分镜顺序；不可重复）。 */
  index: number
  title: string

  narrative: {
    /** 叙事意图（这一镜要交代什么）。迁移期 optional（旧 PlanShot 无此字段）；稳定后收紧为必填。 */
    intent?: string
    /** 节拍（建置/推进/转折/高潮/收尾等）。迁移期 optional。 */
    beat?: string
    conflict?: string
    informationRevealed?: string[]
  }

  time: {
    /** 时长（秒）；图片镜头=0。 */
    durationSeconds: number
    /** 起始可见状态（动作起点）。 */
    startState?: string
    /** 结束状态（动作结果；视频 prompt 必含，§15.3）。 */
    endState?: string
  }

  /** 出镜主体（角色/表演/对白）。assetId 引用 Asset Registry。 */
  subjects: Array<{
    assetId?: string
    role: 'primary' | 'secondary' | 'background'
    performance?: string
    dialogue?: string
  }>

  environment: {
    sceneAssetId?: string
    propAssetIds: string[]
    costumeAssetIds: string[]
    /** 空间关系（"林夏在桌左、电话在桌右"）；Blender blocking 据此（§14.2）。 */
    spatialRelations: string[]
  }

  cinematography: {
    /** 景别（远景/全景/中景/近景/特写）。对应旧 PlanShot.shotSize。 */
    shotScale?: string
    /** 机位（正面/侧面/俯拍/仰拍/过肩/主观）。对应旧 PlanShot.cameraAngle。 */
    cameraAngle?: string
    lensMm?: number
    apertureIntent?: string
    cameraMotion: {
      /** 运镜类型（固定/推/拉/摇/移/跟/环绕/手持）。对应旧 PlanShot.cameraMove。 */
      type?: string
      direction?: string
      amount?: string
      speed?: string
    }
    composition?: string
    /** 走位/调度（谁在哪、怎么动）。 */
    blocking?: string
    screenDirection?: string
    lighting?: string
    color?: string
  }

  /** 动作链（按顺序的动作步骤；视频 prompt 据此编译，§15.3）。 */
  actionChain: string[]

  sound: {
    dialogue?: string
    ambience?: string
    sfx: string[]
    musicIntent?: string
  }

  continuity: ContinuityConstraintV1[]

  /** 参考绑定（§9.2；禁止无 role 裸数组）。 */
  references: ReferenceBindingV1[]

  generationStrategy: GenerationStrategyV1

  /** 验收标准（自然语言 + 可机检条件；Gate 5 起结构化）。 */
  acceptanceCriteria: string[]

  /** 当前选中图片 revision 指针（Slice 3 与节点 resultId 双向同步）。 */
  selectedImageRevisionId?: string
  /** 当前选中视频 revision 指针。 */
  selectedVideoRevisionId?: string

  status: ShotStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// Film Bible（§8.1）—— 项目级跨镜头事实
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Film Bible v1（§8.1）—— 跨项目镜头都应遵守的事实。
 *
 * **禁止存储**：API Key、Cookie、模型私有配置、长篇聊天记录（§8.1）。
 * 本类型字段不包含任何凭据类字段；存凭据是安全边界错误（§22.1）。
 */
export type FilmBibleV1 = {
  version: 1
  projectId: string

  theme?: string
  audience?: string

  era?: string
  place?: string
  /** 世界规则（科幻/奇幻设定、现实约束）。 */
  worldRules?: string[]

  /** 目标画幅（16:9/9:16/1:1/4:5）。 */
  aspectRatio?: string
  /** 帧率。 */
  fps?: number
  /** 目标总时长（秒）。 */
  targetDurationSeconds?: number

  /** 摄影策略（基调镜头语言）。 */
  photographyStrategy?: string
  /** 色彩策略。 */
  colorStrategy?: string

  /** 角色身份与关系（id → Asset Registry）。 */
  characters?: Array<{
    assetId: string
    name: string
    relations?: string
  }>

  /** 场景空间关系。 */
  scenes?: Array<{
    assetId?: string
    name: string
    spatialRelation?: string
  }>

  /** 道具归属与状态。 */
  props?: Array<{
    assetId?: string
    name: string
    belongsTo?: string
    state?: string
  }>

  /** 服装变化（按时间线/场景）。 */
  costumes?: Array<{
    assetId?: string
    characterName: string
    change?: string
  }>

  /** 音乐、环境声、对白原则。 */
  soundPrinciples?: {
    music?: string
    ambience?: string
    dialogue?: string
  }

  /** 禁止出现的内容（安全/版权/风格约束）。 */
  forbiddenContent?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// AssetRevision（§9.6, §17）—— 非破坏 revision
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Asset revision 种类（§9.6）。
 */
export type AssetRevisionKind = 'imported' | 'generated' | 'edited' | 'blender-preview' | 'exported'

/**
 * Revision 生命周期状态（§17）。
 * - candidate：新生成、待审阅。
 * - selected：当前选中版本（只是指针，旧 revision 不删，§17.1 不覆盖原则）。
 * - rejected：用户淘汰。
 * - archived：归档（默认删除策略，§17.3）。
 */
export const ASSET_REVISION_STATUSES = ['candidate', 'selected', 'rejected', 'archived'] as const
export type AssetRevisionStatus = (typeof ASSET_REVISION_STATUSES)[number]

/**
 * Asset Revision v1（§9.6）。
 *
 * **迁移期**（Slice 3）：既有 `GenerationNodeResult`（`generationCanvasTypes.ts:100`）经扩展
 * 满足此结构；既有 `provenance/createdAt/taskId/model/providerUrl/alternatives` 复用，
 * 新增 `parentRevisionId/kind/status/sha256/costCny/evaluationReportId`（全 optional）。
 *
 * §17.1 不覆盖原则：重新生成创建新 revision，不覆盖旧结果与费用记录。
 */
export type AssetRevisionV1 = {
  id: string
  assetId: string
  parentRevisionId?: string
  kind?: AssetRevisionKind
  /** 本地路径（project-relative，§20）。 */
  localPath?: string
  sha256?: string
  mimeType?: string
  width?: number
  height?: number
  durationSeconds?: number
  providerTaskId?: string
  promptSnapshot?: string
  requestSnapshotPath?: string
  evaluationReportId?: string
  costCny?: number
  createdAt: string
  status: AssetRevisionStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// 便捷别名（目标架构用的短名 → v1 类型）
// ─────────────────────────────────────────────────────────────────────────────

/** 目标架构 §9.1 用的短名。 */
export type ShotSpec = ShotSpecV1
/** 目标架构 §9.2 用的短名。 */
export type ReferenceBinding = ReferenceBindingV1
/** 目标架构 §9.3 用的短名。 */
export type GenerationStrategy = GenerationStrategyV1
/** 目标架构 §9.5 用的短名。 */
export type GenerationIntent = GenerationIntentV1
/** 目标架构 §8.1 用的短名。 */
export type FilmBible = FilmBibleV1
/** 目标架构 §9.6 用的短名。 */
export type AssetRevision = AssetRevisionV1
