import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'

const mocks = vi.hoisted(() => ({ extract: vi.fn(), list: vi.fn(), send: vi.fn() }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ video: { extractFrame: mocks.extract }, assets: { list: mocks.list } }) }))
vi.mock('../../ai/agentLoopMode', () => ({ runSingleShotAgent: mocks.send }))
import { makeShotVerifyDeps } from './shotVerifyJudge'

let session: ReturnType<typeof createProjectSessionTestHarness>
let project: ProjectExecutionContext
beforeEach(async () => {
  vi.resetAllMocks()
  session = createProjectSessionTestHarness()
  await session.open('A')
  project = withProjectAction(project => project)!
  mocks.extract.mockResolvedValue({ url: 'nomi-local://frame-A' })
  mocks.list.mockResolvedValue({ items: [{ id: 'frame-A', projectId: 'A', data: { url: 'nomi-local://frame-A' } }] })
  mocks.send.mockResolvedValue({ text: 'review A' })
})
afterEach(() => session.dispose())

describe('shot verification project execution boundary', () => {
  it('passes the full extraction binding and main-owned frame claim', async () => {
    const deps = makeShotVerifyDeps(project)
    expect(await deps.judge('check A', await deps.extractFrame('video-A'))).toBe('review A')
    expect(mocks.extract).toHaveBeenCalledWith({ videoUrl: 'video-A', which: 'first', projectId: 'A', projectBinding: project.binding })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'A', featureKey: 'nomi:shot-verify:A',
      attachments: [{ url: 'nomi-local://frame-A', contentType: 'image/png', fileName: 'shot-frame.png', kind: 'image' }],
      attachmentClaims: [{ assetId: 'frame-A', version: 1 }],
    }))
  })

  it('does not submit a late frame after A to B to A', async () => {
    let release!: (result: { url: string }) => void
    mocks.extract.mockReturnValue(new Promise(resolve => { release = resolve }))
    const deps = makeShotVerifyDeps(project)
    const extracting = deps.extractFrame('video-A')
    await session.open('B')
    await session.open('A')
    release({ url: 'nomi-local://frame-A' })
    await expect(extracting).rejects.toThrow()
    await expect(deps.judge('check', 'nomi-local://frame-A')).rejects.toThrow()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('rejects an asset lookup completed after project switch', async () => {
    let release!: (result: unknown) => void
    mocks.list.mockReturnValue(new Promise(resolve => { release = resolve }))
    const pending = makeShotVerifyDeps(project).judge('check', 'nomi-local://frame-A')
    await session.open('B')
    release({ items: [{ id: 'frame-A', projectId: 'A', data: { url: 'nomi-local://frame-A' } }] })
    await expect(pending).rejects.toThrow()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('refuses local frames without an owned asset identity', async () => {
    mocks.list.mockResolvedValue({ items: [] })
    await expect(makeShotVerifyDeps(project).judge('check', 'nomi-local://missing')).rejects.toThrow('shot_verify_frame_asset_unresolved')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('cancels an in-flight review and rejects its late result on switch', async () => {
    let release!: (result: { text: string }) => void
    const cancel = vi.fn()
    mocks.send.mockImplementation(input => { input.onCancelReady(cancel); return new Promise(resolve => { release = resolve }) })
    const pending = makeShotVerifyDeps(project).judge('check', 'nomi-local://frame-A')
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce())
    await session.open('B')
    expect(cancel).toHaveBeenCalledOnce()
    release({ text: 'late A review' })
    await expect(pending).rejects.toThrow()
  })
})
