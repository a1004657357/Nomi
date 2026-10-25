import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../../project/projectSessionTestHarness'
import { withProjectAction, type ProjectExecutionContext } from '../../../project/projectCanvasReadSurface'

const bridge = vi.hoisted(() => ({ available: true, image: vi.fn(), video: vi.fn() }))
vi.mock('../../../../desktop/bridge', () => ({
  getDesktopBridge: () => bridge.available ? {
    assets: { importRemoteUrl: bridge.image }, scene3d: { framesToVideo: bridge.video },
  } : null,
}))

import { persistScene3DScreenshot } from './scene3dScreenshot'
import { persistCameraMoveVideo } from './cameraMoveVideo'

const still = 'data:image/png;base64,capture'
const imageUrl = 'nomi-local://asset/original/frame.png'
const videoUrl = 'nomi-local://asset/original/move.mp4'
let sessions: ProjectSessionTestHarness
let project: ProjectExecutionContext

beforeEach(async () => {
  bridge.available = true
  bridge.image.mockReset().mockResolvedValue({ ok: true, asset: { id: 'image', data: { url: imageUrl } } })
  bridge.video.mockReset().mockResolvedValue({ url: videoUrl, assetId: 'video' })
  sessions = createProjectSessionTestHarness()
  await sessions.open('original')
  project = withProjectAction((issued) => issued)!
})
afterEach(() => sessions.dispose())

describe('scene3d project-bound persistence', () => {
  it('requires an issued screenshot context and sends the full binding', async () => {
    await expect(persistScene3DScreenshot(still, 'node', 'Shot', project)).resolves.toMatchObject({ url: imageUrl, localOnly: false })
    expect(bridge.image).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'original', projectBinding: project.binding, kind: 'generated', expectedKind: 'image', ownerNodeId: 'node',
    }))
  })

  it('requires an issued video context and sends the same binding to the custom bridge', async () => {
    await expect(persistCameraMoveVideo([still, still], 'node', 'Move', 24, project)).resolves.toMatchObject({ url: videoUrl, localOnly: false })
    expect(bridge.video).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'original', projectBinding: project.binding, ownerNodeId: 'node', frames: [still, still], fps: 24,
    }))
  })

  for (const kind of ['image', 'video'] as const) {
    const persist = (context: ProjectExecutionContext | null) => kind === 'image'
      ? persistScene3DScreenshot(still, 'node', 'Shot', context)
      : persistCameraMoveVideo([still, still], 'node', 'Move', 24, context)

    it(`${kind}: rejects an expired explicit context instead of adopting the replacement project`, async () => {
      await sessions.open('replacement')
      await expect(persist(project)).rejects.toMatchObject({ code: 'project_binding_stale' })
      expect(bridge[kind]).not.toHaveBeenCalled()
    })

    it(`${kind}: rejects a late reply even after A -> B -> A`, async () => {
      let reply!: () => void
      bridge[kind].mockImplementation(() => new Promise((resolve) => {
        reply = () => resolve(kind === 'image'
          ? { ok: true, asset: { id: 'image', data: { url: imageUrl } } }
          : { url: videoUrl, assetId: 'video' })
      }))
      const running = persist(project)
      const rejected = expect(running).rejects.toMatchObject({ code: 'project_binding_stale' })
      await sessions.open('replacement')
      await sessions.open('original')
      reply()
      await rejected
      expect(bridge[kind]).toHaveBeenCalledOnce()
    })

    it.each([undefined, '', '  ', 'blob:temporary', still])(`${kind}: does not label a temporary or missing URL as persisted: %s`, async (url) => {
      bridge[kind].mockResolvedValue(kind === 'image'
        ? { ok: true, asset: { id: 'image', data: { url } } }
        : { url, assetId: 'video' })
      await expect(persist(project)).rejects.toThrow()
    })

    it(`${kind}: explicitly keeps browser-only captures local`, async () => {
      bridge.available = false
      await expect(persist(project)).resolves.toMatchObject({ localOnly: true })
      expect(bridge[kind]).not.toHaveBeenCalled()
    })

    it(`${kind}: an explicit absent project never reissues authority from the current one`, async () => {
      await expect(persist(null)).resolves.toMatchObject({ localOnly: true })
      expect(bridge[kind]).not.toHaveBeenCalled()
    })
  }
})
