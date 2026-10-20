import { assertOnlyFields, optionalText, requiredIdentifier } from './dispatcherParams'
import { renderDirectorOnProject, type DirectorRenderInput, type RunDirectorFn } from './directorRender'
import type { ProjectGateway } from './gateway'
import { guardLegacyGenerationRoute } from './generationDispatcher'
import type { ProjectLeaseV2 } from './projectLease'
import { RpcError } from './rpcError'

export type CustomLocalCanvasContext = {
  /** Desktop-owned Blender execution; unavailable in the headless host. */
  runDirector?: RunDirectorFn
  /** Queue the native batch confirmation UI without approving spending. */
  runGenerationBatch?: (projectId: string, nodeIds: string[]) => Promise<unknown>
  /** RPC selects renderer/disk/hybrid by active project; headless uses disk. */
  makeGateway: (projectId: string) => ProjectGateway
}

/** Existing-node desktop operations; a lease authorizes the request, not spending. */
export async function dispatchCustomLocalCanvas(
  method: 'director.render' | 'generation.batch',
  params: Record<string, unknown>,
  ctx: CustomLocalCanvasContext,
  verifyLease: (scope: string) => Promise<ProjectLeaseV2>,
): Promise<unknown> {
  const { leaseHandle: _leaseHandle, ...localParams } = params
  guardLegacyGenerationRoute(method, localParams)
  assertOnlyFields(params, new Set(method === 'director.render'
    ? ['leaseHandle', 'projectId', 'sourceNodeId', 'stagePreset']
    : ['leaseHandle', 'projectId', 'nodeIds']))
  const lease = await verifyLease(method === 'director.render' ? 'canvas:write' : 'generation:plan')
  if (method === 'generation.batch') {
    if (!Array.isArray(params.nodeIds) || !params.nodeIds.length || params.nodeIds.length > 24) {
      throw new RpcError('Batch generation requires 1 to 24 node IDs', 400)
    }
    const nodeIds = [...new Set(params.nodeIds.map((id) => requiredIdentifier(id, 'node')))]
    if (!ctx.runGenerationBatch) throw new RpcError('Batch generation requires the Nomi desktop window', 501)
    return ctx.runGenerationBatch(lease.projectId, nodeIds)
  }
  const input: DirectorRenderInput = {
    projectId: lease.projectId,
    sourceNodeId: requiredIdentifier(params.sourceNodeId, 'source node'),
    ...(params.stagePreset !== undefined
      ? { stagePreset: optionalText(params.stagePreset, 'stage preset', 40) as DirectorRenderInput['stagePreset'] }
      : {}),
  }
  if (!ctx.runDirector) throw new RpcError('Director preview requires the Nomi desktop runtime', 501)
  const gateway = ctx.makeGateway(lease.projectId)
  return renderDirectorOnProject(input, {
    ...gateway,
    apply: async (snapshot) => {
      await verifyLease('canvas:write')
      return gateway.apply(snapshot)
    },
  }, ctx.runDirector)
}
