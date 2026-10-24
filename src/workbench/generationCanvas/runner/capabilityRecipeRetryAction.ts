import i18n from "../../../i18n"
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
    toast(i18n.t("customWorkflow.thisNodeHasNoFailedRecipeResultsTo"), 'warning')
    return
  }

  const confirmed = await useSpendConfirmStore.getState().requestConfirm({
    title: i18n.t("customWorkflow.retryFailedRecipeResults"),
    message: describeGenerationCost(info.taskCount, info.recipeId.startsWith('video.') ? 'video' : 'image'),
    confirmLabel: i18n.t("customWorkflow.retryFailedResults"),
    source: 'user',
    details: [
      { label: i18n.t("customWorkflow.recipe"), value: info.recipeId },
      { label: i18n.t("customWorkflow.failedResults"), value: `${info.failedCount} 个` },
      { label: i18n.t("customWorkflow.generationRequests"), value: `${info.taskCount} 次` },
    ],
  })
  if (!confirmed) return

  try {
    const grantId = await mintSpendGrant([nodeId], info.taskCount)
    const outcome = await retryCapabilityRecipeOnNode(nodeId, { grantId })
    if (outcome.failureCount > 0) {
      toast(i18n.t("customWorkflow.resultsStillFailedTryAgainLater", { v0: outcome.failureCount }), 'warning')
    }
  } catch (error) {
    toast(error instanceof Error && error.message ? error.message : i18n.t("customWorkflow.recipeRetryFailed"), 'error')
  }
}
