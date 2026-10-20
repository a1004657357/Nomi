import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import {
  DEFAULT_MODEL3D_CAMERA_STATE,
  model3dGrid9CameraStates,
} from './model3dCamera'
import {
  createModel3DCameraCapture,
  createModel3DGrid9CaptureCollection,
} from './model3dCameraCapture'

function sourceNode(): GenerationCanvasNode {
  return {
    id: 'model-source',
    kind: 'model3d',
    title: '水果盆 3D 机位代理',
    categoryId: 'shots',
    position: { x: 100, y: 140 },
    size: { width: 520, height: 420 },
    result: {
      id: 'model-result',
      type: 'model3d',
      url: 'nomi-local://asset/project-1/generated/fruit-bowl.glb',
      createdAt: 100,
      provenance: { provider: 'runninghub', modelKey: 'hunyuan3d-v3.1', timestamp: 100 },
    },
    status: 'success',
  }
}

beforeEach(() => {
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [sourceNode()],
    edges: [],
    groups: [],
  })
})

describe('createModel3DCameraCapture', () => {
  it('creates a connected image node without replacing the source model result', async () => {
    const persistProject = vi.fn(async () => {})
    const outcome = await createModel3DCameraCapture({
      project: null,
      sourceNodeId: 'model-source',
      camera: { ...DEFAULT_MODEL3D_CAMERA_STATE, azimuth: 90, elevation: 15, distance: 6, fov: 50 },
      capture: {
        dataUrl: 'data:image/png;base64,capture',
        width: 1920,
        height: 1080,
      },
      persistScreenshot: async () => ({
        url: 'nomi-local://asset/project-1/generated/camera-shot.png',
        assetId: 'capture-asset',
        localOnly: false,
      }),
      persistProject,
      now: () => 500,
    })

    const state = useGenerationCanvasStore.getState()
    const source = state.nodes.find((node) => node.id === 'model-source')
    const captured = state.nodes.find((node) => node.id === outcome.nodeId)

    expect(source?.result?.id).toBe('model-result')
    expect(captured).toMatchObject({
      kind: 'image',
      title: '水果盆 3D 机位代理 · 机位回拍',
      categoryId: 'shots',
      renderKind: 'shot-frame',
      status: 'success',
      result: {
        type: 'image',
        url: 'nomi-local://asset/project-1/generated/camera-shot.png',
        assetId: 'capture-asset',
        provenance: {
          provider: 'nomi-local-3d-camera',
          modelKey: 'hunyuan3d-v3.1',
          params: {
            sourceModelNodeId: 'model-source',
            camera: expect.objectContaining({ azimuth: 90, elevation: 15, fov: 50 }),
          },
        },
      },
      meta: {
        source: 'model3d-camera',
        modelAutoSelectDisabled: true,
        sourceNodeId: 'model-source',
        sourceResultId: 'model-result',
        imageWidth: 1920,
        imageHeight: 1080,
        model3dCamera: expect.objectContaining({ azimuth: 90, elevation: 15 }),
      },
    })
    expect(captured?.meta).not.toHaveProperty('modelKey')
    expect(state.edges).toContainEqual(expect.objectContaining({
      source: 'model-source',
      target: outcome.nodeId,
      mode: 'reference',
    }))
    expect(persistProject).toHaveBeenCalledOnce()
  })

  it('does not mutate the canvas when screenshot persistence fails', async () => {
    await expect(createModel3DCameraCapture({
      project: null,
      sourceNodeId: 'model-source',
      camera: DEFAULT_MODEL3D_CAMERA_STATE,
      capture: { dataUrl: 'data:image/png;base64,capture', width: 1024, height: 1024 },
      persistScreenshot: async () => { throw new Error('asset write failed') },
      persistProject: async () => {},
    })).rejects.toThrow('asset write failed')

    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual(['model-source'])
    expect(useGenerationCanvasStore.getState().edges).toEqual([])
  })

  it('stores nine deterministic camera guides in one connected collection node', async () => {
    const persistProject = vi.fn(async () => {})
    const persistScreenshot = vi.fn(async (_dataUrl: string, _ownerNodeId: string, title: string) => ({
      url: `nomi-local://asset/project-1/generated/${title}.png`,
      assetId: `asset-${title}`,
      localOnly: false,
    }))
    const guides = model3dGrid9CameraStates({
      ...DEFAULT_MODEL3D_CAMERA_STATE,
      distance: 6,
      target: [0, 1, 0],
    })
    const outcome = await createModel3DGrid9CaptureCollection({
      project: null,
      sourceNodeId: 'model-source',
      frames: guides.map((guide, index) => ({
        ...guide,
        capture: {
          dataUrl: `data:image/png;base64,guide-${index}`,
          width: 1024,
          height: 1024,
        },
      })),
      persistScreenshot,
      persistProject,
      now: () => 800,
    })

    const state = useGenerationCanvasStore.getState()
    const source = state.nodes.find((node) => node.id === 'model-source')
    const collectionNode = state.nodes.find((node) => node.id === outcome.nodeId)
    const collection = collectionNode?.resultCollections?.[0]

    expect(source?.result?.id).toBe('model-result')
    expect(state.nodes).toHaveLength(2)
    expect(persistScreenshot).toHaveBeenCalledTimes(9)
    expect(collectionNode).toMatchObject({
      kind: 'image',
      title: '水果盆 3D 机位代理 · 九机位引导',
      status: 'success',
      meta: {
        source: 'model3d-camera-grid9',
        modelAutoSelectDisabled: true,
        sourceNodeId: 'model-source',
        sourceResultId: 'model-result',
        model3dCameraGuide: true,
      },
    })
    expect(collection?.recipeId).toBe('model3d.camera.grid9')
    expect(collection?.items).toHaveLength(9)
    expect(collection?.items.map((item) => item.id)).toEqual(guides.map((guide) => guide.id))
    expect(collection?.items[8]).toMatchObject({
      label: '俯视',
      azimuth: 0,
      elevation: 75,
      status: 'success',
      result: {
        provenance: {
          provider: 'nomi-local-3d-camera',
          params: {
            cameraGuideId: 'top',
            camera: expect.objectContaining({ azimuth: 0, elevation: 75 }),
          },
        },
      },
    })
    expect(collectionNode?.result?.id).toBe(collection?.items[0]?.result?.id)
    expect(state.edges).toContainEqual(expect.objectContaining({
      source: 'model-source',
      target: outcome.nodeId,
      mode: 'reference',
    }))
    expect(persistProject).toHaveBeenCalledOnce()
  })
})
