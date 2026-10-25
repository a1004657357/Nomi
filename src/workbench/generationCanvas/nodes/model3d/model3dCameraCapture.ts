import { persistActiveWorkbenchProjectNow } from '../../../project/workbenchProjectSession'
import type { ProjectExecutionContext } from '../../../project/projectCanvasReadSurface'
import type { GenerationNodeResult } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { mediaNodeSize } from '../nodeSizing'
import {
  persistScene3DScreenshot,
  type PersistedScene3DScreenshot,
} from '../scene3d/scene3dScreenshot'
import {
  DEFAULT_MODEL3D_CAMERA_STATE,
  MODEL3D_GRID9_CAMERA_PRESETS,
  normalizeModel3DCameraState,
  type Model3DGrid9CameraGuide,
  type Model3DCameraState,
} from './model3dCamera'

export type Model3DCameraCaptureFrame = {
  dataUrl: string
  width: number
  height: number
}

export type CreateModel3DCameraCaptureOptions = {
  project: ProjectExecutionContext | null
  sourceNodeId: string
  camera: Model3DCameraState
  capture: Model3DCameraCaptureFrame
  title?: string
  persistScreenshot?: (
    dataUrl: string,
    ownerNodeId: string,
    title: string,
    project: ProjectExecutionContext | null,
  ) => Promise<PersistedScene3DScreenshot>
  persistProject?: () => Promise<void>
  now?: () => number
}

export type Model3DCameraCaptureOutcome = {
  nodeId: string
  resultId: string
}

export type Model3DGrid9CaptureFrame = Model3DGrid9CameraGuide & {
  capture: Model3DCameraCaptureFrame
}

export type CreateModel3DGrid9CaptureCollectionOptions = {
  project: ProjectExecutionContext | null
  sourceNodeId: string
  frames: Model3DGrid9CaptureFrame[]
  title?: string
  persistScreenshot?: CreateModel3DCameraCaptureOptions['persistScreenshot']
  persistProject?: () => Promise<void>
  now?: () => number
}

export type Model3DGrid9CaptureCollectionOutcome = {
  nodeId: string
  collectionId: string
  resultIds: string[]
}

function validCaptureFrame(capture: Model3DCameraCaptureFrame): boolean {
  return Boolean(
    capture.dataUrl
    && Number.isFinite(capture.width)
    && Number.isFinite(capture.height)
    && capture.width > 0
    && capture.height > 0,
  )
}

export async function createModel3DCameraCapture(
  options: CreateModel3DCameraCaptureOptions,
): Promise<Model3DCameraCaptureOutcome> {
  options.project?.assertCurrent()
  const initialStore = useGenerationCanvasStore.getState()
  const source = initialStore.nodes.find((node) => node.id === options.sourceNodeId)
  if (!source) throw new Error('3D 机位代理节点不存在')
  if (source.result?.type !== 'model3d' || !source.result.url) {
    throw new Error('请先生成可用的 3D 模型')
  }
  if (
    !options.capture.dataUrl
    || !Number.isFinite(options.capture.width)
    || !Number.isFinite(options.capture.height)
    || options.capture.width <= 0
    || options.capture.height <= 0
  ) {
    throw new Error('当前 3D 机位没有可保存的画面')
  }

  const camera = normalizeModel3DCameraState(options.camera) ?? DEFAULT_MODEL3D_CAMERA_STATE
  const title = options.title?.trim() || `${source.title} · 机位回拍`
  const persisted = await (options.persistScreenshot ?? persistScene3DScreenshot)(
    options.capture.dataUrl,
    source.id,
    title,
    options.project,
  )
  options.project?.assertCurrent()
  const createdAt = options.now?.() ?? Date.now()
  const store = useGenerationCanvasStore.getState()
  const output = store.addNode({
    kind: 'image',
    title,
    prompt: `3D 机位代理回拍：方位角 ${camera.azimuth.toFixed(1)}°，仰俯角 ${camera.elevation.toFixed(1)}°，FOV ${camera.fov.toFixed(1)}°`,
    categoryId: source.categoryId || 'shots',
    position: {
      x: Math.round(source.position.x + (source.size?.width ?? 320) + 80),
      y: Math.round(source.position.y),
    },
  })
  const resultId = `model3d-camera-shot-${output.id}-${createdAt}`
  const result: GenerationNodeResult = {
    id: resultId,
    type: 'image',
    url: persisted.url,
    ...(persisted.assetId ? { assetId: persisted.assetId } : {}),
    ...(persisted.raw !== undefined ? { raw: persisted.raw } : {}),
    createdAt,
    provenance: {
      provider: 'nomi-local-3d-camera',
      ...(source.result.provenance?.modelKey ? { modelKey: source.result.provenance.modelKey } : {}),
      prompt: source.prompt,
      params: {
        sourceModelNodeId: source.id,
        sourceModelResultId: source.result.id,
        camera,
        width: Math.round(options.capture.width),
        height: Math.round(options.capture.height),
      },
      timestamp: createdAt,
    },
  }
  const size = mediaNodeSize(options.capture.width, options.capture.height)
  store.updateNode(output.id, {
    renderKind: 'shot-frame',
    result,
    history: [result],
    status: 'success',
    ...(size ? { size: { width: size.width, height: size.height } } : {}),
    meta: {
      ...(output.meta || {}),
      source: 'model3d-camera',
      modelAutoSelectDisabled: true,
      sourceNodeId: source.id,
      sourceResultId: source.result.id,
      localOnly: persisted.localOnly,
      imageWidth: Math.round(options.capture.width),
      imageHeight: Math.round(options.capture.height),
      imageAspectRatio: options.capture.width / Math.max(1, options.capture.height),
      ...(size ? { previewHeight: size.previewHeight } : {}),
      model3dCamera: camera,
    },
  })
  store.connectNodes(source.id, output.id, 'reference')
  await (options.persistProject ?? persistActiveWorkbenchProjectNow)()
  return { nodeId: output.id, resultId }
}

export async function createModel3DGrid9CaptureCollection(
  options: CreateModel3DGrid9CaptureCollectionOptions,
): Promise<Model3DGrid9CaptureCollectionOutcome> {
  options.project?.assertCurrent()
  const initialStore = useGenerationCanvasStore.getState()
  const source = initialStore.nodes.find((node) => node.id === options.sourceNodeId)
  if (!source) throw new Error('3D 机位代理节点不存在')
  if (source.result?.type !== 'model3d' || !source.result.url) {
    throw new Error('请先生成可用的 3D 模型')
  }
  const sourceResult = source.result

  const expectedIds = MODEL3D_GRID9_CAMERA_PRESETS.map((preset) => preset.id)
  if (
    options.frames.length !== expectedIds.length
    || options.frames.some((frame, index) => frame.id !== expectedIds[index] || !validCaptureFrame(frame.capture))
  ) {
    throw new Error('九机位引导必须包含按标准顺序生成的 9 张完整画面')
  }

  const createdAt = options.now?.() ?? Date.now()
  const title = options.title?.trim() || `${source.title} · 九机位引导`
  const persistScreenshot = options.persistScreenshot ?? persistScene3DScreenshot
  const persistedFrames: Array<Model3DGrid9CaptureFrame & { persisted: PersistedScene3DScreenshot }> = []
  for (const [index, frame] of options.frames.entries()) {
    const persisted = await persistScreenshot(
      frame.capture.dataUrl,
      source.id,
      `${title}-${String(index + 1).padStart(2, '0')}-${frame.id}`,
      options.project,
    )
    options.project?.assertCurrent()
    persistedFrames.push({ ...frame, persisted })
  }

  const results: GenerationNodeResult[] = persistedFrames.map((frame, index) => {
    const camera = normalizeModel3DCameraState(frame.camera) ?? DEFAULT_MODEL3D_CAMERA_STATE
    return {
      id: `model3d-camera-grid9-${source.id}-${frame.id}-${createdAt}`,
      type: 'image',
      url: frame.persisted.url,
      ...(frame.persisted.assetId ? { assetId: frame.persisted.assetId } : {}),
      ...(frame.persisted.raw !== undefined ? { raw: frame.persisted.raw } : {}),
      createdAt: createdAt + index,
      provenance: {
        provider: 'nomi-local-3d-camera',
        ...(sourceResult.provenance?.modelKey ? { modelKey: sourceResult.provenance.modelKey } : {}),
        prompt: source.prompt,
        params: {
          sourceModelNodeId: source.id,
          sourceModelResultId: sourceResult.id,
          cameraGuideId: frame.id,
          cameraGuideLabel: frame.label,
          camera,
          width: Math.round(frame.capture.width),
          height: Math.round(frame.capture.height),
        },
        timestamp: createdAt + index,
      },
    }
  })
  const store = useGenerationCanvasStore.getState()
  const output = store.addNode({
    kind: 'image',
    title,
    prompt: '3D 九机位几何引导；后续图生图精修必须保持对应方位角、仰俯角、物体形状和空间关系。',
    categoryId: source.categoryId || 'shots',
    position: {
      x: Math.round(source.position.x + (source.size?.width ?? 320) + 80),
      y: Math.round(source.position.y),
    },
  })
  const collectionId = `model3d-camera-grid9-${output.id}-${createdAt}`
  const collection = {
    id: collectionId,
    recipeId: 'model3d.camera.grid9',
    createdAt,
    items: persistedFrames.map((frame, index) => ({
      id: frame.id,
      label: frame.label,
      azimuth: frame.azimuth,
      elevation: frame.elevation,
      status: 'success' as const,
      result: results[index]!,
    })),
  }
  store.updateNode(output.id, {
    renderKind: 'shot-frame',
    result: results[0],
    history: results,
    resultCollections: [collection],
    status: 'success',
    size: { width: 540, height: 560 },
    meta: {
      ...(output.meta || {}),
      source: 'model3d-camera-grid9',
      modelAutoSelectDisabled: true,
      sourceNodeId: source.id,
      sourceResultId: sourceResult.id,
      model3dCameraGuide: true,
      localOnly: persistedFrames.every((frame) => frame.persisted.localOnly),
      imageWidth: Math.round(options.frames[0]!.capture.width),
      imageHeight: Math.round(options.frames[0]!.capture.height),
      imageAspectRatio: options.frames[0]!.capture.width / Math.max(1, options.frames[0]!.capture.height),
      previewHeight: 500,
    },
  })
  store.connectNodes(source.id, output.id, 'reference')
  await (options.persistProject ?? persistActiveWorkbenchProjectNow)()
  return {
    nodeId: output.id,
    collectionId,
    resultIds: results.map((result) => result.id),
  }
}
