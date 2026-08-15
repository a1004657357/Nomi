// 能力核 · 方法路由（单一真相源）。
// RPC 传输（rpcServer）与 headless host（host）共用这一份 method→core 映射，杜绝两份路由漂移（P1）。
import {
  addProjectNodes,
  connectProjectNodes,
  createNamedProject,
  deleteProjectNodes,
  generateOnProject,
  listAllProjects,
  listAvailableModels,
  readProjectCanvas,
  renderDirectorOnProject,
  setProjectNodePrompt,
  type DirectorRenderInput,
  type FetchTaskResultFn,
  type GenerateInput,
  type RunDirectorFn,
  type RunTaskFn,
} from './core'
import type { ProjectGateway } from './gateway'

export class RpcError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message)
  }
}

export function projectIdOf(params: Record<string, unknown>): string {
  return typeof params.projectId === 'string' ? params.projectId : ''
}

/**
 * makeGateway：按 projectId 解析该用哪个网关——A 模式（app 开着且该项目正打开）→ 渲染层网关（实时）；
 * 否则 → 磁盘网关（直写盘）。rpcServer 据 isProjectOpen + 渲染层可达性提供；headless host 恒磁盘网关。
 */
export type DispatchContext = {
  runTask: RunTaskFn
  fetchTaskResult?: FetchTaskResultFn
  /** 仅运行中的桌面 app 注入；headless 路明确拒绝 Blender 导演预演。 */
  runDirector?: RunDirectorFn
  /** 仅运行中的桌面 app 注入；在当前渲染画布上一次确认并受理批量生成。 */
  runGenerationBatch?: (projectId: string, nodeIds: string[]) => Promise<unknown>
  makeGateway: (projectId: string) => ProjectGateway
}

export async function dispatch(method: string, params: Record<string, unknown>, ctx: DispatchContext): Promise<unknown> {
  switch (method) {
    case 'ping':
      return { ok: true }
    case 'project.list':
      return { projects: listAllProjects() }
    case 'project.create':
      return createNamedProject(typeof params.name === 'string' ? params.name : undefined)
    case 'models.list':
      return { models: listAvailableModels() }
    case 'canvas.read':
      return readProjectCanvas(ctx.makeGateway(projectIdOf(params)))
    case 'canvas.addNodes':
      return addProjectNodes(ctx.makeGateway(projectIdOf(params)), Array.isArray(params.nodes) ? (params.nodes as never[]) : [])
    case 'canvas.connect':
      return connectProjectNodes(ctx.makeGateway(projectIdOf(params)), Array.isArray(params.connections) ? (params.connections as never[]) : [])
    case 'canvas.setPrompt':
      return setProjectNodePrompt(
        ctx.makeGateway(projectIdOf(params)),
        String(params.nodeId || ''),
        String(params.prompt || ''),
        typeof params.title === 'string' ? params.title : undefined,
      )
    case 'canvas.deleteNodes':
      return deleteProjectNodes(ctx.makeGateway(projectIdOf(params)), Array.isArray(params.nodeIds) ? (params.nodeIds as string[]) : [])
    case 'generate':
      return generateOnProject(params as unknown as GenerateInput, ctx.makeGateway(projectIdOf(params)), ctx.runTask, ctx.fetchTaskResult)
    case 'generation.batch': {
      if (!ctx.runGenerationBatch) throw new RpcError('批量生成需要在已打开的 Nomi 桌面应用中运行', 503)
      const projectId = projectIdOf(params)
      const nodeIds = Array.isArray(params.nodeIds)
        ? Array.from(new Set(params.nodeIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 24)
        : []
      if (!projectId || nodeIds.length === 0) throw new RpcError('generation.batch 需要 projectId 和 nodeIds', 400)
      return ctx.runGenerationBatch(projectId, nodeIds)
    }
    case 'director.render':
      if (!ctx.runDirector) throw new RpcError('Blender 导演预演需要在已打开的 Nomi 桌面应用中运行', 503)
      return renderDirectorOnProject(params as unknown as DirectorRenderInput, ctx.makeGateway(projectIdOf(params)), ctx.runDirector)
    default:
      throw new RpcError(`未知方法: ${method}`, 404)
  }
}
