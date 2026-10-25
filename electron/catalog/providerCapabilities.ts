/**
 * Slice 4 — ProviderCapabilities 只读投影（§9.4，适配既有 catalog 引擎）。
 *
 * 对应 Gate 1 实施计划 Slice 4。目标架构 §9.4 的 `ProviderCapabilities` 在源码中原先不存在
 * （Gate 0 §1.4 证据：能力散落于 `Model.meta` + archetype + Mapping 三处）。
 *
 * **设计（按用户确认：适配，不重写）**：
 * - **只读投影**：不建 ProviderAdapter 类、不建 compile(intent,capabilities) 层。
 *   本文件从既有 `catalogStore`（Vendor/Model/Mapping）+ `modelArchetypes`（ArchetypeMode/slots）
 *   **聚合**出 §9.4 形状，作为**单一读 API**。
 * - **消除能力散落**（Gate 0 §2）：后续模型下拉过滤、ReferenceBinding 角色匹配、Gate 3 compiler
 *   全部改读这个投影，不再各自直读 archetype/catalog。
 * - **诚实标注来源**（Gate 0 §3 原则）：`source` ∈ official-api/browser-bridge/local-runtime
 *   （按已知 vendor key 派生）；`verifiedAt` 现阶段恒 null + `sourceDetail` 标 'catalog-seed'/
 *   'archetype'/'onboarding-doc'——**不伪造已验证**。真实 API 探测留给 Gate 3。
 *
 * 不变量：`source` 非 null 时 `verifiedAt` 必须有值——目前 source 总有、verifiedAt 总 null，
 * 故加 `sourceDetail` 明示"未真实验证"，避免被误读为"已通过真机验收"。
 *
 * **electron rootDir 约束**：electron/ 的 tsconfig rootDir='.'，不能 import 自 src/。
 * 故本文件不直接调 `src/config/modelArchetypes` 的 resolver，而是接收**结构化 archetype 输入**
 * （`ArchetypeProjection`，由调用方在 src↔electron 边界解析后传入）。`projectCapabilities`
 * 的零参变体在无 archetype 输入时退化为最小能力（modes/roles 空），仍可用。
 */
import type { Model, Vendor } from './types'
import { listModelCatalogMappings, listModelCatalogModels, listModelCatalogVendors } from './catalogStore'

// ─────────────────────────────────────────────────────────────────────────────
// §9.4 形状（与 src/workbench/domain 一致的 MediaKind，但 electron 侧不依赖 renderer 模块）
// ─────────────────────────────────────────────────────────────────────────────

/** Provider 能力声明的来源。§9.4 source 字段。 */
export type ProviderSource = 'official-api' | 'browser-bridge' | 'local-runtime'

/**
 * 一条能力的真实出处细目（Gate 0 §3：不伪造已验证）。
 * - catalog-seed：来自 seedBuiltins 硬编码。
 * - archetype：来自供应商无关的 curated archetype。
 * - onboarding-doc：onboarding agent 从文档摘录（confidence 在 Model.onboarding.fields）。
 * - unknown：无任何依据（探测失败或新加 vendor 未补能力）。
 */
export type CapabilitySourceDetail = 'catalog-seed' | 'archetype' | 'onboarding-doc' | 'unknown'

export type ProviderCapabilities = {
  providerId: string
  modelKey: string
  mediaKind: 'image' | 'video' | 'model3d' | 'audio'
  /** 该模型支持的模式 id 列表（来自 archetype.modes[].id）。 */
  modes: string[]
  /** 该模型各 mode 接受的参考角色（来自 archetype slots 的 kind/roleName）。 */
  referenceRoles: string[]
  /** 跨 mode 的最大参考数（取所有 mode slot max 之和）。 */
  maxReferences: number
  /** 单次生成最大输出数（来自 ModelCapabilitySupport.maxOutputs，缺省 1）。 */
  maxOutputs: number
  /** 支持的画幅（迁移期：从 archetype params 的 aspect_ratio 控件提取；空=未声明）。 */
  aspectRatios: string[]
  /** 支持的分辨率（同上）。 */
  resolutions: string[]
  /** 视频时长档（秒，来自 archetype params 的 duration 控件枚举）。 */
  durationsSeconds: number[]
  supportsSeed: boolean
  supportsNegativePrompt: boolean
  supportsCallback: boolean
  supportsCancel: boolean
  supportsProviderIdempotency: boolean
  /** 是否异步任务（image 多为同步，video 多为异步）。 */
  async: boolean
  /** 标量参数 schema（透传 archetype params 的精简形）。 */
  parametersSchema: Record<string, unknown>
  /** 来源分类（§9.4 source）。 */
  source: ProviderSource
  /** 真实验收时间戳；**当前恒 null**（未做真机探测，见 sourceDetail）。 */
  verifiedAt: string | null
  /** 来源细目（Gate 0 §3 诚实标注）。 */
  sourceDetail: CapabilitySourceDetail
}

// ─────────────────────────────────────────────────────────────────────────────
// 源派生：vendor key → ProviderSource
// ─────────────────────────────────────────────────────────────────────────────

const BROWSER_BRIDGE_VENDORS = new Set(['jimeng-web', 'pavo-web'])
const LOCAL_RUNTIME_VENDORS = new Set(['comfyui-local', 'codex', 'codex-local', 'dreamina-cli'])

function sourceFromVendorKey(vendorKey: string): ProviderSource {
  if (BROWSER_BRIDGE_VENDORS.has(vendorKey)) return 'browser-bridge'
  if (LOCAL_RUNTIME_VENDORS.has(vendorKey)) return 'local-runtime'
  return 'official-api'
}

// ─────────────────────────────────────────────────────────────────────────────
// 结构化 archetype 输入（electron rootDir 约束：不 import src/，用结构类型）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Archetype 的结构投影——只含 `projectCapabilities` 需要的字段。
 * 由调用方在 src↔electron 边界从 `src/config/modelArchetypes` 解析后传入
 * （见 renderer 侧 `resolveArchetypeForModel`）。
 */
export type ArchetypeSlotProjection = {
  kind: string // ArchetypeReferenceSlotKind 并集
  max?: number
  roleName?: string
}

export type ArchetypeModeProjection = {
  id: string
  slots?: ArchetypeSlotProjection[]
  capabilities?: Array<{ maxOutputs?: number }>
  params?: Array<{ key?: string; options?: Array<{ value: string }> }>
}

export type ArchetypeProjection = {
  modes?: ArchetypeModeProjection[]
}

/** ArchetypeReferenceSlotKind → §9.2/§9.4 referenceRoles 的映射（消除 §2 双重角色命名）。 */
const SLOT_KIND_TO_ROLE: Record<string, string> = {
  first_frame: 'first-frame',
  last_frame: 'last-frame',
  image_ref: 'character',
  video_ref: 'video-reference',
  audio_ref: 'motion',
  source_video: 'video-reference',
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助：从 archetype 投影提取 modes / referenceRoles / maxReferences / maxOutputs
// ─────────────────────────────────────────────────────────────────────────────

function collectReferenceRoles(modes: ArchetypeModeProjection[] | undefined): { roles: string[]; maxReferences: number } {
  if (!modes || modes.length === 0) return { roles: [], maxReferences: 0 }
  const roleSet = new Set<string>()
  let maxSum = 0
  for (const mode of modes) {
    let modeMax = 0
    for (const slot of mode.slots ?? []) {
      const role = slot.roleName ?? SLOT_KIND_TO_ROLE[slot.kind] ?? 'reference'
      roleSet.add(role)
      modeMax += slot.max ?? 0
    }
    if (modeMax > maxSum) maxSum = modeMax // 取单 mode 最大参考数（跨 mode 不叠加）
  }
  return { roles: Array.from(roleSet), maxReferences: maxSum }
}

function collectMaxOutputs(modes: ArchetypeModeProjection[] | undefined): number {
  if (!modes) return 1
  let max = 1
  for (const mode of modes) {
    for (const cap of mode.capabilities ?? []) {
      if (typeof cap.maxOutputs === 'number' && cap.maxOutputs > max) max = cap.maxOutputs
    }
  }
  return max
}

/** 从 archetype params 的 aspect_ratio / resolution / duration 控件提取枚举。 */
function collectEnumFromParams(
  modes: ArchetypeModeProjection[] | undefined,
  paramKey: string,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  if (!modes) return out
  for (const mode of modes) {
    for (const ctrl of mode.params ?? []) {
      if (ctrl.key === paramKey && Array.isArray(ctrl.options)) {
        for (const opt of ctrl.options) {
          if (opt.value && !seen.has(opt.value)) {
            seen.add(opt.value)
            out.push(opt.value)
          }
        }
      }
    }
  }
  return out
}

function collectDurations(modes: ArchetypeModeProjection[] | undefined): number[] {
  const raw = collectEnumFromParams(modes, 'duration')
  // duration 控件值可能是 "5" 或 "5s"；转 number
  const nums = raw
    .map((v) => Number.parseFloat(String(v).replace(/[^0-9.]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0)
  return Array.from(new Set(nums)).sort((a, b) => a - b)
}

// ─────────────────────────────────────────────────────────────────────────────
// 单模型投影
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把一个 (vendor, model) 投影成 ProviderCapabilities（§9.4）。
 *
 * @param archetype 可选的 archetype 投影（由调用方在边界从 `src/config/modelArchetypes` 解析后传入）。
 *                  缺省时退化为最小能力（空 modes/roles，sourceDetail='catalog-seed'/'onboarding-doc'）。
 *
 * 找不到 vendor/model 时返回 null，**不抛错**。
 */
export function projectCapabilities(
  vendorKey: string,
  modelKey: string,
  archetype?: ArchetypeProjection | null,
): ProviderCapabilities | null {
  const vendors = listModelCatalogVendors() as Vendor[]
  const vendor = vendors.find((v) => v.key === vendorKey)
  if (!vendor) return null
  const models = listModelCatalogModels() as Model[]
  const model = models.find((m) => m.vendorKey === vendorKey && m.modelKey === modelKey)
  if (!model) return null

  const modes = archetype?.modes
  const { roles, maxReferences } = collectReferenceRoles(modes)
  const maxOutputs = collectMaxOutputs(modes)
  const aspectRatios = collectEnumFromParams(modes, 'aspect_ratio')
  const resolutions = collectEnumFromParams(modes, 'resolution')
  const durationsSeconds = collectDurations(modes)

  // onboarding agent 是否给过文档证据
  const sourceDetail: CapabilitySourceDetail = model.onboarding
    ? 'onboarding-doc'
    : archetype
      ? 'archetype'
      : vendor // 有 vendor seed 但无 archetype/onboarding
        ? 'catalog-seed'
        : 'unknown'

  // 迁移期保守默认：未在 archetype 显式声明的能力一律 false（不伪造支持）
  const hasNegativePromptParam = modes?.some((m) =>
    (m.params ?? []).some((p) => p.key === 'negative_prompt' || p.key === 'negativePrompt'),
  )

  return {
    providerId: vendorKey,
    modelKey,
    mediaKind: normalizeMediaKind(model.kind),
    modes: (modes ?? []).map((m) => m.id),
    referenceRoles: roles,
    maxReferences,
    maxOutputs,
    aspectRatios,
    resolutions,
    durationsSeconds,
    supportsSeed: false, // 迁移期：未显式声明 → false（Gate 3 起按真实 API 收紧）
    supportsNegativePrompt: Boolean(hasNegativePromptParam),
    supportsCallback: false,
    supportsCancel: vendorKey === 'codex' || vendorKey === 'comfyui-local', // Gate 0 §1.4：仅这两家
    supportsProviderIdempotency: false,
    async: model.kind === 'video' || model.kind === 'audio' || model.kind === 'model3d',
    parametersSchema: {}, // 迁移期空；Gate 3 compiler 起 fill
    source: sourceFromVendorKey(vendorKey),
    verifiedAt: null, // **当前恒 null**：未做真机探测（Gate 0 §3 诚实标注）
    sourceDetail,
  }
}

function normalizeMediaKind(kind: string): ProviderCapabilities['mediaKind'] {
  if (kind === 'image' || kind === 'video' || kind === 'model3d' || kind === 'audio') return kind
  // text 等不在 §9.4 mediaKind 范围 → 默认 image 占位（调用方应已按 kind 过滤）
  return 'image'
}

// ─────────────────────────────────────────────────────────────────────────────
// 批量读 API（单一入口，消除能力散落）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 列出所有（已启用 vendor 下的）模型的 ProviderCapabilities。
 * 调用方：模型下拉过滤、ReferenceBinding 角色匹配、后续 Gate 3 compiler。
 */
export function listProviderCapabilities(): ProviderCapabilities[] {
  const vendors = listModelCatalogVendors() as Vendor[]
  const out: ProviderCapabilities[] = []
  for (const vendor of vendors) {
    if (!vendor.enabled) continue
    const models = listModelCatalogModels() as Model[]
    for (const model of models) {
      if (model.vendorKey !== vendor.key || !model.enabled) continue
      const caps = projectCapabilities(vendor.key, model.modelKey)
      if (caps) out.push(caps)
    }
  }
  return out
}

/**
 * 便捷过滤：给定 mediaKind，返回支持该媒体且已启用 vendor 的 capabilities。
 */
export function listCapabilitiesByMediaKind(
  mediaKind: ProviderCapabilities['mediaKind'],
): ProviderCapabilities[] {
  return listProviderCapabilities().filter((c) => c.mediaKind === mediaKind)
}

// 防止未用 import 警告（listModelCatalogMappings 当前保留供 Gate 3 compiler 用）
void listModelCatalogMappings
