import i18n from '../../i18n'
import { semanticToolProtocolDescriptions } from '../../i18n/locales/capabilityWorkflow'

/**
 * Gate 2 Slice 1 — §11.2 领域语义工具别名层。
 *
 * 对应目标架构 §11.2 计划工具集。现状（Gate 0 §1.3 证据）：实际工具是 canvas 变更导向的
 * （read_canvas_state/propose_storyboard_plan/update_storyboard_shot/run_generation_batch/...，
 * `electron/ai/canvasTools.ts:430`），§11.2 的领域语义名（read_film_bible/read_shot_spec/
 * propose_shot_patch/submit_generation_intent/...）在源码中不存在。
 *
 * 设计（不破坏既有调用）：
 * - **别名而非替换**：§11.2 名字作为既有工具的语义投影，映射到既有实现。
 *   Agent 用规范词汇（read_shot_spec），运行时解析回既有工具（read_canvas_state + ShotSpec 投影）。
 * - **权限分类**（§11.3 三类：只读 / 提案 / 付费）：每个语义工具声明其分类，供 gate.ts 统一判定。
 * - ** ShotSpec 投影接入**：read_shot_spec / read_film_bible 读领域投影（Slice 1 类型 + Slice 2 迁移），
 *   propose_shot_patch 复用 update_storyboard_shot。
 *
 * Gate 2 runtime 通过 `electron/ai/cinematicDirectorTools.ts` 注册这些名称，renderer 由
 * `cinematicDirectorToolHandlers.ts` 执行领域读取/提案/应用；能复用既有 canvas 实现的写在 backedBy。
 */

/**
 * 既有 canvas 工具名（镜像 `electron/ai/canvasTools.ts:430` 的 canvasToolNames 联合）。
 * src/ tsconfig 不含 electron/，故本地镜像此类型（结构相同；两边漂移由 Slice 4 接入时的集成测试守）。
 */
export type CanvasToolName =
  | 'read_canvas_state'
  | 'propose_storyboard_plan'
  | 'update_storyboard_shot'
  | 'batch_update_storyboard_shots'
  | 'create_canvas_nodes'
  | 'connect_canvas_edges'
  | 'set_node_prompt'
  | 'delete_canvas_nodes'
  | 'run_generation_batch'
  | 'attach_external_image_to_node'
  | 'arrange_storyboard_to_timeline'
  | 'tidy_canvas'
  | 'create_staging_reference'
  | 'create_camera_move'
  | 'list_capability_recipes'
  | 'apply_capability_recipe'
  | 'save_creative_resource'
  | 'handoff_model3d'
  | 'read_vibing_director'
  | 'apply_vibing_director_plan'

/** §11.2 的三类工具（与 §11.3 权限矩阵对齐）。 */
export type SemanticToolCategory = 'read' | 'propose' | 'apply' | 'paid'

/**
 * §11.2 语义工具名（目标架构计划的完整集合）。
 * 与既有 CanvasToolName 的区别：领域语义（镜头/资产/项目级）而非画布操作语义。
 */
export type SemanticToolName =
  // 只读工具（§11.2 只读工具集）
  | 'read_project_summary'
  | 'read_film_bible'
  | 'read_storyboard'
  | 'read_shot_spec'
  | 'read_asset_registry'
  | 'read_provider_capabilities'
  | 'read_task_status'
  | 'read_evaluation_report'
  | 'read_vibing_director_state'
  // 提案工具（§11.2 提案工具集——生成结构化草案，不改画布、不花费）
  | 'propose_film_bible_patch'
  | 'propose_storyboard_plan'
  | 'propose_shot_patch'
  | 'propose_generation_plan'
  | 'propose_timeline_assembly'
  // 本地修改工具（§11.2 本地修改——写但不花费）
  | 'apply_film_bible_patch'
  | 'apply_storyboard_patch'
  | 'create_asset_records'
  | 'select_asset_revision'
  | 'archive_asset_revision'
  | 'apply_vibing_director_plan'
  | 'place_assets_on_timeline'
  // 付费/外部工具（§11.2 付费——必须确认 + 审计费用）
  | 'submit_generation_intent'
  | 'cancel_provider_task'
  | 'download_provider_result'
  | 'run_optional_gpu_evaluation'

/** 映射条目：语义工具 → 既有实现 + 分类 + 状态（implemented/projected/deferred）。 */
type SemanticToolMapping = {
  /** §11.2 分类。 */
  category: SemanticToolCategory
  /** 映射到的既有 canvas 工具（null = 该语义工具尚无既有对应，为 projected/deferred）。 */
  backedBy: CanvasToolName | null
  /**
   * implemented = 已有既有工具支撑，语义层只是换名；
   * projected = 通过 ShotSpec/Capabilities 投影支撑（Gate 1 类型已就位，运行时接入待 Slice 4）；
   * deferred = 完全未实现，留待后续 Gate（见 deferredTo）。
   */
  status: 'implemented' | 'projected' | 'deferred'
  deferredTo?: string
  /** §11.2 描述（人类可读，供 Agent 理解用途）。 */
  description: string
}

/**
 * §11.2 语义工具 → 既有实现的映射表（唯一真相源）。
 *
 * 关键映射（implemented）：
 * - read_storyboard / read_shot_spec → read_canvas_state（读画布后投影成 ShotSpec，Slice 3 接入）
 * - propose_storyboard_plan → propose_storyboard_plan（既有，同名）
 * - propose_shot_patch → update_storyboard_shot（既有；改分镜 = shot patch 的提案态）
 * - apply_vibing_director_plan → apply_vibing_director_plan（既有同名）
 * - submit_generation_intent → run_generation_batch（既有；付费生成 = intent 提交）
 * - read_provider_capabilities → list_capability_recipes（既有；Gate 1 ProviderCapabilities 投影接入）
 */
export const SEMANTIC_TOOL_MAP: Record<SemanticToolName, SemanticToolMapping> = {
  // ── 只读（§11.2）──────────────────────────────────────────────
  read_project_summary: {
    category: 'read',
    backedBy: 'read_canvas_state',
    status: 'implemented',
    description: semanticToolProtocolDescriptions.read_project_summary,
  },
  read_film_bible: {
    category: 'read',
    backedBy: null,
    status: 'implemented',
    description:
      semanticToolProtocolDescriptions.read_film_bible,
  },
  read_storyboard: {
    category: 'read',
    backedBy: 'read_canvas_state',
    status: 'implemented',
    description: semanticToolProtocolDescriptions.read_storyboard,
  },
  read_shot_spec: {
    category: 'read',
    backedBy: 'read_canvas_state',
    status: 'implemented',
    description:
      semanticToolProtocolDescriptions.read_shot_spec,
  },
  read_asset_registry: {
    category: 'read',
    backedBy: 'read_canvas_state',
    status: 'implemented',
    description:
      semanticToolProtocolDescriptions.read_asset_registry,
  },
  read_provider_capabilities: {
    category: 'read',
    backedBy: 'list_capability_recipes',
    status: 'implemented',
    description:
      semanticToolProtocolDescriptions.read_provider_capabilities,
  },
  read_task_status: {
    category: 'read',
    backedBy: 'read_canvas_state',
    status: 'implemented',
    description: semanticToolProtocolDescriptions.read_task_status,
  },
  read_evaluation_report: {
    category: 'read',
    backedBy: null,
    status: 'deferred',
    deferredTo: 'Gate 5',
    description: semanticToolProtocolDescriptions.read_evaluation_report,
  },
  read_vibing_director_state: {
    category: 'read',
    backedBy: null,
    status: 'implemented',
    description: semanticToolProtocolDescriptions.read_vibing_director_state,
  },

  // ── 提案（§11.2——生成结构化草案，不改画布、不花费）──────────
  propose_film_bible_patch: {
    category: 'propose',
    backedBy: null,
    status: 'implemented',
    description:
      semanticToolProtocolDescriptions.propose_film_bible_patch,
  },
  propose_storyboard_plan: {
    category: 'propose',
    backedBy: 'propose_storyboard_plan',
    status: 'implemented',
    description: semanticToolProtocolDescriptions.propose_storyboard_plan,
  },
  propose_shot_patch: {
    category: 'propose',
    backedBy: null,
    status: 'implemented',
    description:
      semanticToolProtocolDescriptions.propose_shot_patch,
  },
  propose_generation_plan: {
    category: 'propose',
    backedBy: null,
    status: 'implemented',
    description:
      semanticToolProtocolDescriptions.propose_generation_plan,
  },
  propose_timeline_assembly: {
    category: 'propose',
    backedBy: null,
    status: 'implemented',
    description:
      semanticToolProtocolDescriptions.propose_timeline_assembly,
  },

  // ── 本地修改（§11.2——写但不花费，需确认）────────────────────
  apply_film_bible_patch: {
    category: 'apply',
    backedBy: null,
    status: 'implemented',
    description: semanticToolProtocolDescriptions.apply_film_bible_patch,
  },
  apply_storyboard_patch: {
    category: 'apply',
    backedBy: 'batch_update_storyboard_shots',
    status: 'implemented',
    description: semanticToolProtocolDescriptions.apply_storyboard_patch,
  },
  create_asset_records: {
    category: 'apply',
    backedBy: 'create_canvas_nodes',
    status: 'implemented',
    description: semanticToolProtocolDescriptions.create_asset_records,
  },
  select_asset_revision: {
    category: 'apply',
    backedBy: null,
    status: 'implemented',
    description:
      semanticToolProtocolDescriptions.select_asset_revision,
  },
  archive_asset_revision: {
    category: 'apply',
    backedBy: null,
    status: 'implemented',
    description: semanticToolProtocolDescriptions.archive_asset_revision,
  },
  apply_vibing_director_plan: {
    category: 'apply',
    backedBy: null,
    status: 'implemented',
    description: semanticToolProtocolDescriptions.apply_vibing_director_plan,
  },
  place_assets_on_timeline: {
    category: 'apply',
    backedBy: 'arrange_storyboard_to_timeline',
    status: 'implemented',
    description: semanticToolProtocolDescriptions.place_assets_on_timeline,
  },

  // ── 付费/外部（§11.2——必须确认 + 审计费用）──────────────────
  submit_generation_intent: {
    category: 'paid',
    backedBy: 'run_generation_batch',
    status: 'implemented',
    description:
      semanticToolProtocolDescriptions.submit_generation_intent,
  },
  cancel_provider_task: {
    category: 'paid',
    backedBy: null,
    status: 'implemented',
    description:
      semanticToolProtocolDescriptions.cancel_provider_task,
  },
  download_provider_result: {
    category: 'paid',
    backedBy: null,
    status: 'deferred',
    deferredTo: 'Gate 3',
    description: semanticToolProtocolDescriptions.download_provider_result,
  },
  run_optional_gpu_evaluation: {
    category: 'paid',
    backedBy: null,
    status: 'deferred',
    deferredTo: 'Gate 5',
    description: semanticToolProtocolDescriptions.run_optional_gpu_evaluation,
  },
}

/** 所有 §11.2 语义工具名（用于校验/枚举）。 */
export const SEMANTIC_TOOL_NAMES = Object.keys(SEMANTIC_TOOL_MAP) as SemanticToolName[]

/** 解析语义工具名 → 映射条目。未知名抛错（防 typo 静默失败）。 */
export function resolveSemanticTool(name: string): SemanticToolMapping {
  const mapping = SEMANTIC_TOOL_MAP[name as SemanticToolName]
  if (!mapping) {
    throw new Error(i18n.t('capabilityWorkflow.unknownSection112SemanticTool', { v0: name }))
  }
  return mapping
}

/**
 * 把语义工具名解析回既有 canvas 工具名（供 harness 注册时路由）。
 * deferred 工具（无 backedBy）返回 null——调用方应拒绝调用并提示"该能力留待 ${deferredTo}"。
 */
export function semanticToCanvasTool(name: SemanticToolName): CanvasToolName | null {
  return SEMANTIC_TOOL_MAP[name].backedBy
}

const CANVAS_TOOL_CATEGORIES: Readonly<Partial<Record<CanvasToolName, SemanticToolCategory>>> = {
  read_canvas_state: 'read',
  list_capability_recipes: 'read',
  propose_storyboard_plan: 'propose',
  update_storyboard_shot: 'apply',
  batch_update_storyboard_shots: 'apply',
  create_canvas_nodes: 'apply',
  connect_canvas_edges: 'apply',
  set_node_prompt: 'apply',
  delete_canvas_nodes: 'apply',
  attach_external_image_to_node: 'apply',
  arrange_storyboard_to_timeline: 'apply',
  tidy_canvas: 'apply',
  create_staging_reference: 'apply',
  create_camera_move: 'apply',
  save_creative_resource: 'apply',
  handoff_model3d: 'apply',
  run_generation_batch: 'paid',
  apply_capability_recipe: 'paid',
}

/**
 * §11.3 权限分类查询：给定工具名（语义或既有），返回分类。
 * 既有 canvas 工具按其语义对应的分类回退（如 run_generation_batch → paid）。
 */
export function categorizeTool(name: string): SemanticToolCategory | null {
  // 先查语义表
  if (name in SEMANTIC_TOOL_MAP) {
    return SEMANTIC_TOOL_MAP[name as SemanticToolName].category
  }
  return CANVAS_TOOL_CATEGORIES[name as CanvasToolName] ?? null
}

/**
 * 覆盖率统计：§11.2 工具集中已实现（implemented + projected）vs 延后（deferred）。
 * 用于 Gate 2 完成证据与缺口追踪。
 */
export function semanticToolCoverage(): {
  total: number
  implemented: number
  projected: number
  deferred: number
  byCategory: Record<SemanticToolCategory, { implemented: number; projected: number; deferred: number }>
} {
  const byCategory: Record<SemanticToolCategory, { implemented: number; projected: number; deferred: number }> = {
    read: { implemented: 0, projected: 0, deferred: 0 },
    propose: { implemented: 0, projected: 0, deferred: 0 },
    apply: { implemented: 0, projected: 0, deferred: 0 },
    paid: { implemented: 0, projected: 0, deferred: 0 },
  }
  let implemented = 0
  let projected = 0
  let deferred = 0
  for (const mapping of Object.values(SEMANTIC_TOOL_MAP)) {
    byCategory[mapping.category][mapping.status] += 1
    if (mapping.status === 'implemented') implemented += 1
    else if (mapping.status === 'projected') projected += 1
    else deferred += 1
  }
  return { total: SEMANTIC_TOOL_NAMES.length, implemented, projected, deferred, byCategory }
}
