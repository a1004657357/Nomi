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
  it('reports unavailable original expectation without guessing requested pixels', async () => {
    const verdict = await technicalCheck.runTechnicalCheck('/virtual/recovered.png', 'image', {
      expectedImageSize: null,
      probeMedia: async () => ({ kind: 'image', width: 1254, height: 1254, hasAudio: false }),
    });
    expect(verdict.imageSizeValidation).toMatchObject({ requested: null, actual: { width: 1254, height: 1254 }, status: 'unavailable', warning: 'image_size_unavailable' });
    expect(verdict.checks.find(check => check.id === 'image-size')?.suspect).toBe(true);
  });
  it.each([[1254, 1254, true], [1536, 1024, true], [1024, 1024, false]])(
    'compares exact original pixels %ix%i, not only square aspect ratio', async (width, height, mismatch) => {
      const verdict = await technicalCheck.runTechnicalCheck('/virtual/original.png', 'image', {
        expectedImageSize: '1024x1024',
        probeMedia: async () => ({ kind: 'image', width, height, hasAudio: false }),
      });
      expect(verdict.imageSizeValidation).toEqual({
        requested: { width: 1024, height: 1024 }, actual: { width, height },
        status: mismatch ? 'mismatch' : 'matched',
        ...(mismatch ? { warning: 'image_size_mismatch' } : {}),
        originalPreserved: true, normalizationApplied: false,
      });
      expect(verdict.checks.find((check) => check.id === 'image-size')).toMatchObject({ suspect: mismatch });
    },
  );

  it('never marks missing probe data as an exact-size pass', async () => {
    const verdict = await technicalCheck.runTechnicalCheck('/virtual/original.png', 'image', {
      expectedImageSize: '1024x1024', probeMedia: async () => { throw new Error('probe failed'); },
    });
    expect(verdict.imageSizeValidation).toMatchObject({ status: 'unavailable', actual: null, warning: 'image_size_unavailable' });
    expect(verdict.suspect).toBe(true);
  });

  it('does not infer exact dimensions from auto or from a video request', async () => {
    const probeMedia = async () => ({ kind: 'image' as const, width: 1254, height: 1254, hasAudio: false });
    const image = await technicalCheck.runTechnicalCheck('/virtual/original.png', 'image', { expectedImageSize: 'auto', probeMedia });
    const video = await technicalCheck.runTechnicalCheck('/virtual/video.mp4', 'video', { expectedImageSize: '1024x1024', probeMedia });
    expect(image.imageSizeValidation).toBeUndefined();
    expect(video.imageSizeValidation).toBeUndefined();
  });
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

  it('marks a Provider output suspect when the actual aspect ratio misses the requested ratio', async () => {
    const verdict = await technicalCheck.runTechnicalCheck('/virtual/agnes.mp4', 'video', {
      probeMedia: vi.fn(async () => ({
        kind: 'video' as const,
        durationSeconds: 5.041667,
        width: 704,
        height: 1280,
        fps: 24,
        videoCodec: 'h264',
        hasAudio: false,
      })),
      runFfmpegStderr: vi.fn(async () => ''),
      expectedAspectRatio: '9:16',
      expectedDurationSeconds: 5,
    })

    expect(verdict.suspect).toBe(true)
    expect(verdict.checks.find((check) => check.id === 'aspect-ratio')).toMatchObject({
      suspect: true,
      metrics: { width: 704, height: 1280 },
    })
    expect(verdict.checks.find((check) => check.id === 'duration')).toMatchObject({ suspect: false })
  })

  it('accepts near-exact generated image dimensions for the requested ratio', async () => {
    const verdict = await technicalCheck.runTechnicalCheck('/virtual/codex.png', 'image', {
      probeMedia: vi.fn(async () => ({
        kind: 'image' as const,
        width: 941,
        height: 1672,
        hasAudio: false,
      })),
      expectedAspectRatio: '9:16',
    })

    expect(verdict.checks.find((check) => check.id === 'aspect-ratio')).toMatchObject({ suspect: false })
    expect(verdict.suspect).toBe(false)
  })

  it('marks a decodable 100x100 generated placeholder as suspect', async () => {
    const verdict = await technicalCheck.runTechnicalCheck('/virtual/codex-placeholder.png', 'image', {
      probeMedia: vi.fn(async () => ({
        kind: 'image' as const,
        width: 100,
        height: 100,
        hasAudio: false,
      })),
    })

    expect(verdict.suspect).toBe(true)
    expect(verdict.checks.find((check) => check.id === 'undecodable')).toMatchObject({
      suspect: true,
      metrics: { width: 100, height: 100 },
    })
  })
})
