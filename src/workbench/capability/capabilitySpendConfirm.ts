import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { confirmCredentialProbeSpend, spendModelLine } from './credentialProbeSpendCard'
import type { SpendQuoteLine } from '../../../electron/shared/contracts/spendQuote'
import i18n from '../../i18n'

export type SpendConfirmPayload = {
  projectId?: string
  projectName?: string
  nodeId?: string
  intent?: string
  vendor?: string
  modelKey?: string
  prompt?: string
  /** 主进程带上：这次确认还会换来「本会话该项目后续生成免问」→ 卡上多写一句授权范围。 */
  quote?: SpendQuoteLine
  /**
   * 这一张卡覆盖几次付费调用（批量确认）。>1 时卡上必须显示——用户点的是「这一批」，
   * 只给一个总价，他无从知道自己刚批掉的是 1 次还是 13 次。
   */
  callCount?: number
}

function describeIntent(intent: string | undefined): string {
  const normalized = String(intent || '')
  if (normalized === 'image' || normalized === 'video' || normalized === 'audio' || normalized === 'text') {
    return i18n.t(`runtime.capability.intent.${normalized}`)
  }
  return i18n.t('runtime.capability.intent.fallback')
}

export async function confirmSpendFromMainProcess(info: SpendConfirmPayload): Promise<{ confirmed: boolean }> {
  // 凭据验证不挂在任何节点上（用户此刻在接入页，不在画布），措辞与明细
  // 另有一家（`credentialProbeSpendCard.ts`），但弹的仍是全仓唯一那张卡。
  if (info.intent === 'credential-probe') return confirmCredentialProbeSpend(info)
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((item) => item.id === info.nodeId)
  const nodeLabel =
    node?.title?.trim() ||
    (typeof node?.prompt === 'string' && node.prompt.trim()
      ? node.prompt.trim().slice(0, 24)
      : i18n.t('runtime.capability.newNode'))
  // 参考图门 vs 生成门（Phase B）：定妆/场景卡（meta.referenceSheet）= 参考图门（相机图标+措辞），否则生成门。
  const isReference = Boolean(node?.meta && (node.meta as Record<string, unknown>).referenceSheet === true)
  const promptPreview = typeof info.prompt === 'string' && info.prompt.trim() ? info.prompt.trim().slice(0, 60) : ''
  const projectName = typeof info.projectName === 'string' ? info.projectName.trim() : ''
  // 拆解是**用户自己点的**那一下，不是 AI 代他花钱：金币图标、说清这一批要发几次调用。
  const isDeconstruct = info.intent === 'deconstruct'
  const callCount = typeof info.callCount === 'number' && info.callCount > 1 ? info.callCount : 0
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    kind: isReference ? 'reference' : 'generation',
    title: isDeconstruct
      ? i18n.t('runtime.capability.deconstructTitle')
      : isReference
        ? i18n.t('runtime.capability.referenceTitle')
        : i18n.t('runtime.capability.spendTitle', { intent: describeIntent(info.intent) }),
    message: [
      isDeconstruct
        ? i18n.t('runtime.capability.deconstructMessage')
        : promptPreview
          ? i18n.t('runtime.capability.spendMessageWithPrompt', {
              prompt: `${promptPreview}${info.prompt && info.prompt.length > 60 ? '…' : ''}`,
            })
          : i18n.t('runtime.capability.spendMessage'),
    ].join('\n'),
    confirmLabel: i18n.t(isDeconstruct ? 'runtime.capability.confirmDeconstruct' : 'runtime.capability.confirmGenerate'),
    source: isDeconstruct ? 'user' : 'agent',
    // 不印金额行（2026-09-26 用户拍板：官方额度上线前隐藏价格维度）。
    details: [
      // 批量确认必须报出「这一下批掉几次调用」，用户才看得出批量有多大。
      ...(callCount ? [{ label: i18n.t('runtime.capability.callCount'), value: String(callCount) }] : []),
      // 项目行放第一位：用户可能不在这个项目里，先让他知道花在哪个项目。
      ...(projectName ? [{ label: i18n.t('runtime.capability.project'), value: projectName }] : []),
      { label: i18n.t('runtime.capability.node'), value: nodeLabel },
      { label: i18n.t('runtime.capability.model'), value: spendModelLine(info.vendor, info.modelKey) },
      ...(isDeconstruct ? [] : [{ label: i18n.t('runtime.capability.output'), value: describeIntent(info.intent) }]),
    ],
  })
  return { confirmed: Boolean(ok) }
}

