import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { createVibingDirectorState } from '../nodes/vibingDirector/vibingDirectorState'
import { handoffModel3dNode } from './model3dHandoff'

const model3dValidation = {
  version: 1 as const,
  glbVersion: 2,
  byteLength: 2048,
  meshCount: 1,
  primitiveCount: 2,
  nodeCount: 3,
  materialCount: 1,
  textureCount: 1,
  imageCount: 1,
  embeddedImageCount: 1,
  externalImageCount: 0,
  externalImageUris: [],
  externalBufferCount: 0,
  externalBufferUris: [],
  animationCount: 0,
  skinCount: 0,
  bounds: {
    min: [0, 0, 0] as [number, number, number],
    max: [1, 2, 1] as [number, number, number],
    size: [1, 2, 1] as [number, number, number],
    diagonal: Math.sqrt(6),
  },
  warnings: [],
}

function sourceNode(): GenerationCanvasNode {
  return {
    id: 'model-source',
    kind: 'model3d',
    title: '咖啡杯 3D',
    categoryId: 'scene',
    position: { x: 100, y: 120 },
    result: {
      id: 'model-result',
      type: 'model3d',
      url: 'nomi-local://asset/project-1/generated/coffee-cup.glb',
      assetId: 'project-asset-1',
      model3dValidation,
      createdAt: 100,
      provenance: { provider: 'runninghub', modelKey: 'hunyuan3d-v3.1', timestamp: 100 },
    },
    history: [],
    status: 'success',
  }
}

let session: ReturnType<typeof createProjectSessionTestHarness>
let project: ProjectExecutionContext
beforeEach(async () => {
  session = createProjectSessionTestHarness()
  await session.open('project-1')
  project = withProjectAction(project => project)!
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [sourceNode()],
    edges: [],
    groups: [],
    selectedNodeIds: [],
  })
})
afterEach(() => session.dispose())

describe('handoffModel3dNode', () => {
  it('creates a Scene3D node containing the generated GLB and keeps source provenance', async () => {
    const outcome = await handoffModel3dNode({
      project,
      sourceNodeId: 'model-source',
      target: 'scene3d',
      persist: async () => {},
      now: () => 200,
    })

    const state = useGenerationCanvasStore.getState()
    const source = state.nodes.find((node) => node.id === 'model-source')
    const target = state.nodes.find((node) => node.id === outcome.targetNodeId)
    const scene = target?.meta?.scene3dState as { objects?: Array<Record<string, unknown>> } | undefined
    const model = scene?.objects?.find((object) => object.id === outcome.objectId)

    expect(outcome.createdTarget).toBe(true)
    expect(target?.kind).toBe('scene3d')
    expect(model).toMatchObject({
      name: '咖啡杯 3D',
      type: 'model',
      modelUrl: 'nomi-local://asset/project-1/generated/coffee-cup.glb',
      model3dValidation: { meshCount: 1, primitiveCount: 2 },
    })
    expect(target?.meta?.model3dHandoffs).toEqual([expect.objectContaining({
      sourceNodeId: 'model-source',
      sourceResultId: 'model-result',
      provider: 'runninghub',
      modelKey: 'hunyuan3d-v3.1',
      validation: expect.objectContaining({ meshCount: 1, primitiveCount: 2 }),
      createdAt: 200,
    })])
    expect(source?.result?.id).toBe('model-result')
    expect(state.edges.some((edge) => edge.source === 'model-source' && edge.target === target?.id)).toBe(true)
  })

  it('imports the GLB into an existing Blender Director asset library and places it', async () => {
    const director = useGenerationCanvasStore.getState().addNode({
      kind: 'vibingDirector',
      title: 'Blender Director',
      categoryId: 'scene',
      meta: { vibingDirectorState: createVibingDirectorState(100) },
      select: false,
    })
    const importDirectorAsset = vi.fn(async () => ({
      asset: {
        id: 'director-asset-1',
        name: 'coffee-cup',
        fileName: 'coffee-cup.glb',
        format: 'glb' as const,
        source: 'local' as const,
        license: 'user-owned',
        importedAt: 200,
      },
      relativePath: '.nomi/vibing-director/director/assets/coffee-cup.glb',
    }))

    const outcome = await handoffModel3dNode({
      project,
      sourceNodeId: 'model-source',
      target: 'vibingDirector',
      targetNodeId: director.id,
      license: 'user-owned',
      importDirectorAsset,
      persist: async () => {},
      now: () => 200,
    })

    const target = useGenerationCanvasStore.getState().nodes.find((node) => node.id === director.id)
    const directorState = target?.meta?.vibingDirectorState as {
      assets?: Array<{ id: string }>
      objects?: Array<{ id: string; assetId?: string; kind: string }>
    }
    expect(outcome.createdTarget).toBe(false)
    expect(importDirectorAsset).toHaveBeenCalledWith({
      projectId: 'project-1',
      projectBinding: project.binding,
      directorNodeId: director.id,
      sourceUrl: 'nomi-local://asset/project-1/generated/coffee-cup.glb',
      source: 'local',
      license: 'user-owned',
    })
    expect(directorState.assets).toContainEqual(expect.objectContaining({ id: 'director-asset-1' }))
    expect(directorState.assets).toContainEqual(expect.objectContaining({
      id: 'director-asset-1',
      model3dValidation: expect.objectContaining({ meshCount: 1 }),
    }))
    expect(directorState.objects).toContainEqual(expect.objectContaining({
      id: outcome.objectId,
      kind: 'asset',
      assetId: 'director-asset-1',
    }))
  })

  it('keeps the latest Scene3D transform when the same generated asset is handed to Blender', async () => {
    const sceneOutcome = await handoffModel3dNode({
      project,
      sourceNodeId: 'model-source',
      target: 'scene3d',
      persist: async () => {},
      now: () => 200,
    })
    const store = useGenerationCanvasStore.getState()
    const sceneNode = store.nodes.find((node) => node.id === sceneOutcome.targetNodeId)!
    const sceneState = sceneNode.meta?.scene3dState as {
      objects: Array<Record<string, unknown>>
    }
    store.updateNode(sceneNode.id, {
      meta: {
        ...sceneNode.meta,
        scene3dState: {
          ...sceneState,
          objects: sceneState.objects.map((object) => (
            object.id === sceneOutcome.objectId
              ? { ...object, position: [2, 0.5, -1], rotation: [0, 90, 0], scale: [1.5, 1.5, 1.5] }
              : object
          )),
        },
      },
    })

    const outcome = await handoffModel3dNode({
      project,
      sourceNodeId: 'model-source',
      target: 'vibingDirector',
      importDirectorAsset: async () => ({
        asset: {
          id: 'director-asset-transform',
          name: 'coffee-cup',
          fileName: 'coffee-cup.glb',
          format: 'glb',
          source: 'local',
          license: 'user-owned',
          importedAt: 300,
          model3dValidation,
        },
        relativePath: '.nomi/vibing-director/director/assets/coffee-cup.glb',
      }),
      persist: async () => {},
      now: () => 300,
    })

    const director = useGenerationCanvasStore.getState().nodes.find((node) => node.id === outcome.targetNodeId)
    const state = director?.meta?.vibingDirectorState as {
      objects: Array<{ id: string; position: number[]; rotation: number[]; scale: number[] }>
    }
    expect(state.objects.find((object) => object.id === outcome.objectId)).toMatchObject({
      position: [2, 0.5, -1],
      rotation: [0, 90, 0],
      scale: [1.5, 1.5, 1.5],
    })
    expect(director?.meta?.model3dHandoffs).toEqual([
      expect.objectContaining({ sourceScene3dNodeId: sceneNode.id }),
    ])
  })

  it('does not mutate the canvas when a legacy GLB fails local revalidation', async () => {
    const source = sourceNode()
    source.result = source.result ? { ...source.result, model3dValidation: undefined } : undefined
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [source],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    })

    await expect(handoffModel3dNode({
      project,
      sourceNodeId: 'model-source',
      target: 'scene3d',
      inspectModel3d: async () => { throw new Error('GLB magic 无效') },
      persist: async () => {},
    })).rejects.toThrow(/GLB magic/)

    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual(['model-source'])
  })

  it('removes a newly-created Director node when the asset import fails', async () => {
    await expect(handoffModel3dNode({
      project,
      sourceNodeId: 'model-source',
      target: 'vibingDirector',
      importDirectorAsset: async () => { throw new Error('本地资产不存在') },
      persist: async () => {},
    })).rejects.toThrow('本地资产不存在')

    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual(['model-source'])
  })

  it('rejects an obsolete context before inspecting or mutating', async () => {
    await session.open('project-2')
    await session.open('project-1')
    const inspectModel3d = vi.fn()
    const persist = vi.fn()
    const before = useGenerationCanvasStore.getState().nodes
    await expect(handoffModel3dNode({ project, sourceNodeId: 'model-source', target: 'scene3d', inspectModel3d, persist })).rejects.toThrow()
    expect(inspectModel3d).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes).toBe(before)
  })

  it('does not roll back a same-id node in the new project when import returns late', async () => {
    let finish!: (result: { asset: { id: string; name: string; fileName: string; format: 'glb'; source: 'local'; license: string; importedAt: number }; relativePath: string }) => void
    const persist = vi.fn(async () => {})
    const importing = handoffModel3dNode({
      project, sourceNodeId: 'model-source', target: 'vibingDirector', persist,
      importDirectorAsset: () => new Promise(resolve => { finish = resolve }),
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const target = useGenerationCanvasStore.getState().nodes.find(node => node.kind === 'vibingDirector')!
    await session.open('project-2')
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ ...target, title: 'new project same-id node' }], edges: [], groups: [], selectedNodeIds: [] })
    const before = useGenerationCanvasStore.getState().nodes
    finish({ asset: { id: 'late', name: 'late', fileName: 'late.glb', format: 'glb', source: 'local', license: 'user-owned', importedAt: 1 }, relativePath: 'late.glb' })
    await expect(importing).rejects.toThrow()
    expect(useGenerationCanvasStore.getState().nodes).toBe(before)
    expect(persist).not.toHaveBeenCalled()
  })
})
