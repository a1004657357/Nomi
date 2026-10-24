import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { isProjectOpen, subscribeProjectOpened, withProjectAction, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import { buildStudioUrl } from '../../utils/appRoutes'
import i18n from '../../i18n'
import { logRendererError } from '../../desktop/rendererLog'

export type GenerationBatchPayload = {
  projectId?: string
  nodeIds?: unknown
}

let generationBatchConfirmationQueued = false

function resolveGenerationBatchNodeIds(info: GenerationBatchPayload): string[] {
  const requested = Array.isArray(info.nodeIds)
    ? Array.from(new Set(info.nodeIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 24)
    : []
  if (requested.length === 0) throw new Error('generation.batch 需要至少一个 nodeId')

  const store = useGenerationCanvasStore.getState()
  const existing = new Set(store.nodes.map((node) => node.id))
  const nodeIds = requested.filter((nodeId) => existing.has(nodeId))
  if (nodeIds.length === 0) throw new Error('generation.batch 的节点均不在当前画布')
  return nodeIds
}

async function confirmAndRunGenerationBatch(project: ProjectExecutionContext, nodeIds: string[]): Promise<void> {
  project.assertCurrent()
  const [{ confirmAndRunPlan }, { buildDependencyWaves }] = await Promise.all([
    import('../generationCanvas/components/batchPlanPreview'),
    import('../generationCanvas/runner/dependencyWaves'),
  ])
  project.assertCurrent()
  const state = useGenerationCanvasStore.getState()
  await confirmAndRunPlan(buildDependencyWaves(nodeIds, { nodes: state.nodes, edges: state.edges }), {
    initiator: 'agent',
    assertCurrent: async () => project.assertCurrent(),
    assertAuthorCurrent: async () => project.assertCurrent(),
  })
  project.assertCurrent()
}

export function queueGenerationBatchConfirmation(info: GenerationBatchPayload): unknown {
  return withProjectAction(project => {
  project.assertCurrent()
  if (info.projectId && info.projectId !== project.binding.projectId) throw new Error(i18n.t('runtime.capability.projectChanged'))
  if (generationBatchConfirmationQueued || useSpendConfirmStore.getState().pending) {
    throw new Error('已有生成确认正在等待处理')
  }
  const nodeIds = resolveGenerationBatchNodeIds(info)
  generationBatchConfirmationQueued = true
  void confirmAndRunGenerationBatch(project, nodeIds)
    .catch((error: unknown) => {
      logRendererError('capability-generation-batch-failed', error)
    })
    .finally(() => {
      generationBatchConfirmationQueued = false
    })
  return { awaitingConfirmation: true, nodeIds }
  }, () => { throw new Error(i18n.t('runtime.capability.projectChanged')) })
}

export async function activateProjectForCapability(projectId: string): Promise<{ active: true; projectId: string }> {
  const normalized = projectId.trim()
  if (!normalized) throw new Error('project.activate 需要 projectId')
  if (isProjectOpen(normalized)) return { active: true, projectId: normalized }
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe()
      reject(new Error('目标项目在 Nomi 中载入超时'))
    }, 20_000)
    const unsubscribe = subscribeProjectOpened(project => {
      if (project.binding.projectId !== normalized) return
      project.assertCurrent()
      window.clearTimeout(timeout)
      unsubscribe()
      resolve()
    })
    window.location.hash = buildStudioUrl(normalized)
  })
  if (!isProjectOpen(normalized)) throw new Error(i18n.t('runtime.capability.projectChanged'))
  return { active: true, projectId: normalized }
}

