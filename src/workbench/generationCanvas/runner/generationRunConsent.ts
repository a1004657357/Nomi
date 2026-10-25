import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { AssetUploadConsentCancelledError, hasLocalAssetReference, resolveAssetUploadConsent } from './assetUploadConsent'
import type { HostingDisclosure } from '../spend/spendConfirm'
import i18n from '../../../i18n'

/**
 * 公共临时托管的**已决**同意。注意它是 `RunGenerationNodeOptions` 里唯一必填的字段——
 * 这是故意的，也是 F16b 的根治手法。
 *
 * 为什么必填：旧版把它写成可选的 `assetUploadConsent?: 'allow'`，runner 里再用
 * 「没传就自己弹一张卡」兜底。结果是「忘了传」这件事完全没有信号——编译过、测试绿、
 * 只有真用户在 agent / MCP 路径上每次生成都被第二张卡拦一下。改成必填后，
 * 「谁来问用户」这个问题在**编译期**就必须被每个调用点回答，答不出就不给过。
 *
 * 只有两个合法答案，都必须来自 resolveAssetUploadConsent 的解析结果：
 * - `'allow'`     ：用户已在花钱确认卡上同意（或策略/KIE 判定无需再问）。
 * - `'not-needed'`：这次生成压根不碰公共托管（无本地素材 / 本地 ComfyUI 跑）。
 */
export type AssetUploadConsentDecision = 'allow' | 'not-needed'

async function buildConsentNode(node: GenerationCanvasNode): Promise<Pick<GenerationCanvasNode, 'meta' | 'references'>> {
  const state = useGenerationCanvasStore.getState()
  const resolved = resolveGenerationReferences(node, { nodes: state.nodes, edges: state.edges })
  return {
    ...node,
    references: [
      ...(node.references || []),
      ...resolved.referenceImages,
      ...resolved.referenceVideos,
      ...resolved.referenceAudios,
      ...(resolved.firstFrameUrl ? [resolved.firstFrameUrl] : []),
      ...(resolved.lastFrameUrl ? [resolved.lastFrameUrl] : []),
      ...(resolved.relayFromVideoUrl ? [resolved.relayFromVideoUrl] : []),
    ],
  }
}

export async function resolveHostingDisclosure(node: GenerationCanvasNode | undefined): Promise<{ allowed: boolean; disclosure?: HostingDisclosure }> {
  if (!node) return { allowed: true }
  const consentNode = await buildConsentNode(node)
  const resolution = await resolveAssetUploadConsent(consentNode)
  if (!resolution.allowed) return { allowed: false }
  if (!resolution.needsConfirmation) return { allowed: true }
  return {
    allowed: true,
    disclosure: {
      message: i18n.t('generationCommon.spendHostingDisclosure.message'),
      rememberLabel: i18n.t('generationCommon.spendHostingDisclosure.remember'),
      onRemember: resolution.remember,
    },
  }
}

/**
 * 给**自主路径**（外部 agent / MCP 能力）解析托管同意——这些路径没有人坐在屏幕前，
 * 弹卡等于把整条自动化挂死在一个没人点的对话框上。
 *
 * 判据完全复用同一个 resolveAssetUploadConsent，不另立一套语义：
 * - 策略 deny → 抛 AssetUploadConsentCancelledError，这次生成不发（诚实失败，理由回给调用方）；
 * - 还需要问一次（策略 ask + 有本地素材 + KIE 没配）→ 同样**拒发**。自动化不能替用户
 *   默默把素材传到公共托管上；把「去设置里配 KIE，或把托管策略改成允许」这句人话回给
 *   agent，由它转达。这是 D4「缺口明着标」：宁可这一次不跑，也不偷偷上传。
 * - 其余 → 'allow' / 'not-needed'，照常跑。
 */
export async function resolveAutonomousUploadConsent(
  nodeId: string,
): Promise<AssetUploadConsentDecision> {
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return 'not-needed'
  const consentNode = await buildConsentNode(node)
  if (!hasLocalAssetReference(consentNode)) return 'not-needed'
  const resolution = await resolveAssetUploadConsent(consentNode)
  if (!resolution.allowed) throw new AssetUploadConsentCancelledError()
  if (resolution.needsConfirmation) {
    throw new Error(i18n.t('generationCommon.spendHostingDisclosure.autonomousBlocked'))
  }
  return 'allow'
}
