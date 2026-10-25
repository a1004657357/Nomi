// 生成提交的重试策略（哪些失败值得自动重试、重试几次、退避多久）。只管判定与等待，
// 不碰节点状态——结局投递由 generationRunController / runProjectDelivery 负责。
import { isGenerationPhaseStalledError } from './generationPhaseDeadline'
import { isRecoverableTimeoutError } from './recoverableTimeout'
import { parseVendorErrorFromMessage } from './vendorErrorIpc'
import { matchNomiErrorCode } from '../../../../electron/shared/nomiErrorCodes'

type RetryableGenerationError = Error & {
  status?: number
  code?: unknown
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 350

export function isRetryableGenerationError(error: unknown, kind?: string): boolean {
  // 自动重试 = 重新提交 = 再付一次钱。这两类按**类型**先排除，不交给下面的文案判断：
  // - 可找回：钱已花、任务在上游，该做的是免费重新拉取。它的文案现在就是最后一次取回错误的原话
  //   （可能恰好含 timeout / Failed to fetch），按文案判会把一次已付费的任务再提交一遍；
  // - 阶段到期：我们自己决定不再等了（提交那一格到期时，钱可能已经花了）。
  if (isRecoverableTimeoutError(error) || isGenerationPhaseStalledError(error)) return false
  if (!(error instanceof Error)) return false
  const localCode = matchNomiErrorCode(error.message)
  if (localCode === 'codex-timeout' || localCode === 'codex-network' || localCode === 'operation-cancelled') return false
  const structured = parseVendorErrorFromMessage(error.message)
    ?? (error as Error & { structured?: { retryable?: boolean; category?: string } }).structured
  if (structured?.retryable === false || structured?.category === 'submission-unknown'
    || localCode === 'submission-unknown') return false
  // Text-only transport failures cannot prove that a paid submission is safe to repeat.
  if (structured) return structured.retryable === true && structured.category !== 'timeout'
  if (error instanceof TypeError) return kind === 'text'
  const candidate = error as RetryableGenerationError
  if (typeof candidate.status === 'number') {
    return (
      candidate.status === 409 ||
      candidate.status === 425 ||
      candidate.status === 429 ||
      candidate.status >= 500
    )
  }
  const message = candidate.message.trim().toLowerCase()
  if (/timeout|timed out|failed to fetch|fetch failed|networkerror|socket/.test(message)) return kind === 'text'
  return message.includes('temporarily unavailable') || message.includes('rate limit')
}

export function normalizeRetryAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS
  return Math.max(1, Math.min(5, Math.floor(value)))
}

export function normalizeBaseDelayMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BASE_DELAY_MS
  return Math.max(0, Math.min(3_000, Math.floor(value)))
}

export async function waitForRetry(attempt: number, baseDelayMs: number, signal?: AbortSignal): Promise<void> {
  if (baseDelayMs <= 0) return
  if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const abort = () => { globalThis.clearTimeout(timer); reject(new DOMException('Generation cancelled', 'AbortError')) }
    const timer = globalThis.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, baseDelayMs * 2 ** Math.max(0, attempt - 1))
    signal?.addEventListener('abort', abort, { once: true })
  })
}
