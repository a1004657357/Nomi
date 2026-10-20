import { createLocalProject, saveLocalProject } from '../library/localProjectStore'
import { buildSelectedNodeProjectPayload, defaultSelectedNodeProjectName } from './selectedNodeProjectPayload'
import { readCurrentWorkbenchProjectPayload } from './workbenchProjectSession'
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'

export type SelectedNodeProjectTransferMode = 'copy' | 'move'

export type SelectedNodeProjectTransferResult = {
  project: WorkbenchProjectRecordV1
  nodeCount: number
  edgeCount: number
  groupCount: number
}

export async function createProjectFromSelectedNodes(input: {
  selectedNodeIds: readonly string[]
  sourceProjectName?: string | null
  targetProjectName?: string | null
  mode: SelectedNodeProjectTransferMode
}): Promise<SelectedNodeProjectTransferResult> {
  const sourcePayload = readCurrentWorkbenchProjectPayload()
  const built = buildSelectedNodeProjectPayload(sourcePayload, input.selectedNodeIds)
  if (!built) throw new Error('请先选中要放入新项目的节点。')
  const projectName = String(input.targetProjectName || '').trim() || defaultSelectedNodeProjectName(input.sourceProjectName, input.mode)
  const created = createLocalProject(projectName)
  const saved = await saveLocalProject(created.id, built.payload, projectName)
  return {
    project: saved,
    nodeCount: built.nodeCount,
    edgeCount: built.edgeCount,
    groupCount: built.groupCount,
  }
}
