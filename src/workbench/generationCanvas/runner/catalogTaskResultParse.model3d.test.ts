import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { normalizeCatalogTaskResult } from './catalogTaskResultParse'
import type { TaskAssetDto } from '../../api/taskApi'

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

  const missingModelCases: Array<{ label: string; assets: TaskAssetDto[] }> = [
    { label: 'no assets', assets: [] },
    { label: 'preview only', assets: [{ type: 'image', url: 'https://cdn.example/preview.png' }] },
    { label: 'blank model URL', assets: [{ type: 'model3d', url: '   ' }] },
  ]
  for (const kind of ['text_to_3d', 'image_to_3d'] as const) {
    it.each(missingModelCases)(`${kind}: reports the missing GLB with a recoverable parse code ($label)`, ({ assets }) => {
      expect(() => normalizeCatalogTaskResult({
        id: 'task-model3d-empty',
        kind,
        status: 'succeeded',
        assets,
        raw: {},
      }, model3dNode)).toThrow(/^NOMI_ERR::retrieval-parse::.*3D.*GLB/)
    })
  }
})
