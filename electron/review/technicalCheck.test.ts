import { describe, expect, it, vi } from 'vitest'
import * as technicalCheck from './technicalCheck'

type ParsedVideoMetrics = {
  blackSeconds: number
  blackRatio: number
  frozenSeconds: number
  freezeRatio: number
}

function parser(): (stderr: string, durationSeconds: number) => ParsedVideoMetrics {
  const candidate = (technicalCheck as unknown as {
    parseVideoTechnicalMetrics?: (stderr: string, durationSeconds: number) => ParsedVideoMetrics
  }).parseVideoTechnicalMetrics
  expect(typeof candidate).toBe('function')
  return candidate!
}

describe('parseVideoTechnicalMetrics', () => {
  it('calculates bounded black-frame and frozen-frame ratios', () => {
    const metrics = parser()([
      '[blackdetect] black_start:0 black_end:1 black_duration:1',
      '[blackdetect] black_start:5 black_end:7 black_duration:2',
      '[freezedetect] lavfi.freezedetect.freeze_start: 2',
      '[freezedetect] lavfi.freezedetect.freeze_duration: 3',
      '[freezedetect] lavfi.freezedetect.freeze_end: 5',
    ].join('\n'), 10)

    expect(metrics).toEqual({
      blackSeconds: 3,
      blackRatio: 0.3,
      frozenSeconds: 3,
      freezeRatio: 0.3,
    })
  })

  it('counts a freeze that continues through the final frame', () => {
    const metrics = parser()(
      '[freezedetect] lavfi.freezedetect.freeze_start: 7.5',
      10,
    )

    expect(metrics.frozenSeconds).toBe(2.5)
    expect(metrics.freezeRatio).toBe(0.25)
  })
})

describe('runTechnicalCheck video inspection', () => {
  it('returns media metadata plus black-frame and frozen-frame checks', async () => {
    const probeMedia = vi.fn(async () => ({
      kind: 'video' as const,
      durationSeconds: 10,
      width: 1920,
      height: 1080,
      fps: 24,
      videoCodec: 'h264',
      hasAudio: false,
    }))
    const runFfmpegStderr = vi.fn(async (_args: string[]) => [
      '[blackdetect] black_start:0 black_end:1 black_duration:1',
      '[freezedetect] lavfi.freezedetect.freeze_start: 2',
      '[freezedetect] lavfi.freezedetect.freeze_duration: 7',
      '[freezedetect] lavfi.freezedetect.freeze_end: 9',
    ].join('\n'))
    const run = technicalCheck.runTechnicalCheck as unknown as (
      absolutePath: string,
      type: 'image' | 'video',
      options: {
        probeMedia: typeof probeMedia
        runFfmpegStderr: typeof runFfmpegStderr
      },
    ) => Promise<{
      metadata?: { durationSeconds?: number; width?: number; height?: number }
      checks: Array<{
        id: string
        suspect: boolean
        metrics?: Record<string, number>
      }>
    }>

    const verdict = await run('/virtual/generated.mp4', 'video', {
      probeMedia,
      runFfmpegStderr,
    })

    expect(probeMedia).toHaveBeenCalledWith('/virtual/generated.mp4')
    expect(verdict.metadata).toMatchObject({
      durationSeconds: 10,
      width: 1920,
      height: 1080,
    })
    expect(verdict.checks.find((check) => check.id === 'black-frames')).toMatchObject({
      suspect: false,
      metrics: { blackRatio: 0.1, blackSeconds: 1 },
    })
    expect(verdict.checks.find((check) => check.id === 'frozen-video')).toMatchObject({
      suspect: true,
      metrics: { freezeRatio: 0.7, frozenSeconds: 7 },
    })
  })
})
