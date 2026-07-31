import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { normalizeCatalogTaskResult } from './catalogTaskResultParse'

const model3dNode: GenerationCanvasNode = {
  id: 'model3d-node',
  kind: 'model3d',
  title: '图生 3D',
  prompt: '把参考图重建为可编辑模型',
  position: { x: 0, y: 0 },
  meta: {
    modelKey: 'hunyuan3d-v3.1',
    modelVendor: 'runninghub',
  },
}

describe('normalizeCatalogTaskResult model3d output', () => {
  it('keeps the GLB as the primary result when the provider also returns a preview image', () => {
    const result = normalizeCatalogTaskResult({
      id: 'task-model3d',
      kind: 'image_to_3d',
      status: 'succeeded',
      assets: [
        { type: 'image', url: 'https://cdn.example/model-preview.png' },
        { type: 'model3d', url: 'nomi-local://asset/project/model.glb' },
      ],
      raw: {},
    }, model3dNode)

    expect(result).toMatchObject({
      type: 'model3d',
      url: 'nomi-local://asset/project/model.glb',
    })
    expect(result.alternatives).toEqual([
      expect.objectContaining({
        type: 'image',
        url: 'https://cdn.example/model-preview.png',
      }),
    ])
  })

  it('reports a missing GLB instead of claiming that an image URL is missing', () => {
    expect(() => normalizeCatalogTaskResult({
      id: 'task-model3d-empty',
      kind: 'image_to_3d',
      status: 'succeeded',
      assets: [],
      raw: {},
    }, model3dNode)).toThrow(/3D.*GLB/)
  })
})
