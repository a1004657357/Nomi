/**
 * Gate 3 Slice 1 — GenerationIntent → CompiledProviderRequest 编译层（§9.5, §12.1）。
 *
 * 对应目标架构 §12.1 Provider Compiler：「ShotSpec/GenerationIntent → model-specific request」。
 * 现状（Gate 0 §1.4 证据）：无 compile(intent, capabilities) 抽象；请求构造=模板渲染
 * （requestPipeline.ts buildHttpRequest + {{}} 占位符）。目标 §9.5 的 CompiledProviderRequest 不存在。
 *
 * 设计（按用户确认：适配，不重写）：
 * - **编译外观（facade）**：本模块是 GenerationIntent（模型无关）→ CompiledProviderRequest（§9.5）
 *   的编译入口，内部**复用**既有 buildTemplateContext + buildHttpRequest（不重写模板引擎）。
 * - **P2 意图与执行分离**：GenerationIntent 只表达「要什么」；编译器据 ProviderCapabilities
 *   决定「怎么调用」——参考角色不支持时明确降级或阻止（§9.2 规则），不静默丢弃。
 * - **钱安全**：CompiledProviderRequest 带 idempotencyKey（与 submissionLedger 串起），编译不触发提交。
 * - **降级而非静默**：参考角色/数量超 capability 时填 compilationWarnings，由调用方决定阻止或继续。
 *
 * 不在本 Slice：实际接入 runtime.runTask（既有 profile 路径仍直跑模板）；本 Slice 交付编译函数 + 测试，
 * 让 GenerationIntent 路径成为可选入口（后续逐步替换既有直拼）。
 *
 * electron rootDir 约束：不 import src/；本文件用结构化类型镜像 domain 类型的形（与
 * providerCapabilities.ts 同样策略）。两边的形由 src/workbench/domain/cinematicTypes.ts 权威定义，
 * 此处镜像用于编译器局部消费，漂移由集成测试守。
 */
import type { JsonRecord } from '../jsonUtils'
import type { ProviderCapabilities } from './providerCapabilities'

// ── domain 类型的 electron 本地镜像（结构同 src/workbench/domain/cinematicTypes.ts）──────────
type MediaKind = 'image' | 'video' | 'model3d' | 'audio'
type ReferenceRole = string // 开放联合；与 cinematicTypes.ts 的 ReferenceRole 同义
type ReferenceBindingV1 = {
  assetId: string
  revisionId?: string
  role: ReferenceRole
  strength?: number
  required: boolean
}
type GenerationIntentV1 = {
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
  budget: { maxCostCny?: number; maxSubmissions: number }
}

/** §9.5 CompiledProviderRequest（与目标架构同形）。 */
export type CompiledProviderRequest = {
  intentId: string
  providerId: string
  modelKey: string
  modeId: string
  /** 幂等键（贯穿 submissionLedger，钱安全核心）。 */
  idempotencyKey: string
  /** 编译出的请求体（供应商特定；既有路径下 = buildTemplateContext 渲染后的 body）。 */
  requestBody: unknown
  /** 编译期警告（参考角色不支持、参数超限等；调用方决定阻止或继续）。 */
  compilationWarnings: string[]
}

/** §9.2 规则：不允许把无 role 的图片数组发给 Provider。 */
export class CompilationError extends Error {
  readonly warnings: string[]
  constructor(message: string, warnings: string[] = []) {
    super(message)
    this.name = 'CompilationError'
    this.warnings = warnings
  }
}

/**
 * 把一个 GenerationIntent 编译成 CompiledProviderRequest（§9.5）。
 *
 * @param intent 模型无关意图（§9.5）。
 * @param capabilities 目标模型的能力声明（§9.4，providerCapabilities.projectCapabilities）。
 * @param renderTemplate 既有模板渲染函数（buildTemplateContext + renderTemplateValue 的注入点）。
 *                      编译器不直接 import requestPipeline（保持可测、避免循环）；
 *                      调用方注入渲染器，编译器负责 intent → context 的翻译。
 * @param idempotencyKey 幂等键（调用方从 run.id / mcp-key 提供）。
 *
 * 钱安全：本函数**不提交**，只编译。提交由 submissionLedger 守门（§10.2）。
 *
 * @throws CompilationError 当 intent 违反硬约束（如 mediaKind 与 capability 不匹配、无 role 参考数组）。
 */
export function compileGenerationIntent(
  intent: GenerationIntentV1,
  capabilities: ProviderCapabilities,
  options: {
    /** 把 references 翻译成 provider 期望的请求字段（如 Seedance 的 reference_image_urls[]）。调用方注入。 */
    referencesToRequestField?: (
      refs: ReferenceBindingV1[],
      cap: ProviderCapabilities,
    ) => { value: unknown; warnings: string[] }
    /** 模板渲染注入（可选；不注入则 requestBody 只含 intent 派生的标准字段）。 */
    renderTemplate?: (context: JsonRecord) => unknown
  } = {},
  idempotencyKey: string = `intent-${intent.id}`,
): CompiledProviderRequest {
  const warnings: string[] = []

  // ── 硬约束（抛错，不降级）──────────────────────────────────────
  // §9.2：不能向 Provider 发送没有 role 的图片数组
  const nakedRefs = intent.references.filter((r) => !r.role)
  if (nakedRefs.length > 0) {
    throw new CompilationError(
      `§9.2 违规：${nakedRefs.length} 个参考未声明 role（禁止无语义图片数组）`,
      [`naked-references: ${nakedRefs.length}`],
    )
  }

  // mediaKind 必须与 capability 匹配（§4.3 禁止把图片模型和视频模型嫁接错）
  if (intent.mediaKind !== capabilities.mediaKind) {
    throw new CompilationError(
      `mediaKind 不匹配：intent=${intent.mediaKind} vs capability=${capabilities.mediaKind}（§4.3 禁止嫁接错）`,
    )
  }

  // ── 软约束（warn，不阻止）──────────────────────────────────────
  // 参考数量超 capability.maxReferences
  if (intent.references.length > capabilities.maxReferences && capabilities.maxReferences > 0) {
    warnings.push(
      `参考数 ${intent.references.length} 超过 ${capabilities.modelKey} 上限 ${capabilities.maxReferences}（应降级或裁剪）`,
    )
  }

  // 参考角色不被支持 → 警告（不静默丢弃，§9.2 规则）
  if (capabilities.referenceRoles.length > 0) {
    for (const ref of intent.references) {
      const normalizedRole = normalizeRoleForCapability(ref.role)
      if (!capabilities.referenceRoles.includes(normalizedRole)) {
        warnings.push(
          `参考角色 "${ref.role}" 不被 ${capabilities.modelKey} 支持（capability.roles: ${capabilities.referenceRoles.join(',')}）`,
        )
      }
    }
  }

  // 输出数超 maxOutputs
  if (intent.target.outputCount > capabilities.maxOutputs && capabilities.maxOutputs > 0) {
    warnings.push(
      `outputCount ${intent.target.outputCount} 超过 ${capabilities.modelKey} 上限 ${capabilities.maxOutputs}`,
    )
  }

  // 画幅/分辨率/时长不在 capability 声明内（capability 声明为空时跳过——迁移期保守）
  if (capabilities.aspectRatios.length > 0 && !capabilities.aspectRatios.includes(intent.target.aspectRatio)) {
    warnings.push(
      `画幅 ${intent.target.aspectRatio} 不在 ${capabilities.modelKey} 声明支持集 ${capabilities.aspectRatios.join(',')}`,
    )
  }
  if (
    intent.target.durationSeconds != null &&
    capabilities.durationsSeconds.length > 0 &&
    !capabilities.durationsSeconds.includes(intent.target.durationSeconds)
  ) {
    warnings.push(
      `时长 ${intent.target.durationSeconds}s 不在 ${capabilities.modelKey} 声明支持集 ${capabilities.durationsSeconds.join(',')}`,
    )
  }

  // ── 编译 requestBody ─────────────────────────────────────────
  const baseContext: JsonRecord = {
    request: {
      prompt: intent.prompt,
      ...(intent.negativePrompt ? { negative_prompt: intent.negativePrompt } : {}),
      ...(intent.target.durationSeconds != null ? { duration: intent.target.durationSeconds } : {}),
      aspect_ratio: intent.target.aspectRatio,
      ...(intent.target.resolution ? { resolution: intent.target.resolution } : {}),
      n: intent.target.outputCount,
    },
    model: { modelKey: capabilities.modelKey, model_key: capabilities.modelKey },
  }

  // 参考翻译（调用方注入的 provider 特定逻辑）
  let requestField: unknown = undefined
  if (intent.references.length > 0 && options.referencesToRequestField) {
    const result = options.referencesToRequestField(intent.references, capabilities)
    requestField = result.value
    warnings.push(...result.warnings)
  }

  const fullContext: JsonRecord = {
    ...baseContext,
    ...(requestField != null ? { references: requestField } : {}),
  }

  const requestBody = options.renderTemplate ? options.renderTemplate(fullContext) : fullContext

  // modeId：intent 无显式 mode → 据 mediaKind + references 推断默认
  const modeId = inferModeId(intent, capabilities)

  return {
    intentId: intent.id,
    providerId: capabilities.providerId,
    modelKey: capabilities.modelKey,
    modeId,
    idempotencyKey,
    requestBody,
    compilationWarnings: warnings,
  }
}

/** 把 ReferenceRole 归一化到 capability.referenceRoles 用的命名（与 providerCapabilities 对齐）。 */
function normalizeRoleForCapability(role: ReferenceRole): string {
  // providerCapabilities 投影出的 referenceRoles 用 §9.2 归一化名（first-frame/character/video-reference/...）
  const map: Partial<Record<ReferenceRole, string>> = {
    first_frame: 'first-frame',
    last_frame: 'last-frame',
    image_ref: 'character',
    video_ref: 'video-reference',
    audio_ref: 'motion',
    source_video: 'video-reference',
    'first-frame': 'first-frame',
    'last-frame': 'last-frame',
    character: 'character',
    'video-reference': 'video-reference',
    motion: 'motion',
    scene: 'scene',
    prop: 'prop',
    costume: 'costume',
    identity: 'identity',
    style: 'style',
    composition: 'composition',
  }
  return map[role] ?? role
}

/** 据 mediaKind + references 数推断默认 modeId（§15.4 规则简化版）。 */
function inferModeId(intent: GenerationIntentV1, _capabilities: ProviderCapabilities): string {
  if (intent.mediaKind === 'image') {
    return intent.references.length > 0 ? 'image-to-image' : 'text-to-image'
  }
  // video
  const hasFirstFrame = intent.references.some((r) => r.role === 'first-frame' || r.role === 'first_frame')
  if (hasFirstFrame) return 'first-frame'
  if (intent.references.length > 0) return 'omni-reference'
  return 'text-to-video'
}

/** 便捷：编译多个 intent（批量），任一硬约束失败抛错（原子性——要么全编译要么不编译）。 */
export function compileBatch(
  intents: GenerationIntentV1[],
  capabilitiesFor: (intent: GenerationIntentV1) => ProviderCapabilities,
  options: Parameters<typeof compileGenerationIntent>[2] = {},
  idempotencyKeyFor: (intent: GenerationIntentV1) => string = (i) => `intent-${i.id}`,
): CompiledProviderRequest[] {
  return intents.map((intent) => {
    const caps = capabilitiesFor(intent)
    return compileGenerationIntent(intent, caps, options, idempotencyKeyFor(intent))
  })
}

// 防止未用类型 import 警告（MediaKind 用于类型注释）
void (undefined as unknown as MediaKind)
