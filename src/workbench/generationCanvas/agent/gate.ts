// 统一求值流(harness §6.1)——AI 想动你的作品前必经的那道门。
// 把散落的"只读自动放行"硬编码约定声明化成一张工具 meta 表 + 一个纯函数。
// 三步:① policy(只读→allow)② invariant(校验/锁→deny)③ ask(其余→等用户点头)。
// SDK 的 hook registry / permission mode / 规则 DSL 一律不抄(单用户桌面无配置面)。
import i18n from '../../../i18n'
import type { TranslationKey } from '../../../i18n/translationKey'
import { canvasSourceDefaults } from '../../../../electron/shared/canvas/sourceDefaults'
import {
  categorizeTool,
  SEMANTIC_TOOL_MAP,
  type SemanticToolCategory,
  type SemanticToolName,
} from '../../domain/semanticAgentTools'

/** 三种 intent = 同一管道的三种入口(每工具 / 批量计划 / 预算)。 */
export type GateIntent =
  | { kind: 'tool-call'; toolName: string; args: unknown }
  | { kind: 'batch-run'; nodeIds: string[] } // S2b/S6b 受理
  | { kind: 'spend'; estimatedCost: number } // S7 预算门

/** ask 的 proposal 由调用方持有(渲染层的 pending 卡),决策本身只需三态。 */
export type GateDecision =
  | { outcome: 'allow' }
  | { outcome: 'deny'; reason: string } // reason = 人话(回喂 LLM 可自我修正,N14 素材)
  | { outcome: 'ask' }

/** 求值上下文(S6-4 锁)。 */
export type GateContext = {
  /** 被用户锁住的节点 id→标题(deny reason 用人话点名);改其 prompt/删除/入边 = deny。 */
  lockedNodes?: ReadonlyMap<string, string>
  /** LLM 口中的 clientId → 真实节点 id(applyCanvasToolCall 注册表;缺省原样返回)。 */
  resolveNodeId?: (id: string) => string
}

/** 工具写/破坏性/花钱分级(T2 meta 的声明式落地;唯一真相源,取代硬编码字符串门)。 */
type ToolMeta = { writes: boolean; destructive?: boolean; costy?: boolean }

const TOOL_META: Record<string, ToolMeta> = {
  read_canvas_state: { writes: false },
  // 产出分镜方案对象,只落创作 store 给用户审/改(不写画布投影、不花钱)——免费可改,直通放行(allow)。
  // 真正花钱/写画布的是用户确认后由方案转出的 create_canvas_nodes + run_generation_batch。
  propose_storyboard_plan: { writes: false },
  // 改分镜方案源头（创作 store），不花钱但会改用户文稿/提示词 → 需要确认。
  update_storyboard_shot: { writes: true },
  batch_update_storyboard_shots: { writes: true },
  create_canvas_nodes: { writes: true },
  connect_canvas_edges: { writes: true },
  set_node_prompt: { writes: true },
  delete_canvas_nodes: { writes: true, destructive: true },
  // S6b 受理语义:不写画布投影,但花真钱——costy 必问,确认前零网络调用。
  run_generation_batch: { writes: false, costy: true },
  // 外部图片写回节点 result:不花 Nomi 模型额度,但会复制文件并覆盖节点当前结果 → 必问。
  attach_external_image_to_node: { writes: true },
  // 写时间轴(非画布投影,不花钱):非破坏、可撤销,但有可见副作用——按写操作走确认门(ask)。
  // 锁不变量只管画布节点,evaluateLock 对此工具名返回 null,自然放行到 ask。
  arrange_storyboard_to_timeline: { writes: true },
  // 一键整理画布:重排节点位置(非破坏、零花费、⌘Z 可撤销),但满屏节点位移是可见副作用→按写操作走确认门(ask)。
  tidy_canvas: { writes: true },
  // 站位参考:建 scene3d 节点 + 离屏出灰模参考图(零扣费),但写画布有可见副作用→按写操作走确认门(ask)。
  create_staging_reference: { writes: true },
  // 运镜参考:建 scene3d 节点 + 离屏渲运镜小片(零扣费),但写画布有可见副作用→按写操作走确认门(ask)。
  create_camera_move: { writes: true },
  // 配方目录只描述能力/兼容模型，不写状态、不发请求。
  list_capability_recipes: { writes: false },
  // 配方执行始终创建派生节点并可能调用付费模型，必须先确认。
  apply_capability_recipe: { writes: true, costy: true },
  save_creative_resource: { writes: true },
  handoff_model3d: { writes: true },
}

/**
 * 单一求值入口。纯函数:同 (intent, ctx) 必得同 decision,便于单测/重放。
 * 决策落日志的裁剪在调用方(deny 必入、ask 结果入、只读 allow 不入——纯噪声)。
 */
export function evaluateGate(intent: GateIntent, ctx: GateContext = {}): GateDecision {
  if (intent.kind === 'tool-call') {
    const category = categorizeTool(intent.toolName)
    const meta = TOOL_META[intent.toolName] ?? (category
      ? {
          writes: category === 'apply',
          costy: category === 'paid',
        }
      : undefined)
    // ② invariant(校验):不认识的工具 = 注定失败的计划,不让用户批准(§6.5)。
    if (!meta) {
      return {
        outcome: 'deny',
        reason: i18n.t('generationCommon.agentRuntime.unsupportedOperation', { operation: intent.toolName }),
      }
    }
    // ① policy:只读直通,零摩擦(M1)。花钱的(costy)即使不写画布也必问(S6b 受理语义)。
    if (!meta.writes && !meta.costy) return { outcome: 'allow' }
    // ② invariant(锁):写操作命中锁住的节点 → deny(N11:AI 硬禁,用户软门)。
    const semanticMapping = SEMANTIC_TOOL_MAP[intent.toolName as SemanticToolName]
    const lockToolName = semanticMapping?.backedBy ?? intent.toolName
    const denied = evaluateLock(lockToolName, intent.args, ctx)
      ?? evaluateLock(intent.toolName, intent.args, ctx)
    if (denied) return denied
    // ③ ask:写操作排队等用户点头。
    return { outcome: 'ask' }
  }
  // batch-run / spend:S6b / S7 落地受理与预算语义,本片先一律 ask。
  return { outcome: 'ask' }
}

// ── Gate 2 Slice 4：§11.2 语义工具分类 → §11.3 权限矩阵 ──────────────────────
// 既有 evaluateGate 按 CanvasToolName 查 TOOL_META；本函数补一条按 §11.2 语义分类的路径，
// 让 Agent 用规范词汇（read_shot_spec/propose_shot_patch/submit_generation_intent）时，
// gate 也按 §11.3 权限矩阵正确判定（read/propose=allow，apply/paid=ask）。
//
// 与既有 evaluateGate 的关系：调用方先用 semanticToCanvasTool 把语义名解析回 canvas 工具名，
// 再走 evaluateGate；若解析不出（deferred 工具），用本函数按分类兜底判定。
/** §11.3 权限矩阵：分类 → gate 决策（read/propose 直通，apply/paid 需确认）。 */
export function gateDecisionForCategory(category: SemanticToolCategory): GateDecision {
  switch (category) {
    case 'read':
    case 'propose':
      // §11.3：读取 + 提案（生成结构化草案、不改画布、不花费）→ 允许，trace 摘要。
      return { outcome: 'allow' }
    case 'apply':
      // §11.3：本地修改（写但不花费）→ 需确认。
      return { outcome: 'ask' }
    case 'paid':
      // §11.3：付费/外部（含费用审计）→ 必确认。
      return { outcome: 'ask' }
    default:
      return { outcome: 'ask' }
  }
}

/**
 * §11.2 语义工具的统一 gate 入口。先查分类（语义名或既有 canvas 名），
 * 再按 §11.3 矩阵判定。未知名 → deny（防 typo 静默放行）。
 */
export function evaluateSemanticToolGate(toolName: string): GateDecision {
  const category = categorizeTool(toolName)
  if (!category) {
    return {
      outcome: 'deny',
      reason: canvasSourceDefaults.unknownAgentTool(toolName),
    }
  }
  return gateDecisionForCategory(category)
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/**
 * 锁不变量求值(S6-4):锁面 = 改 prompt / 删除 / **入边**(改变该节点的生成输入)→ deny;
 * **出边**(锁节点作为参考被引用,正是定妆用途)→ 放行。deny 发生在提议构建时——
 * 注定失败的计划不让用户批准(§6.5);reason 人话点名节点+解锁路径,回喂 LLM 可自我修正。
 */
const lockedActionLabels = {
  editPrompt: 'generationCommon.agentRuntime.editPrompt',
  deleteNode: 'generationCommon.agentRuntime.deleteNode',
  regenerateNode: 'generationCommon.agentRuntime.regenerateNode',
  replaceImageResult: 'generationCommon.agentRuntime.replaceImageResult',
  addIncomingEdge: 'generationCommon.agentRuntime.addIncomingEdge',
} as const satisfies Record<string, TranslationKey>

function evaluateLock(toolName: string, args: unknown, ctx: GateContext): GateDecision | null {
  const locked = ctx.lockedNodes
  if (!locked || locked.size === 0) return null
  const resolve = ctx.resolveNodeId ?? ((id: string) => id)
  const record = asRecord(args)

  const denyFor = (
    nodeId: string,
    actionKey: 'editPrompt' | 'deleteNode' | 'regenerateNode' | 'replaceImageResult' | 'addIncomingEdge',
  ): GateDecision => ({
    outcome: 'deny',
    reason: i18n.t('generationCommon.agentRuntime.lockedNode', {
      node: locked.get(nodeId) || nodeId,
      action: i18n.t(lockedActionLabels[actionKey]),
    }),
  })

  if (toolName === 'set_node_prompt') {
    const nodeId = resolve(String(record.nodeId || '').trim())
    if (locked.has(nodeId)) return denyFor(nodeId, 'editPrompt')
    return null
  }
  if (toolName === 'delete_canvas_nodes') {
    const nodeIds = Array.isArray(record.nodeIds) ? record.nodeIds : []
    for (const raw of nodeIds) {
      const nodeId = resolve(String(raw || '').trim())
      if (locked.has(nodeId)) return denyFor(nodeId, 'deleteNode')
    }
    return null
  }
  if (toolName === 'run_generation_batch') {
    // 重新生成会覆盖 result——锁住的定妆卡不许被批量重跑(引用它当参考照常,那是出边)。
    const nodeIds = Array.isArray(record.nodeIds) ? record.nodeIds : []
    for (const raw of nodeIds) {
      const nodeId = resolve(String(raw || '').trim())
      if (locked.has(nodeId)) return denyFor(nodeId, 'regenerateNode')
    }
    return null
  }
  if (toolName === 'attach_external_image_to_node') {
    const nodeId = resolve(String(record.nodeId || '').trim())
    if (locked.has(nodeId)) return denyFor(nodeId, 'replaceImageResult')
    return null
  }
  if (toolName === 'select_asset_revision' || toolName === 'archive_asset_revision') {
    const nodeId = resolve(String(record.nodeId || '').trim())
    if (locked.has(nodeId)) return denyFor(nodeId, 'replaceImageResult')
    return null
  }
  if (toolName === 'connect_canvas_edges') {
    const edges = Array.isArray(record.edges) ? record.edges : []
    for (const raw of edges) {
      const edge = asRecord(raw)
      // 只看 target(入边改变锁节点的生成输入);source 是出边=被引用,放行。
      const target = resolve(String(edge.targetClientId || edge.target || '').trim())
      if (locked.has(target)) return denyFor(target, 'addIncomingEdge')
    }
    return null
  }
  return null
}
