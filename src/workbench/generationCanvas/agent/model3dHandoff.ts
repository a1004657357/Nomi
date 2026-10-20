import { getDesktopBridge } from '../../../desktop/bridge'
import {
  persistActiveWorkbenchProjectNow,
} from '../../project/workbenchProjectSession'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { normalizeScene3DState } from '../nodes/scene3d/scene3dSerializer'
import type { Scene3DObject } from '../nodes/scene3d/scene3dTypes'
import {
  applyVibingDirectorPlan,
  createVibingDirectorState,
  normalizeVibingDirectorState,
  type BlenderDirectorAsset,
} from '../nodes/vibingDirector/vibingDirectorState'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode, Model3dValidationSummary } from '../model/generationCanvasTypes'

export type Model3dHandoffTarget = 'scene3d' | 'vibingDirector'

type ImportDirectorAssetInput = {
  projectId: string
  projectBinding: ProjectExecutionContext['binding']
  directorNodeId: string
  sourceUrl: string
  source: 'local'
  license?: string
}

type ImportDirectorAssetResult = {
  asset: BlenderDirectorAsset
  relativePath: string
}

export type HandoffModel3dNodeOptions = {
  project: ProjectExecutionContext
  sourceNodeId: string
  target: Model3dHandoffTarget
  targetNodeId?: string
  license?: string
  importDirectorAsset?: (input: ImportDirectorAssetInput) => Promise<ImportDirectorAssetResult>
  inspectModel3d?: (input: { url: string }) => Promise<Model3dValidationSummary>
  persist?: () => Promise<void>
  now?: () => number
  mutate?: <T>(operation: () => T) => T
}

export type Model3dHandoffOutcome = {
  targetNodeId: string
  objectId: string
  createdTarget: boolean
}

type HandoffRecord = {
  sourceNodeId: string
  sourceResultId: string
  sourceUrl: string
  objectId: string
  target: Model3dHandoffTarget
  provider?: string
  modelKey?: string
  validation: Model3dValidationSummary
  sourceScene3dNodeId?: string
  createdAt: number
}

type Model3dTransform = Pick<Scene3DObject, 'position' | 'rotation' | 'scale'>

function records(value: unknown): HandoffRecord[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is HandoffRecord => Boolean(entry && typeof entry === 'object'))
    : []
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'model'
}

async function defaultImportDirectorAsset(input: ImportDirectorAssetInput): Promise<ImportDirectorAssetResult> {
  const director = getDesktopBridge()?.vibingDirector
  if (!director) throw new Error('当前运行环境不支持把生成模型交给 Blender Director')
  return director.importExistingAsset(input)
}

async function validatedSourceResult(
  source: GenerationCanvasNode,
  inspectModel3d?: HandoffModel3dNodeOptions['inspectModel3d'],
): Promise<Model3dValidationSummary> {
  const embedded = source.result?.model3dValidation
  if (embedded) return embedded
  const inspect = inspectModel3d ?? getDesktopBridge()?.assets.inspectModel3d
  if (!inspect) throw new Error('当前运行环境无法校验这个 GLB，请从桌面版 Nomi 重试')
  const validation = await inspect({ url: source.result?.url || '' })
  if (validation.meshCount < 1 || validation.primitiveCount < 1 || !(validation.bounds.diagonal > 0)) {
    throw new Error('GLB 校验失败：模型没有可用网格或几何边界')
  }
  return validation
}

function latestScene3dTransform(nodes: GenerationCanvasNode[], sourceNodeId: string): {
  transform: Model3dTransform
  sourceScene3dNodeId?: string
} {
  for (const node of [...nodes].reverse()) {
    if (node.kind !== 'scene3d') continue
    const handoff = [...records(node.meta?.model3dHandoffs)].reverse()
      .find((entry) => entry.sourceNodeId === sourceNodeId && entry.target === 'scene3d')
    if (!handoff) continue
    const object = normalizeScene3DState(node.meta?.scene3dState).objects
      .find((candidate) => candidate.id === handoff.objectId)
    if (!object) continue
    return {
      transform: {
        position: [...object.position],
        rotation: [...object.rotation],
        scale: [...object.scale],
      },
      sourceScene3dNodeId: node.id,
    }
  }
  return {
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  }
}

export async function handoffModel3dNode(options: HandoffModel3dNodeOptions): Promise<Model3dHandoffOutcome> {
  const { project } = options
  project.assertCurrent()
  const initialStore = useGenerationCanvasStore.getState()
  const source = initialStore.nodes.find((node) => node.id === options.sourceNodeId)
  if (!source) throw new Error('3D 源节点不存在')
  if (source.result?.type !== 'model3d' || !source.result.url) {
    throw new Error('请先在 3D 模型节点生成可用的 GLB 结果')
  }
  const validation = await validatedSourceResult(source, options.inspectModel3d)
  project.assertCurrent()

  const existingTarget = options.targetNodeId
    ? initialStore.nodes.find((node) => node.id === options.targetNodeId)
    : undefined
  if (options.targetNodeId && !existingTarget) throw new Error('目标导演台节点不存在')
  if (existingTarget && existingTarget.kind !== options.target) {
    throw new Error(`目标节点类型不匹配：需要 ${options.target}`)
  }

  const projectId = project.binding.projectId

  const now = options.now?.() ?? Date.now()
  const mutate = <T,>(operation: () => T): T => {
    project.assertCurrent()
    return options.mutate ? options.mutate(operation) : operation()
  }
  const objectId = `handoff-${safeId(source.id)}-${now}`
  let createdTarget = false
  const inheritedTransform = latestScene3dTransform(initialStore.nodes, source.id)
  let target = existingTarget
  if (!target) {
    target = mutate(() => initialStore.addNode({
      kind: options.target,
      title: options.target === 'scene3d'
        ? `${source.title} · 3D 导演台`
        : `${source.title} · Blender Director`,
      categoryId: 'scene',
      position: { x: source.position.x + 420, y: source.position.y },
      size: options.target === 'scene3d' ? { width: 560, height: 420 } : { width: 560, height: 420 },
      meta: options.target === 'scene3d'
        ? { scene3dState: normalizeScene3DState(undefined) }
        : { vibingDirectorState: createVibingDirectorState(now) },
    }))
    createdTarget = true
  }

  try {
    const targetMeta = target.meta ?? {}
    const record: HandoffRecord = {
      sourceNodeId: source.id,
      sourceResultId: source.result.id,
      sourceUrl: source.result.url,
      objectId,
      target: options.target,
      ...(source.result.provenance?.provider ? { provider: source.result.provenance.provider } : {}),
      ...(source.result.provenance?.modelKey ? { modelKey: source.result.provenance.modelKey } : {}),
      validation,
      ...(inheritedTransform.sourceScene3dNodeId
        ? { sourceScene3dNodeId: inheritedTransform.sourceScene3dNodeId }
        : {}),
      createdAt: now,
    }

    if (options.target === 'scene3d') {
      const scene = normalizeScene3DState(targetMeta.scene3dState)
      const object: Scene3DObject = {
        id: objectId,
        name: source.title || '生成的 3D 模型',
        type: 'model',
        visible: true,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        modelUrl: source.result.url,
        model3dValidation: validation,
      }
      mutate(() => useGenerationCanvasStore.getState().updateNode(target.id, {
        meta: {
          ...targetMeta,
          scene3dState: { ...scene, objects: [...scene.objects, object] },
          model3dHandoffs: [...records(targetMeta.model3dHandoffs), record],
        },
      }))
    } else {
      const imported = await (options.importDirectorAsset ?? defaultImportDirectorAsset)({
        projectId,
        projectBinding: project.binding,
        directorNodeId: target.id,
        sourceUrl: source.result.url,
        source: 'local',
        ...(options.license?.trim() ? { license: options.license.trim() } : {}),
      })
      project.assertCurrent()
      const director = normalizeVibingDirectorState(targetMeta.vibingDirectorState)
      const importedAsset = imported.asset.model3dValidation
        ? imported.asset
        : { ...imported.asset, model3dValidation: validation }
      const withAsset = director.assets.some((asset) => asset.id === importedAsset.id)
        ? director
        : { ...director, assets: [...director.assets, importedAsset] }
      const applied = applyVibingDirectorPlan(withAsset, {
        mode: 'amend',
        actions: [{
          op: 'place_asset',
          id: objectId,
          assetId: importedAsset.id,
          name: source.title || importedAsset.name,
          position: inheritedTransform.transform.position,
          rotation: inheritedTransform.transform.rotation,
          scale: inheritedTransform.transform.scale,
        }],
      })
      if (applied.rejected.length > 0) throw new Error(applied.rejected.join('；'))
      mutate(() => useGenerationCanvasStore.getState().updateNode(target.id, {
        meta: {
          ...targetMeta,
          vibingDirectorState: applied.state,
          model3dHandoffs: [...records(targetMeta.model3dHandoffs), record],
        },
      }))
    }

    mutate(() => {
      const latestStore = useGenerationCanvasStore.getState()
      latestStore.connectNodes(source.id, target.id, 'reference')
      latestStore.selectNode(target.id)
    })
    await (options.persist ?? persistActiveWorkbenchProjectNow)()
    project.assertCurrent()
    return { targetNodeId: target.id, objectId, createdTarget }
  } catch (error) {
    if (createdTarget && isProjectExecutionContextCurrent(project)) mutate(() => useGenerationCanvasStore.getState().deleteNode(target.id))
    throw error
  }
}
