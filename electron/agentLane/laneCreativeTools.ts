import { createHash } from 'node:crypto'
import type { CanvasReadSurfaceRegistry, ProjectSurfaceSession } from '../capabilityCore/canvasReadSurfaceRegistry'
import { sameProjectAgentBinding, type ProjectBinding } from '../shared/projectBinding'
import { CREATIVE_COMPONENT_EXECUTION_POLICY, creativeComponentInputSchema, creativeComponentResultSchema, type CreativeComponentBridgeRequest, type CreativeComponentInput } from '../shared/agentCapabilities/creativeComponent'
import { specsForCapability } from '../shared/agentCapabilities/modelFacingToolRegistry'
import { toSemanticInput } from '../shared/agentCapabilities/modelFacingTools'
import { parseVibingDirectorPlanRequest } from '../ai/vibingDirectorTools'
import type { RuntimeToolCall } from '../shared/agentCapabilities/transportContracts'
import { bindLaneTool, LaneDomainFailure, type LaneToolExecutionContext, type OpenLaneOptions } from './laneRuntimePort'

type RecordApproval = Parameters<NonNullable<OpenLaneOptions['toolLifecycle']>['approved']>[1]

export function createCreativeLaneTools(input: {
  registry: Pick<CanvasReadSurfaceRegistry, 'verifyProjectSession' | 'resolveProjectSession'>
  session: ProjectSurfaceSession
  binding: ProjectBinding
  requestRenderer(op: string, payload: CreativeComponentBridgeRequest, timeoutMs: number): Promise<unknown>
}) {
  const specs = [...specsForCapability('creative.component.read'), ...specsForCapability('creative.component.write')]
  const byName = new Map(specs.map(spec => [spec.name, spec]))
  const prepared = new Map<string, { hash: string; signal: AbortSignal }>()
  const approved = new Map<string, string>()
  const dispatched = new Set<string>()
  let disposed = false

  const failure = (message: string) => new LaneDomainFailure({
    code: 'creative_component_refused', message,
    nextAction: 'Inspect the current project state. Do not automatically resend this write; obtain fresh user intent and Host approval first.',
  })
  const parseCall = (call: RuntimeToolCall): CreativeComponentInput => {
    const spec = byName.get(call.toolName)
    if (!spec) throw failure('This tool is not a registered creative component.')
    const value = creativeComponentInputSchema.parse(toSemanticInput(spec, spec.schema.parse(call.args)))
    if (value.operation === 'apply_vibing_director_plan' && !parseVibingDirectorPlanRequest(value)) {
      throw failure('The director plan contains an invalid semantic action. Re-read the scene before proposing another plan.')
    }
    return value
  }
  const hashOf = (value: CreativeComponentInput) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const assertSession = async (signal: AbortSignal) => {
    signal.throwIfAborted()
    if (disposed) throw failure('This creative component session has been closed.')
    const verified = await input.registry.verifyProjectSession(input.session)
    signal.throwIfAborted()
    if (disposed) throw failure('This creative component session was closed while its project identity was being verified.')
    verified.signal.throwIfAborted()
    const current = input.registry.resolveProjectSession(input.session)
    if (!sameProjectAgentBinding(current.binding, input.binding) || current.sessionId !== verified.sessionId
      || current.canonicalRootDigest !== verified.canonicalRootDigest) throw failure('The project binding changed. This call has no authority in the newly selected project.')
  }

  const tools = specs.map(spec => bindLaneTool(spec, async (args, context: LaneToolExecutionContext) => {
    const call = { toolName: spec.name, toolCallId: context.toolCallId, args }
    const semantic = parseCall(call)
    await assertSession(context.signal)
    if (spec.effect !== 'read') {
      const hash = approved.get(context.toolCallId)
      approved.delete(context.toolCallId)
      if (!hash || hash !== hashOf(semantic) || dispatched.has(context.toolCallId)) throw failure('This exact write has not received a fresh, completed Host approval.')
      dispatched.add(context.toolCallId)
    }
    const { operation, ...parameters } = semantic
    const reply = await input.requestRenderer('creative.tool.execute', {
      binding: input.binding,
      call: { toolCallId: context.toolCallId, toolName: operation, args: parameters, policy: CREATIVE_COMPONENT_EXECUTION_POLICY },
    }, spec.execution.timeoutMs)
    await assertSession(context.signal)
    const result = creativeComponentResultSchema.parse(reply)
    const allowed = spec.effect === 'read' ? ['read']
      : operation === 'apply_capability_recipe' ? ['planned', 'awaiting_paid_confirmation', 'cancelled']
        : ['applied', 'cancelled']
    if (!allowed.includes(result.status)) throw failure('The renderer returned a state that this component is not allowed to produce. No automatic resubmission is permitted.')
    return { ok: true, text: result.summary, details: result,
      ...(spec.effect !== 'read' ? { nextAction: {
        kind: result.status === 'awaiting_paid_confirmation' ? 'user_sees_spend_card' as const : 'none' as const,
        userSees: result.status === 'awaiting_paid_confirmation'
          ? 'A recipe plan awaits a separate explicit paid confirmation. This call submitted nothing; do not resend it.'
          : 'The component result is visible. Nothing was generated and no automatic resubmission is allowed.',
      } } : {}),
    }
  }))

  const toolLifecycle = {
    prepare: async (call: RuntimeToolCall, signal: AbortSignal) => {
      const spec = byName.get(call.toolName)
      if (!spec || spec.effect === 'read') return
      if (prepared.has(call.toolCallId)) throw failure('This write already has a prepared Host invocation. It cannot be replaced while approval is pending.')
      if (dispatched.has(call.toolCallId)) throw failure('This write call was already dispatched. Repeating it could duplicate local changes or a pending paid plan.')
      const semantic = parseCall(call)
      await assertSession(signal)
      prepared.set(call.toolCallId, { hash: hashOf(semantic), signal })
    },
    approved: async (call: RuntimeToolCall, record: RecordApproval) => {
      const spec = byName.get(call.toolName)
      if (!spec || spec.effect === 'read') return
      const value = prepared.get(call.toolCallId)
      if (!value || value.hash !== hashOf(parseCall(call)) || dispatched.has(call.toolCallId)) throw failure('The approved component no longer matches the prepared call.')
      await assertSession(value.signal)
      await record('creative-component-approval', { toolCallId: call.toolCallId, actionHash: value.hash })
      await assertSession(value.signal)
      approved.set(call.toolCallId, value.hash)
    },
    settled: (call: RuntimeToolCall) => { prepared.delete(call.toolCallId); approved.delete(call.toolCallId) },
  } satisfies NonNullable<OpenLaneOptions['toolLifecycle']>
  return { tools, toolLifecycle, dispose: () => { disposed = true; prepared.clear(); approved.clear(); dispatched.clear() } }
}
