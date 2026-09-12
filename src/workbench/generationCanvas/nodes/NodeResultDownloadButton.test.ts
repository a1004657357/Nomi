import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import NodeResultDownloadButton from './NodeResultDownloadButton'

describe('NodeResultDownloadButton', () => {
  it('offers both Scene3D and Blender Director handoff actions for a generated model', () => {
    const node: GenerationCanvasNode = {
      id: 'model-1',
      kind: 'model3d',
      title: '生成模型',
      categoryId: 'scene',
      position: { x: 0, y: 0 },
      result: {
        id: 'result-1',
        type: 'model3d',
        url: 'nomi-local://asset/p/model.glb',
        createdAt: 100,
      },
    }

    const markup = renderToStaticMarkup(
      React.createElement(NodeResultDownloadButton, {
        node, selected: true, onPreview: () => {}, onOpenProvenance: () => {},
      }),
    )

    expect(markup).toContain('送入 3D 导演台')
    expect(markup).toContain('送入 Blender Director')
    expect(markup).toContain('下载')
  })
})
