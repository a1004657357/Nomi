import type { ModelOption } from '../../../../config/models'
import { readShotTable } from '../../../../../electron/shared/canvas/shotTable'
import { useWorkbenchStore } from '../../../workbenchStore'
import { withProjectAction } from '../../../project/projectCanvasReadSurface'
import { deriveStoryboardRowRuntimes } from '../../../creation/storyboard/exec/storyboardRowStatus'
import { materializeShotRow } from '../../../creation/storyboard/exec/storyboardRowActions'
import { stableShotId } from '../../agent/storyboardPlan'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { isStoryboardContainedNodeHidden, withStoryboardContainedMeta } from '../../model/storyboardContainedNodes'
import { storyboardRowOutputPosition } from '../render/storyboardRowOutputs'

/** Reveal/collapse only; materialization never submits a generation request. */
export async function setShotTableRowOutputs(tableNodeId: string, rowId: string, options: {
  connect?: boolean
  imageModelOptions: readonly ModelOption[]
  videoModelOptions: readonly ModelOption[]
}): Promise<void> {
  return withProjectAction(async project => {
    const canvas = useGenerationCanvasStore.getState()
    const tableNode = canvas.nodes.find(node => node.id === tableNodeId)
    const table = readShotTable(tableNode?.meta)
    if (!tableNode || table?.source.kind !== 'storyboard') return
    const source = table.source
    const design = useWorkbenchStore.getState().storyboardDesignsByDocumentId[source.documentId]?.find(item => item.id === source.designId)
    if (!design) return
    const row = deriveStoryboardRowRuntimes({ plan: design.plan, designId: design.id, nodes: canvas.nodes, ...options })
      .find(item => stableShotId(item.shot) === rowId)
    if (!row) return
    const existing = [row.exec.node, row.exec.keyframeNode].filter(node => node !== null)
    const expanded = Boolean(options.connect || !existing.length || existing.some(isStoryboardContainedNodeHidden))
    const materialized = await materializeShotRow({
      documentId: source.documentId, designId: design.id, plan: design.plan, initiator: 'user',
      assertCurrent: async () => project.assertCurrent(),
      assertAuthorCurrent: async () => project.assertCurrent(),
    }, row.shot, row.mode, true)
    project.assertCurrent()
    const store = useGenerationCanvasStore.getState()
    if (!store.nodes.some(node => node.id === tableNodeId)) return
    for (const id of [materialized.shotNodeId, materialized.keyframeNodeId]) {
      const node = store.nodes.find(item => item.id === id)
      if (!node) continue
      const role = node.kind === 'video' ? 'video' : 'image'
      store.updateNode(node.id, {
        meta: withStoryboardContainedMeta(node.meta, { tableNodeId, rowIndex: row.shot.index, role, expanded }),
        ...(expanded ? { position: storyboardRowOutputPosition(tableNode, row.shot.index, role) } : {}),
      })
    }
    if (options.connect) store.startConnection(materialized.shotNodeId, 'right')
  }, async () => { throw new Error('project_identity_unavailable') })
}
