import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { FloatingToolbarShell } from './NodeFloatingToolbar'
import { NODE_FLOATING_TOOLBAR_SELECTOR } from './nodeFloatingToolbarLayout'

describe('FloatingToolbarShell', () => {
  it('marks the toolbar so the generation composer can measure and avoid it', () => {
    useGenerationCanvasStore.setState({ canvasZoom: 1 })

    const markup = renderToStaticMarkup(
      React.createElement(
        FloatingToolbarShell,
        { ariaLabel: '图片操作', children: React.createElement('button', { type: 'button' }, '裁剪') },
      ),
    )

    expect(markup).toContain('data-node-floating-toolbar="true"')
    expect(NODE_FLOATING_TOOLBAR_SELECTOR).toBe('[data-node-floating-toolbar="true"]')
  })
})
