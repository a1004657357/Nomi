import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodeBrowserUploadDragHandle } from './NodeBrowserUploadDragHandle'

const mocks = vi.hoisted(() => ({ startAssetDrag: vi.fn(), toast: vi.fn() }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ browser: { startAssetDrag: mocks.startAssetDrag } }) }))
vi.mock('../../../ui/toast', () => ({ toast: mocks.toast }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('canvas-to-browser drag failure feedback', () => {
  it('reports one rejected command and never resubmits it', async () => {
    vi.spyOn(React, 'useEffect').mockImplementation(() => undefined)
    const command = Promise.reject(new Error('fixture bridge failure'))
    void command.catch(() => undefined)
    mocks.startAssetDrag.mockReturnValue(command)
    const element = NodeBrowserUploadDragHandle({ url: 'nomi-local://asset/fixture.png' }) as React.ReactElement<{
      onDragStart: (event: React.DragEvent<HTMLDivElement>) => void | Promise<void>
    }>
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.DragEvent<HTMLDivElement>
    await element.props.onDragStart(event)
    await Promise.resolve()
    expect(mocks.startAssetDrag).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('fixture bridge failure', 'error')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })
})
