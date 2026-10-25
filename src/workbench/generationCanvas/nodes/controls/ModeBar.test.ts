import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ModeBar from './ModeBar'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('generation mode hint readability', () => {
  it.each(['纯文字生成图像', '根据参考图片进行编辑', 'Generate an image from text'])('uses the existing caption token for %s independently of provider copy', hint => {
    const html = renderToStaticMarkup(React.createElement(ModeBar, {
      activeId: 'text', onSelect: vi.fn(),
      choices: [
        { id: 'text', vendorTerm: 'Text', hint },
        { id: 'reference', vendorTerm: 'Reference', hint: 'Reference image' },
      ],
    }))
    expect(html).toContain(`>${hint}</div>`)
    const hintClass = html.match(/<div class="([^"]+)"[^>]*>[^<]+<\/div><\/div>$/)?.[1]
    expect(hintClass?.split(' ')).toContain('text-caption')
    expect(hintClass?.split(' ')).not.toContain('text-micro')
  })
})
