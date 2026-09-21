import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  expose: vi.fn(), invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn(),
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke, send: mocks.send, on: mocks.on, removeListener: mocks.removeListener },
  webUtils: { getPathForFile: vi.fn() },
}))

type Bridge = Record<string, Record<string, (...args: unknown[]) => unknown>>
let bridge: Bridge
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.invoke.mockResolvedValue({ ok: true })
  await import('./preload')
  bridge = mocks.expose.mock.calls.find(([name]) => name === 'nomiDesktop')?.[1] as Bridge
})

describe('custom desktop methods reach their main-process channels', () => {
  it.each([
    ['assets', 'importLocalPath', 'nomi:assets:import-local-path'],
    ['assets', 'inspectModel3d', 'nomi:assets:inspect-model3d'],
    ['assets', 'inspectVideo', 'nomi:assets:inspect-video'],
    ['assets', 'archiveOutputCollection', 'nomi:assets:archive-output-collection'],
    ['assets', 'copyFiles', 'nomi:assets:copy-files'],
    ['files', 'extractText', 'nomi:files:extract-text'],
    ['jimengWeb', 'openAdmin', 'nomi:jimeng-web:open-admin'],
    ['scene3d', 'renderWithBlender', 'nomi:scene3d:render-blender'],
    ['scene3d', 'renderDirectorWithBlender', 'nomi:scene3d:render-director-blender'],
    ['scene3d', 'cancelBlender', 'nomi:scene3d:cancel-blender'],
    ['vibingDirector', 'applyBlenderPlan', 'nomi:vibing-director:apply-blender-plan'],
    ['vibingDirector', 'cancelBlenderPlan', 'nomi:vibing-director:cancel-blender-plan'],
    ['vibingDirector', 'importAsset', 'nomi:vibing-director:import-asset'],
    ['vibingDirector', 'importExistingAsset', 'nomi:vibing-director:import-existing-asset'],
    ['vibingDirector', 'listCatalogAssets', 'nomi:vibing-director:list-catalog-assets'],
    ['vibingDirector', 'importCatalogAsset', 'nomi:vibing-director:import-catalog-asset'],
    ['vibingDirector', 'openBlender', 'nomi:vibing-director:open-blender'],
    ['vibingDirector', 'openAssetSource', 'nomi:vibing-director:open-asset-source'],
    ['tasks', 'cancel', 'nomi:tasks:cancel'],
  ])('%s.%s forwards exactly one invocation to %s', async (group, method, channel) => {
    const payload = { projectId: 'isolated-fixture', jobId: 'local-job' }
    expect(typeof bridge[group]?.[method]).toBe('function')
    await expect(bridge[group][method](payload)).resolves.toEqual({ ok: true })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(channel, payload)
  })

  it.each([
    ['status', 'nomi:jimeng-web:status'],
    ['openLogin', 'nomi:jimeng-web:open-login'],
    ['startRunner', 'nomi:jimeng-web:start-runner'],
    ['stopRunner', 'nomi:jimeng-web:stop-runner'],
  ])('jimengWeb.%s uses %s without leaking arguments', async (method, channel) => {
    await bridge.jimengWeb[method]()
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(channel)
  })

  it('native browser dragging forwards events and cleans up its error subscription', () => {
    const payload = { url: 'nomi-local://asset/fixture/image.png' }
    bridge.browser.startAssetDrag(payload)
    bridge.browser.endAssetDrag()
    expect(mocks.send.mock.calls).toEqual([
      ['browser:asset-drag:start', payload], ['browser:asset-drag:end'],
    ])
    const callback = vi.fn()
    const unsubscribe = bridge.browser.onAssetDragError(callback) as () => void
    const listener = mocks.on.mock.calls.find(([channel]) => channel === 'browser:asset-drag:error')?.[1]
    listener({}, { message: 'local fixture error' })
    expect(callback).toHaveBeenCalledWith({ message: 'local fixture error' })
    unsubscribe()
    expect(mocks.removeListener).toHaveBeenCalledWith('browser:asset-drag:error', listener)
  })
})
