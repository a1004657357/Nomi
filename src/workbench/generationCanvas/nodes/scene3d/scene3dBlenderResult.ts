import { canvasSourceDefaults } from '../../../../../electron/shared/canvas/sourceDefaults'
import type { GenerationCanvasNode, GenerationNodeResult } from '../../model/generationCanvasTypes'

export type BlenderSceneAssetRef = { url: string; assetId?: string }

export type BlenderSceneRenderResult = {
  jobId: string
  blenderVersion?: string
  preview: BlenderSceneAssetRef
  blend: BlenderSceneAssetRef
  model: BlenderSceneAssetRef
}

export type BlenderOutputNodeSpec = Pick<GenerationCanvasNode, 'kind' | 'title' | 'prompt' | 'position' | 'size' | 'result' | 'history' | 'status' | 'meta'>

export function blenderOutputCategoryId(categoryId?: string): string {
  return categoryId || 'shots'
}

export function shouldApplyBlenderResult(expectedProjectId: string, activeProjectId: string | null, sourceNodeExists: boolean): boolean {
  return expectedProjectId === activeProjectId && sourceNodeExists
}

export function buildBlenderOutputNodeSpecs(input: {
  sourceNodeId: string
  sourcePosition: { x: number; y: number }
  sourceWidth: number
  result: BlenderSceneRenderResult
  source?: 'blender' | 'blender-director'
  createdAt?: number
  runIndex?: number
}): BlenderOutputNodeSpec[] {
  const createdAt = input.createdAt ?? Date.now()
  const runIndex = Math.max(0, Math.floor(input.runIndex || 0))
  const x = Math.round(input.sourcePosition.x + Math.max(320, input.sourceWidth) + 80 + runIndex * 400)
  const source = input.source || 'blender'
  const isDirectorPreview = source === 'blender-director'
  const commonMeta = {
    source,
    sourceNodeId: input.sourceNodeId,
    blenderJobId: input.result.jobId,
    blenderVersion: input.result.blenderVersion,
    blenderBlendUrl: input.result.blend.url,
    blenderBlendAssetId: input.result.blend.assetId,
  }
  const previewResult: GenerationNodeResult = {
    id: `blender-preview-${input.result.jobId}`,
    type: 'image',
    url: input.result.preview.url,
    assetId: input.result.preview.assetId,
    createdAt,
  }
  const modelResult: GenerationNodeResult = {
    id: `blender-model-${input.result.jobId}`,
    type: 'model3d',
    url: input.result.model.url,
    assetId: input.result.model.assetId,
    createdAt,
  }
  return [
    {
      kind: 'image',
      title: canvasSourceDefaults.blenderPreviewTitle(isDirectorPreview),
      prompt: isDirectorPreview ? 'Blender 导演 manifest 预演' : 'Blender 后台渲染场景预览',
      position: { x, y: Math.round(input.sourcePosition.y) },
      size: { width: 360, height: 240 },
      result: previewResult,
      history: [previewResult],
      status: 'success',
      meta: { ...commonMeta, blenderAssetKind: 'preview' },
    },
    {
      kind: 'model3d',
      title: canvasSourceDefaults.blenderModelTitle(isDirectorPreview),
      prompt: isDirectorPreview ? 'Blender 导演 manifest GLB 场景' : 'Blender GLB 场景模型',
      position: { x, y: Math.round(input.sourcePosition.y + 320) },
      size: { width: 360, height: 300 },
      result: modelResult,
      history: [modelResult],
      status: 'success',
      meta: { ...commonMeta, blenderAssetKind: 'model', blenderModelAssetId: input.result.model.assetId },
    },
  ]
}
