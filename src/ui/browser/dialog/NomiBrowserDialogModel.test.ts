import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BROWSER_START_SHORTCUTS,
  MATERIAL_SITE_SHORTCUTS,
  readBrowserSideWidth,
  readBrowserWorkspaceMode,
  writeBrowserSideWidth,
  writeBrowserWorkspaceMode,
} from './NomiBrowserDialogModel'

describe('Nomi browser creation workspace', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes first-class ChatGPT Images and JiMeng Web entry points', () => {
    expect(BROWSER_START_SHORTCUTS.slice(0, 2).map((item) => item.url)).toEqual([
      'https://chatgpt.com/images/',
      'https://jimeng.jianying.com/ai-tool/image/generate',
    ])
    expect(MATERIAL_SITE_SHORTCUTS.slice(0, 2).map((item) => item.name)).toEqual([
      'ChatGPT 图像',
      '即梦 Web',
    ])
  })

  it('persists side and full workspace modes with the side width', () => {
    writeBrowserWorkspaceMode('full')
    writeBrowserSideWidth(912)
    expect(readBrowserWorkspaceMode()).toBe('full')
    expect(readBrowserSideWidth()).toBe(912)

    writeBrowserWorkspaceMode('side')
    expect(readBrowserWorkspaceMode()).toBe('side')
  })
})
