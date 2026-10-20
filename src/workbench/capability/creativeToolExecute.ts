import { creativeComponentArgumentSchemas, creativeComponentResultSchema, type CreativeComponentResult } from '../../../electron/shared/agentCapabilities/creativeComponent'
import { assertProjectAgentBinding, sameProjectAgentBinding, type ProjectBinding } from '../../../electron/shared/projectBinding'
import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import { confirmDialog } from '../../design'
import { tryApplyCapabilityToolCall } from '../generationCanvas/agent/capabilityRecipeToolHandlers'
import { tryApplyCinematicDirectorToolCall } from '../generationCanvas/agent/cinematicDirectorToolHandlers'
import { withCanvasGestureContext, type CanvasGestureContext } from '../generationCanvas/events/canvasGestureContext'
import { readVibingDirectorState } from '../generationCanvas/nodes/VibingDirectorEditor'
import { evaluateVibingDirectorToolCall } from '../generationCanvas/nodes/vibingDirector/vibingDirectorAgentProtocol'
import { applyVibingDirectorPlan } from '../generationCanvas/nodes/vibingDirector/vibingDirectorState'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { withProjectAction, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import { persistActiveWorkbenchProjectNow } from '../project/workbenchProjectSession'

const LOCAL_WRITES = new Set([
  'apply_film_bible_patch', 'select_asset_revision', 'archive_asset_revision',
  'cancel_provider_task', 'save_creative_resource', 'handoff_model3d',
])
const DIRECT_READS = new Set([
  'read_project_summary', 'read_film_bible', 'read_storyboard', 'read_shot_spec',
  'read_asset_registry', 'read_task_status', 'propose_film_bible_patch',
  'propose_shot_patch', 'propose_generation_plan', 'propose_timeline_assembly',
])
const inspectedDirectors = new Map<string, { binding: ProjectBinding; state: unknown }>()

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function result(status: CreativeComponentResult['status'], summary: string, data: unknown): CreativeComponentResult {
  return creativeComponentResultSchema.parse({ status, summary, data, generationStarted: false, autoResubmit: false })
}

function invalid(): never { throw new SurfacePortWireError('capability_input_invalid') }

async function executeVibing(
  toolName: string, args: Record<string, unknown>, project: ProjectExecutionContext,
  mutate: <T>(run: () => T) => T,
): Promise<unknown> {
  const nodeId = typeof args.directorNodeId === 'string' ? args.directorNodeId : ''
  const node = useGenerationCanvasStore.getState().nodes.find((item) => item.id === nodeId && item.kind === 'vibingDirector')
  if (!node) return invalid()
  const state = readVibingDirectorState(node)
  const inspected = inspectedDirectors.get(nodeId)
  const evaluation = evaluateVibingDirectorToolCall({
    toolName: toolName === 'read_vibing_director_state' ? 'read_vibing_director' : toolName,
    args, directorNodeId: nodeId, state,
    inspected: Boolean(inspected && sameProjectAgentBinding(inspected.binding, project.binding)
      && inspected.state === node.meta?.vibingDirectorState),
  })
  if (evaluation.kind === 'reject') throw new Error(evaluation.message)
  if (evaluation.kind === 'read') {
    inspectedDirectors.set(nodeId, { binding: project.binding, state: node.meta?.vibingDirectorState })
    return result('read', '已读取 Blender 导演台状态。', { directorNodeId: nodeId, state })
  }
  if (!await confirmDialog({ title: '应用 Blender 导演计划', message: evaluation.request.summary, confirmLabel: '应用计划' })) {
    return result('cancelled', '用户取消了本次修改。', { applied: false, declined: true })
  }
  project.assertCurrent()
  const current = useGenerationCanvasStore.getState().nodes.find((item) => item.id === nodeId)
  if (!current || current.meta?.vibingDirectorState !== node.meta?.vibingDirectorState) throw new SurfacePortWireError('capability_target_stale')
  const appliedPlan = applyVibingDirectorPlan(state, evaluation.request.plan)
  if (appliedPlan.rejected.length) throw new Error(appliedPlan.rejected.join('; '))
  mutate(() => useGenerationCanvasStore.getState().updateNode(nodeId, {
    meta: { ...current.meta, vibingDirectorState: appliedPlan.state },
  }))
  inspectedDirectors.delete(nodeId)
  await persistActiveWorkbenchProjectNow()
  project.assertCurrent()
  // Applying a declarative document is not running Blender or generating media.
  return result('applied', '已应用本地导演计划；尚未运行 Blender 预演。', { applied: true, directorNodeId: nodeId, blenderExecuted: false, requiresBlenderPreview: true })
}

export async function executeCreativeTool(payload: unknown): Promise<unknown> {
  // Issue before any await. The wire routes the action; it never approves writes or spending.
  const project = withProjectAction((issued) => issued)
  const data = record(payload)
  const binding = data.binding as ProjectBinding
  try { assertProjectAgentBinding(binding) } catch { return invalid() }
  if (!project || !sameProjectAgentBinding(project.binding, binding)) throw new SurfacePortWireError('project_binding_stale')
  project.assertCurrent()
  const call = record(data.call)
  const toolName = typeof call.toolName === 'string' ? call.toolName : ''
  const toolCallId = typeof call.toolCallId === 'string' ? call.toolCallId.trim() : ''
  if (!toolCallId) return invalid()
  const policy = record(call.policy)
  if (Object.keys(policy).length !== 3 || policy.allowGeneration !== false
    || policy.requirePaidConfirmation !== true || policy.autoResubmit !== false) return invalid()
  const schema = creativeComponentArgumentSchemas[toolName as keyof typeof creativeComponentArgumentSchemas]
  const args = schema ? schema.parse(call.args) as Record<string, unknown> : record(call.args)
  const gesture: CanvasGestureContext = { source: 'agent', txnId: toolCallId, proposalId: toolCallId }
  const mutate = <T,>(run: () => T): T => {
    project.assertCurrent()
    return withCanvasGestureContext(gesture, run)
  }
  if (toolName === 'read_vibing_director' || toolName === 'read_vibing_director_state' || toolName === 'apply_vibing_director_plan') {
    return executeVibing(toolName, args, project, mutate)
  }
  if (LOCAL_WRITES.has(toolName)) {
    const confirmed = await confirmDialog({ title: '确认创作修改', message: toolName, confirmLabel: '确认应用' })
    project.assertCurrent()
    if (!confirmed) return result('cancelled', '用户取消了本次修改。', { applied: false, declined: true })
  } else if (!DIRECT_READS.has(toolName) && toolName !== 'list_capability_recipes' && toolName !== 'apply_capability_recipe') {
    return invalid()
  }
  const capability = await tryApplyCapabilityToolCall({
    toolName, record: args, gesture, mutate, project,
    planOnly: true,
  })
  project.assertCurrent()
  if (capability.handled) {
    const value = await capability.value
    project.assertCurrent()
    return result(toolName === 'apply_capability_recipe' ? 'planned' : toolName === 'list_capability_recipes' ? 'read' : 'applied',
      toolName === 'apply_capability_recipe' ? '配方计划已准备；未启动生成，仍需用户单独确认付费。' : '已完成创作组件操作。', value)
  }
  const cinematic = mutate(() => tryApplyCinematicDirectorToolCall(toolName, args, project))
  if (!cinematic.handled) return invalid()
  const value = await cinematic.value
  project.assertCurrent()
  return result(DIRECT_READS.has(toolName) ? 'read' : 'applied', '已完成创作语义操作。', value)
}
