import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appendEvents: vi.fn(),
  send: vi.fn(),
  runTechnicalCheck: vi.fn(),
}))

vi.mock('electron', () => ({
  webContents: {
    getAllWebContents: () => [{ isDestroyed: () => false, send: mocks.send }],
  },
}))

vi.mock('../events/eventLogRepository', () => ({
  appendEvents: mocks.appendEvents,
}))

vi.mock('./technicalCheck', () => ({
  runTechnicalCheck: mocks.runTechnicalCheck,
}))

import { flushPendingTechnicalReviews, scheduleTechnicalReview } from './reviewTrace'

describe('reviewTrace headless flush', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('waits for pending review and forwards requested aspect ratio and duration', async () => {
    let release: ((value: unknown) => void) | undefined
    mocks.runTechnicalCheck.mockImplementation(() => new Promise((resolve) => {
      release = resolve
    }))

    scheduleTechnicalReview({
      projectId: 'project-1',
      nodeId: 'video-1',
      absolutePath: '/project/video.mp4',
      assetUrl: 'nomi-local://video.mp4',
      type: 'video',
      expectedAspectRatio: '9:16',
      expectedDurationSeconds: 5,
    })

    const flushed = flushPendingTechnicalReviews()
    await Promise.resolve()
    expect(mocks.appendEvents).not.toHaveBeenCalled()
    expect(mocks.runTechnicalCheck).toHaveBeenCalledWith('/project/video.mp4', 'video', {
      expectedAspectRatio: '9:16',
      expectedDurationSeconds: 5,
    })

    release?.({ suspect: true, checks: [{ id: 'aspect-ratio', suspect: true, detail: 'mismatch' }] })
    await flushed

    expect(mocks.appendEvents).toHaveBeenCalledWith('project-1', [
      expect.objectContaining({
        type: 'review.technical.completed',
        payload: expect.objectContaining({ nodeId: 'video-1', verdict: 'suspect' }),
      }),
    ])
  })
})
