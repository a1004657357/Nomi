import { describe, expect, it, vi } from 'vitest'
import * as projectAssetStore from './projectAssetStore'

describe('inspectProjectVideoAsset', () => {
  it('resolves a local project video and returns its technical inspection', async () => {
    const resolvePath = vi.fn(() => '/project/assets/generated/clip.mp4')
    const inspectVideo = vi.fn(async () => ({
      suspect: false,
      metadata: {
        kind: 'video' as const,
        durationSeconds: 4,
        width: 720,
        height: 1280,
        hasAudio: false,
      },
      checks: [],
    }))
    const candidate = (projectAssetStore as unknown as {
      inspectProjectVideoAsset?: (
        payload: unknown,
        deps: {
          resolvePath: typeof resolvePath
          inspectVideo: typeof inspectVideo
        },
      ) => Promise<unknown>
    }).inspectProjectVideoAsset
    expect(typeof candidate).toBe('function')

    const result = await candidate!(
      { url: 'nomi-local://asset/project/assets/generated/clip.mp4' },
      { resolvePath, inspectVideo },
    )

    expect(resolvePath).toHaveBeenCalledWith('nomi-local://asset/project/assets/generated/clip.mp4')
    expect(inspectVideo).toHaveBeenCalledWith('/project/assets/generated/clip.mp4', 'video')
    expect(result).toMatchObject({
      metadata: {
        durationSeconds: 4,
        width: 720,
        height: 1280,
      },
    })
  })
})
