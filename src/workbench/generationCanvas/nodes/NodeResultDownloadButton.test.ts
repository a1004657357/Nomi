import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import NodeResultDownloadButton from './NodeResultDownloadButton'

describe('NodeResultDownloadButton', () => {
  const initialLanguage = i18n.language
  afterEach(async () => { await i18n.changeLanguage(initialLanguage) })
  it.each(['zh-CN', 'en'])('offers existing compact handoff labels with full tooltips (%s)', async language => {
    await i18n.changeLanguage(language)
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
        reportFeedback: () => {},
      }),
    )

    expect(markup).toContain(language === 'en' ? 'aria-label="Open director"' : 'aria-label="送导演台"')
    expect(markup).toContain(language === 'en' ? 'aria-label="To Blender"' : 'aria-label="送入 Blender Director"')
    expect(markup).toContain(language === 'en' ? 'Create an interactive Scene3D director node' : '创建可交互的 Scene3D 导演台节点')
    expect(markup).toContain(language === 'en' ? 'Copy to the Blender Director asset library and create a staged object' : '复制到 Blender Director 资产库并创建摆位对象')
    expect(markup).toContain(language === 'en' ? 'aria-label="Download"' : 'aria-label="下载"')
  })

  it.each(['unselected', 'no-result', 'image'] as const)('does not offer the model toolbar for %s', reason => {
    const node: GenerationCanvasNode = { id: 'non-model-toolbar', kind: 'model3d', title: 'raw title', position: { x: 0, y: 0 },
      ...(reason === 'no-result' ? {} : { result: { id: 'result', type: reason === 'image' ? 'image' : 'model3d', url: 'nomi-local://asset/p/result', createdAt: 1 } }),
    }
    expect(renderToStaticMarkup(React.createElement(NodeResultDownloadButton, {
      node, selected: reason !== 'unselected', onPreview: () => {}, onOpenProvenance: () => {}, reportFeedback: () => {},
    }))).toBe('')
  })
})
