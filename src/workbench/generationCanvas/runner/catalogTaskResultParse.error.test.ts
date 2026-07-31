import { describe, expect, it } from 'vitest'
import type { TaskResultDto } from '../../api/taskApi'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { normalizeCatalogTaskResult } from './catalogTaskResultParse'

const node = {
  id: 'jimeng-image-node',
  kind: 'image',
  title: '即梦图片',
  position: { x: 0, y: 0 },
  size: { width: 320, height: 240 },
  prompt: 'test',
  status: 'idle',
  categoryId: 'shots',
  meta: {},
} as GenerationCanvasNode

describe('catalog task failure details', () => {
  it('reads the nested Jimeng bridge error instead of replacing it with a generic failure', () => {
    const result = {
      id: 'IMG-FAILED',
      kind: 'image_edit',
      status: 'failed',
      assets: [],
      raw: {
        jimengWeb: {
          error: '图片结果同步失败：Failed to fetch',
        },
      },
    } as TaskResultDto

    expect(() => normalizeCatalogTaskResult(result, node)).toThrow(
      /图片结果同步失败：Failed to fetch.*taskId=IMG-FAILED/,
    )
  })
})
