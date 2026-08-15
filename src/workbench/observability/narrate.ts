// 人话翻译层(harness 总方案 §7.2:narrate 穷举注册表)。
// 纪律:进度/错误展示组件**只准经 narrate 取文案**,字面量文案 = review 必拒;
// Record 穷举 → 新增 phase 不补人话直接 typecheck 红(结构性防"底层在动、界面失语")。
// S2 先覆盖生成进度域;错误 hint(classifyGenerationError 七段)按总方案在 S4 迁入。
// 设计系统铁律呼应:No fake progress——没有真实百分比就不给 percent,用"已等 N 秒"说真话。
import i18n from '../../i18n'

export type GenerationProgressPhase =
  | 'queued' //      已入队,还没开始
  | 'resolving' //   正在确认模型与参数(catalog 解析)
  | 'requesting' //  正在把任务发给模型(vendor HTTP 出门)
  | 'waiting' //     模型已接单,排队中(拿到 taskId,首个非终态)
  | 'generating' //  模型生成中(轮询进行时)
  | 'still-generating' // 超过常规时长仍在生成(软超时后,后台继续等结果)
  | 'retrying' //    网络波动重试中
  | 'rate-limited' // 等待服务商的下一次可提交窗口
  | 'finalizing' //  正在保存结果(本地化/归一)
  | 'comfyui-node' // ComfyUI ws 逐节点进度(P 轨:真实百分比,不违背 No fake progress)
  | 'comfyui-queued' // ComfyUI 服务器队列排队中(ws status + /queue 位次)

export type ProgressNarrationContext = {
  elapsedMs?: number
  attempt?: number
  maxAttempts?: number
  waitMs?: number
  /** comfyui-node：当前执行的节点 class + 第几/共几个。 */
  currentClass?: string
  startedNodes?: number
  totalNodes?: number
  /** comfyui-queued：前面还有几个任务。 */
  queueAhead?: number
  providerKey?: string
  activeForProvider?: number
  providerLimit?: number
}

const NARRATE_PROGRESS: Record<GenerationProgressPhase, (ctx: ProgressNarrationContext) => string> = {
  queued: (ctx) =>
    typeof ctx.queueAhead === 'number' && ctx.providerKey && ctx.providerLimit
      ? i18n.t('generationCommon.observability.progress.providerQueued', {
          provider: ctx.providerKey,
          active: ctx.activeForProvider || 0,
          limit: ctx.providerLimit,
          count: ctx.queueAhead,
        })
      : i18n.t('generationCommon.observability.progress.queued'),
  resolving: () => i18n.t('generationCommon.observability.progress.resolving'),
  requesting: () => i18n.t('generationCommon.observability.progress.requesting'),
  waiting: () => i18n.t('generationCommon.observability.progress.waiting'),
  generating: (ctx) =>
    typeof ctx.elapsedMs === 'number' && ctx.elapsedMs >= 5000
      ? i18n.t('generationCommon.observability.progress.generatingElapsed', {
          seconds: Math.round(ctx.elapsedMs / 1000),
        })
      : i18n.t('generationCommon.observability.progress.generating'),
  // 软超时后:视频较慢仍在跑,后台继续等。说真话(已等 N 分钟),不假装快完成。
  'still-generating': (ctx) =>
    typeof ctx.elapsedMs === 'number'
      ? i18n.t('generationCommon.observability.progress.stillGeneratingElapsed', {
          minutes: Math.round(ctx.elapsedMs / 60000),
        })
      : i18n.t('generationCommon.observability.progress.stillGenerating'),
  retrying: (ctx) =>
    ctx.attempt && ctx.maxAttempts
      ? i18n.t('generationCommon.observability.progress.retryingAttempt', {
          attempt: ctx.attempt,
          maxAttempts: ctx.maxAttempts,
        })
      : i18n.t('generationCommon.observability.progress.retrying'),
  'rate-limited': (ctx) =>
    typeof ctx.waitMs === 'number'
      ? i18n.t('generationCommon.observability.progress.rateLimitedWait', {
          seconds: Math.max(1, Math.ceil(ctx.waitMs / 1000)),
        })
      : i18n.t('generationCommon.observability.progress.rateLimited'),
  finalizing: () => i18n.t('generationCommon.observability.progress.finalizing'),
  'comfyui-node': (ctx) =>
    ctx.currentClass && ctx.startedNodes && ctx.totalNodes
      ? i18n.t('generationCommon.observability.progress.comfyNodeAt', {
          cls: ctx.currentClass,
          current: ctx.startedNodes,
          total: ctx.totalNodes,
        })
      : i18n.t('generationCommon.observability.progress.comfyNode'),
  'comfyui-queued': (ctx) =>
    typeof ctx.queueAhead === 'number'
      ? i18n.t('generationCommon.observability.progress.comfyQueuedAhead', { count: ctx.queueAhead })
      : i18n.t('generationCommon.observability.progress.comfyQueued'),
}

export function narrateProgress(phase: GenerationProgressPhase, ctx: ProgressNarrationContext = {}): string {
  return NARRATE_PROGRESS[phase](ctx)
}

// ---------------------------------------------------------------------------
// 生成错误词表(S4-2:classifyGenerationError 的唯一文案来源)。
// structured 路径(VendorRequestError.category 查表)与 legacy 正则路径都只产 kind,
// 文案在这一张表里——reason/hint 永不散落第二处(P1)。
// ---------------------------------------------------------------------------

export type GenerationErrorKind =
  | 'auth'
  | 'balance'
  | 'quota'
  | 'codex-timeout'
  | 'codex-network'
  | 'poll-timeout'
  | 'network'
  | 'model-config'
  | 'model-not-open'
  | 'model-unavailable-upstream'
  | 'model-retired'
  | 'image-route-disabled'
  | 'account-gate'
  | 'content-policy'
  | 'asset-fetch'
  | 'web-bridge'
  | 'input-image-blocked'
  | 'asset-upload-failed'
  | 'server'
  | 'input'
  | 'output-truncated'
  | 'unknown'

const ERROR_KEY_BY_KIND: Record<GenerationErrorKind, string> = {
  auth: 'auth',
  balance: 'balance',
  quota: 'quota',
  'codex-timeout': 'codexTimeout',
  'codex-network': 'codexNetwork',
  'poll-timeout': 'pollTimeout',
  network: 'network',
  'model-config': 'modelConfig',
  'model-not-open': 'modelNotOpen',
  'model-unavailable-upstream': 'modelUnavailableUpstream',
  'model-retired': 'modelRetired',
  'image-route-disabled': 'imageRouteDisabled',
  'account-gate': 'accountGate',
  'content-policy': 'contentPolicy',
  'asset-fetch': 'assetFetch',
  'web-bridge': 'webBridge',
  'input-image-blocked': 'inputImageBlocked',
  'asset-upload-failed': 'assetUploadFailed',
  server: 'server',
  input: 'input',
  'output-truncated': 'outputTruncated',
  unknown: 'unknown',
}

export function narrateGenerationError(kind: GenerationErrorKind): { reason: string; hint: string } {
  const key = ERROR_KEY_BY_KIND[kind]
  return {
    reason: i18n.t(`generationCommon.observability.error.${key}.reason`),
    hint: i18n.t(`generationCommon.observability.error.${key}.hint`),
  }
}

// ---------------------------------------------------------------------------
// 每类错误的「下一步动作」（2026-07-30 用户拍板）。
//
// 病根：错误卡的主按钮一律是「重试」——可确定性失败（上游没这个模型 / Key 无效 / 模型已下线）
// 重试一万次都是同样结果，那个红按钮在骗用户。分类器早能分 15 类，却没有一类说得出「该干嘛」。
//
// 穷举 Record：新增错误类不补动作 → typecheck 直接红（同 NARRATE_PROGRESS 的结构性防失语纪律）。
// 只有三种动作，因为只有这三件事用户真做得到；「改提示词」不设按钮——提示词框本来就在错误卡
// 正下方、一直可编辑，加个按钮是多余（R2：好产品不靠按钮解释），那两类的动作给 retry。
// ---------------------------------------------------------------------------

export type GenerationErrorAction = 'retry' | 'switch-model' | 'open-model-access'

const ACTION_BY_KIND: Record<GenerationErrorKind, GenerationErrorAction> = {
  // 换模型才有救：上游/目录层面就没有这个模型，配置和重试都改不了它。
  'model-unavailable-upstream': 'switch-model',
  'model-retired': 'switch-model',
  // 参考图被内容安全挡下：同一张图 + 同一个模型 = 同一个判定，重试是确定性再撞（2026-07-31
  // 用户真机：方舟 Seedance 拒写实人脸参考图）。用户真正的两条路是「换图」和「换模型」，
  // 换图就在画布上（连着的那个节点，不需要按钮），所以按钮给「换个模型」——各家审核松紧不同。
  'input-image-blocked': 'switch-model',
  // 去模型接入：密钥/开通/分组/档位/配置——都在那一页能解。
  auth: 'open-model-access',
  balance: 'open-model-access',
  'model-config': 'open-model-access',
  'model-not-open': 'open-model-access',
  'image-route-disabled': 'open-model-access',
  'account-gate': 'open-model-access',
  // 重试是对的动作：偶发/限流/超时，等一等再来确实可能成。
  // 免费匿名图床挂掉通常是偶发（下一分钟可能就好了），所以主动作仍是重试；
  // 「一劳永逸」那条（接一个自带上传通道的服务商）写在 hint 里，不占按钮。
  'asset-upload-failed': 'retry',
  quota: 'retry',
  'codex-timeout': 'retry',
  'codex-network': 'retry',
  'poll-timeout': 'retry',
  network: 'retry',
  server: 'retry',
  // 改提示词/参数后重试（按钮只给 retry，改的地方就在下方 composer）。
  'content-policy': 'retry',
  'asset-fetch': 'retry',
  'web-bridge': 'retry',
  input: 'retry',
  'output-truncated': 'retry',
  unknown: 'retry',
}

/**
 * 主动作 + 次动作。次动作恒为「另一个最可能有用的」：主动作不是重试 → 次给重试（想试还能试，
 * 不堵死用户）；主动作就是重试 → 次给换模型（等不及就换一家）。
 */
export function narrateGenerationErrorActions(kind: GenerationErrorKind): {
  primary: GenerationErrorAction
  secondary: GenerationErrorAction
} {
  const primary = ACTION_BY_KIND[kind]
  return { primary, secondary: primary === 'retry' ? 'switch-model' : 'retry' }
}

/** 动作按钮文案（次动作用 `.alt` 变体，如「仍要重试」——避免和主按钮读起来一样重）。 */
export function narrateErrorActionLabel(action: GenerationErrorAction, variant: 'primary' | 'secondary'): string {
  const key = action === 'switch-model' ? 'switchModel' : action === 'open-model-access' ? 'modelAccess' : 'retry'
  return i18n.t(`generationCommon.observability.action.${key}.${variant === 'secondary' ? 'alt' : 'main'}`)
}
