import { toast } from '../../../ui/toast'
import { mintSpendGrant } from '../../api/taskApi'
import { describeGenerationCost, useSpendConfirmStore } from '../spend/spendConfirm'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  capabilityRecipeRetryInfo,
  retryCapabilityRecipeOnNode,
} from './capabilityRecipeController'

export async function confirmAndRetryCapabilityRecipeNode(nodeId: string): Promise<void> {
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  const info = node ? capabilityRecipeRetryInfo(node) : undefined
  if (!node || !info) {
    toast('当前节点没有可重试的配方失败结果', 'warning')
    return
  }

  const confirmed = await useSpendConfirmStore.getState().requestConfirm({
    title: '重试配方失败结果',
    message: describeGenerationCost(info.taskCount, info.recipeId.startsWith('video.') ? 'video' : 'image'),
    confirmLabel: '重试失败结果',
    source: 'user',
    details: [
      { label: '配方', value: info.recipeId },
      { label: '失败结果', value: `${info.failedCount} 个` },
      { label: '生成请求', value: `${info.taskCount} 次` },
    ],
  })
  if (!confirmed) return

  try {
    const grantId = await mintSpendGrant([nodeId], info.taskCount)
    const outcome = await retryCapabilityRecipeOnNode(nodeId, { grantId })
    if (outcome.failureCount > 0) {
      toast(`仍有 ${outcome.failureCount} 个结果生成失败，可稍后再次重试`, 'warning')
    }
  } catch (error) {
    toast(error instanceof Error && error.message ? error.message : '配方重试失败', 'error')
  }
}
