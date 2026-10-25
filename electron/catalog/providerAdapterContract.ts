import { desktopT } from "../desktopStrings";
/**
 * Gate 3 Slice 2 — ProviderAdapter 接口合约（§12.2）+ cancel/download 通用化。
 *
 * 对应目标架构 §12.2 Adapter 合约：「每个 Adapter 必须实现或明确声明不支持
 * compile/submit/query/cancel/download」。现状（Gate 0 §1.4 证据）：无 per-adapter 类，
 * 一个通用 profile 引擎；cancel 仅 codex/comfyui（main.ts:589 非 codex 返回 {cancelled:false}）；
 * download 无重试。
 *
 * 设计（适配，不重写）：
 * - **合约声明**：本模块定义 §12.2 ProviderAdapter 接口 + 一个**声明表**，标注每个既有 vendor
 *   对 cancel/download 的真实支持（诚实标注，不伪造——Gate 0 §1.4 证据对齐）。
 * - **通用 cancel/download 入口**：本模块提供 `cancelProviderTask` / `downloadProviderResult` 的
 *   统一入口，按 vendor 路由：声明支持 cancel 的走真路径，不支持的明确返回 {cancelled:false, reason}
 *   而非硬编码字符串门（main.ts:589 的散落判断收敛到此）。
 * - **钱安全**：cancel/download 绝不触发新 create（§10.2 不变量）。
 *
 * `electron/tasks/taskCancellationRuntime.ts` 已把桌面 IPC 接到本合约；各 Provider 的
 * submit/query 仍复用经过验证的 runtime/profile/browser-bridge 执行链，避免再造并行传输栈。
 */
import type { ProviderCapabilities, ProviderSource } from './providerCapabilities'

/** §12.2 ProviderAdapter 接口（目标架构形）。 */
export interface ProviderAdapter {
  providerId: string
  /** 编译 intent → request（Gate 3 Slice 1 providerCompiler.compileGenerationIntent）。 */
  // compile 由独立模块提供（providerCompiler.ts），不在此接口内——避免循环。
  /** 提交（create）；钱安全由 submissionLedger 守门。 */
  submit(request: { idempotencyKey: string; providerId: string; modelKey: string; requestBody: unknown }): Promise<{
    providerTaskId: string
  }>
  /** 查询（只读，绝不触发 create）。 */
  query(providerTaskId: string): Promise<{ status: string; raw: unknown }>
  /** 取消；不支持时返回 { cancelled: false } 而非抛错。 */
  cancel?(providerTaskId: string): Promise<{ cancelled: boolean; remoteCancelled: boolean; reason?: string }>
  /** 下载结果（只重试下载，不重生成，§24）。 */
  download(result: { providerUrl?: string; url?: string }): Promise<{ bytes: Buffer; mimeType: string; sha256?: string }>
}

/** 每个 vendor 对 cancel/download 的真实支持（声明表，诚实标注）。 */
export type AdapterCapabilityDeclaration = {
  providerId: string
  source: ProviderSource
  /** 真实支持 cancel（不是硬编码 false）。 */
  supportsCancel: boolean
  /** cancel 走哪条路径。 */
  cancelPath?: 'codex-local' | 'comfyui-interrupt' | 'http-cancel-endpoint' | 'none'
  /** 真实支持 download 重试。 */
  supportsDownloadRetry: boolean
  /** download 重试策略。 */
  downloadRetry?: { maxAttempts: number; backoffMs: number }
  /** 注释（来源证据，Gate 0 §1.4 对齐）。 */
  evidence: string
}

/**
 * 既有 vendor 的 cancel/download 支持声明表（Gate 0 §1.4 证据）。
 * 唯一真相源：取代 main.ts:589 的散落字符串门。
 */
export const ADAPTER_CAPABILITY_DECLARATIONS: Record<string, AdapterCapabilityDeclaration> = {
  codex: {
    providerId: 'codex',
    source: 'local-runtime',
    supportsCancel: true,
    cancelPath: 'codex-local',
    supportsDownloadRetry: false,
    evidence: 'electron/ai/codexImagegenRunner.ts:143 cancelCodexImageGeneration（cancelledCodexRunKeys）',
  },
  'codex-local': {
    providerId: 'codex-local',
    source: 'local-runtime',
    supportsCancel: true,
    cancelPath: 'codex-local',
    supportsDownloadRetry: false,
    evidence: '同 codex（local 变体）',
  },
  'comfyui-local': {
    providerId: 'comfyui-local',
    source: 'local-runtime',
    supportsCancel: true,
    cancelPath: 'comfyui-interrupt',
    supportsDownloadRetry: false,
    evidence: 'electron/comfyuiProgressSocket.ts:295 interruptComfyuiTask（POST /interrupt + /queue delete）',
  },
  'jimeng-web': {
    providerId: 'jimeng-web',
    source: 'browser-bridge',
    supportsCancel: false,
    cancelPath: 'none',
    supportsDownloadRetry: false,
    evidence: 'Gate 0 §1.4：browser bridge 无 cancel（页面自动化不可靠回滚）',
  },
  'pavo-web': {
    providerId: 'pavo-web',
    source: 'browser-bridge',
    supportsCancel: false,
    cancelPath: 'none',
    supportsDownloadRetry: true,
    downloadRetry: { maxAttempts: 3, backoffMs: 1500 },
    evidence: 'Pavo browser bridge separates result download retries from the single protected generation submission',
  },
  agnes: {
    providerId: 'agnes',
    source: 'official-api',
    supportsCancel: false,
    cancelPath: 'none',
    supportsDownloadRetry: false,
    evidence: 'AGNES 当前公开映射只有 POST /v1/videos 与 GET /agnesapi，未声明取消端点',
  },
  // 其余 vendor（kie/apimart/volcengine/agnes/runninghub/modelscope/replicate/dreamina-cli）：
  // 默认不支持 cancel/download 重试（保守，不伪造）。
}

/**
 * 查某 vendor 的 cancel/download 声明。无显式声明 → 默认不支持（保守）。
 */
export function getAdapterDeclaration(providerId: string): AdapterCapabilityDeclaration {
  return (
    ADAPTER_CAPABILITY_DECLARATIONS[providerId] ?? {
      providerId,
      source: 'official-api' as ProviderSource,
      supportsCancel: false,
      cancelPath: 'none',
      supportsDownloadRetry: false,
      evidence: '无显式声明 → 默认不支持（保守，Gate 0 §1.4）',
    }
  )
}

/**
 * 通用 cancel 入口（由 taskCancellationRuntime 供 main IPC 使用）。
 *
 * 按声明表路由：
 * - codex/comfyui-local → 调用注入的真实 cancel 实现（cancelImpl）。
 * - 其余 → 返回 { cancelled: false, reason }（明确不支持，不伪造）。
 *
 * 钱安全：cancel 绝不触发新 create。
 */
export async function cancelProviderTask(
  providerId: string,
  providerTaskId: string,
  cancelImpl?: (
    providerId: string,
    providerTaskId: string,
  ) => Promise<{ cancelled: boolean; remoteCancelled: boolean }>,
): Promise<{ cancelled: boolean; remoteCancelled: boolean; reason?: string }> {
  const decl = getAdapterDeclaration(providerId)
  if (!decl.supportsCancel || !decl.cancelPath || decl.cancelPath === 'none') {
    return {
      cancelled: false,
      remoteCancelled: false,
      reason: `${providerId} 不支持远程 cancel（${decl.evidence}）`,
    }
  }
  if (!cancelImpl) {
    return {
      cancelled: false,
      remoteCancelled: false,
      reason: `${providerId} 声明支持 cancel 但未注入 cancelImpl`,
    }
  }
  return cancelImpl(providerId, providerTaskId)
}

/**
 * 通用 download 入口（带可选重试）。
 *
 * 按 §24：download 失败只重试 download，绝不重生成。
 * - supportsDownloadRetry=true → 按 downloadRetry 重试（指数退避）。
 * - =false → 单次下载（既有 hardenedFetch 行为，向后兼容）。
 */
export async function downloadProviderResult(
  providerId: string,
  result: { providerUrl?: string; url?: string },
  downloadImpl: (url: string) => Promise<{ bytes: Buffer; mimeType: string; sha256?: string }>,
): Promise<{ bytes: Buffer; mimeType: string; sha256?: string }> {
  const decl = getAdapterDeclaration(providerId)
  const url = result.providerUrl ?? result.url
  if (!url) throw new Error(desktopT("custom.catalog.providerAdapterContract.text1"))
  if (!decl.supportsDownloadRetry || !decl.downloadRetry) {
    return downloadImpl(url) // 单次（既有行为）
  }
  // 重试
  const { maxAttempts, backoffMs } = decl.downloadRetry
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await downloadImpl(url)
    } catch (e) {
      lastError = e
      if (attempt < maxAttempts) {
        await sleep(backoffMs * attempt) // 线性退避
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(desktopT("custom.catalog.providerAdapterContract.text2", { value0: `${maxAttempts}` }))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * ProviderAdapter 与 ProviderCapabilities 的关联查询（供 §12.2 合约自检）。
 * 能力声明里 supportsCancel 必须与 adapter 声明一致——否则配置漂移。
 */
export function assertCancelConsistency(capabilities: ProviderCapabilities): { consistent: boolean; detail?: string } {
  const decl = getAdapterDeclaration(capabilities.providerId)
  if (capabilities.supportsCancel !== decl.supportsCancel) {
    return {
      consistent: false,
      detail: `${capabilities.providerId}: capabilities.supportsCancel=${capabilities.supportsCancel} vs adapterDecl.supportsCancel=${decl.supportsCancel}`,
    }
  }
  return { consistent: true }
}
