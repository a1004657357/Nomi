import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_SMOKE_RECIPE_IDS,
  classifyProviderFailure,
  createSmokeState,
  describeMissingCompatibleModel,
  effectiveProviderCooldownMs,
  extractSmokePhaseTimings,
  markSmokeCaseSucceeded,
  mergeSmokeState,
  parseSmokeConfig,
  parseSmokeModelOptionValue,
  plannedProviderCallsForRecipe,
  providerCallsFromSpendDialog,
  sanitizeSmokeReport,
  smokeQualityDisposition,
  smokeHelpRequested,
  smokePatternMatches,
  shouldRetryProviderFailure,
} from './capability-real-smoke-policy.mjs'

describe('capability real smoke policy', () => {
  it('recognizes conventional help flags before any smoke side effects', () => {
    expect(smokeHelpRequested(['--help'])).toBe(true)
    expect(smokeHelpRequested(['-h'])).toBe(true)
    expect(smokeHelpRequested(['--dry-run'])).toBe(false)
  })

  it('defaults to a zero-spend inspection of every recipe', () => {
    const config = parseSmokeConfig([], {})
    expect(config.allowPaid).toBe(false)
    expect(config.maxProviderCalls).toBe(0)
    expect(config.recipes).toEqual(CAPABILITY_SMOKE_RECIPE_IDS)
  })

  it('defaults paid mode to one low-cost recipe and one provider call', () => {
    const config = parseSmokeConfig([], { NOMI_ALLOW_PAID_EVAL: '1' })
    expect(config.allowPaid).toBe(true)
    expect(config.recipes).toEqual(['image.multiview.custom'])
    expect(config.maxProviderCalls).toBe(1)
    expect(config.maxProviderCallsPerModel).toBe(10)
    expect(config.maxAttemptsPerRecipe).toBe(1)
    expect(config.customViewCount).toBe(1)
  })

  it('budgets independent Grid9 and mood sample runs by their real task counts', () => {
    expect(plannedProviderCallsForRecipe('image.multiview.grid9')).toBe(9)
    expect(plannedProviderCallsForRecipe('portrait.mood')).toBe(5)
    expect(plannedProviderCallsForRecipe('portrait.refine')).toBe(1)
    expect(() => plannedProviderCallsForRecipe('unknown')).toThrow(/planned Provider call count/)
  })

  it('parses current four-part model values and supports exact provider filters', () => {
    expect(parseSmokeModelOptionValue('codex::codex-img2::::i2i')).toEqual({
      vendorKey: 'codex',
      modelKey: 'codex-img2',
      modeId: 'i2i',
    })
    expect(parseSmokeModelOptionValue('vendor::model::fast::edit')).toEqual({
      vendorKey: 'vendor',
      modelKey: 'model',
      variantId: 'fast',
      modeId: 'edit',
    })
    expect(smokePatternMatches(/^codex$/i, 'codex', 'Codex Img2 · 图生图兼容')).toBe(true)
    expect(smokePatternMatches(/^codex$/i, 'agnes', 'Agnes Image')).toBe(false)
  })

  it('parses explicit recipes, cooldown, retry, resume, and model filters', () => {
    const config = parseSmokeConfig([
      '--recipes=portrait.mood,scene.panorama.2to1,portrait.mood',
      '--max-provider-calls=6',
      '--max-attempts-per-recipe=2',
      '--max-provider-calls-per-model=7',
      '--retry-limit=1',
      '--cooldown-ms=45000',
      '--resume',
      '--provider=codex',
      '--model=img2',
      '--custom-view-count=2',
    ], { NOMI_ALLOW_PAID_EVAL: '1' })

    expect(config.recipes).toEqual(['portrait.mood', 'scene.panorama.2to1'])
    expect(config.maxProviderCalls).toBe(6)
    expect(config.maxProviderCallsPerModel).toBe(7)
    expect(config.maxAttemptsPerRecipe).toBe(2)
    expect(config.retryLimit).toBe(1)
    expect(config.cooldownMs).toBe(45_000)
    expect(config.resume).toBe(true)
    expect(config.providerPattern?.source).toBe('codex')
    expect(config.modelPattern?.source).toBe('img2')
    expect(config.customViewCount).toBe(2)
  })

  it('accepts conventional space-separated option values and an npm separator', () => {
    const config = parseSmokeConfig([
      '--',
      '--dry-run',
      '--recipes',
      'video.edit.look,image.multiview.reconstruct3d',
      '--max-provider-calls',
      '0',
      '--run-dir',
      'evals/runs/final-zero-spend',
      '--use-user-settings',
    ], { NOMI_ALLOW_PAID_EVAL: '1' })

    expect(config.allowPaid).toBe(false)
    expect(config.recipes).toEqual(['video.edit.look', 'image.multiview.reconstruct3d'])
    expect(config.maxProviderCalls).toBe(0)
    expect(config.runDir).toBe('evals/runs/final-zero-spend')
    expect(config.useUserSettings).toBe(true)
  })

  it('rejects unknown recipes and unsafe numeric limits', () => {
    expect(() => parseSmokeConfig(['--recipes=unknown'], {})).toThrow(/Unknown capability smoke recipe/)
    expect(() => parseSmokeConfig(['--cooldown-ms=-1'], {})).toThrow(/cooldown/i)
    expect(() => parseSmokeConfig(['--max-provider-calls=101'], {})).toThrow(/provider calls/i)
    expect(() => parseSmokeConfig(['--max-provider-calls-per-model=11'], {
      NOMI_ALLOW_PAID_EVAL: '1',
    })).toThrow(/per-model/i)
    expect(() => parseSmokeConfig(['--custom-view-count=7'], {})).toThrow(/custom view count/i)
  })

  it('stops on rate limits and only retries bounded transient failures', () => {
    expect(classifyProviderFailure('HTTP 429 rate limit exceeded')).toBe('rate_limit')
    expect(classifyProviderFailure('read timed out after 30 seconds')).toBe('timeout')
    expect(classifyProviderFailure('HTTP 401 invalid API key')).toBe('auth')
    expect(shouldRetryProviderFailure({ kind: 'rate_limit', attempt: 1, retryLimit: 3 })).toBe(false)
    expect(shouldRetryProviderFailure({ kind: 'timeout', attempt: 1, retryLimit: 1 })).toBe(true)
    expect(shouldRetryProviderFailure({ kind: 'timeout', attempt: 2, retryLimit: 1 })).toBe(false)
  })

  it('classifies local output contract failures separately from provider failures', () => {
    expect(classifyProviderFailure('Output contract failed: expectedOutputs=5 outputCount=1')).toBe('contract')
  })

  it('counts actual independent requests from the spend dialog', () => {
    expect(providerCallsFromSpendDialog('生成任务5 次独立请求', 1)).toBe(5)
    expect(providerCallsFromSpendDialog('生成任务 1 次独立请求', 5)).toBe(1)
    expect(providerCallsFromSpendDialog('旧版确认框没有任务数', 3)).toBe(3)
  })

  it('resumes completed cases without losing pending recipe order', () => {
    const fresh = createSmokeState({
      generatedAt: '2026-07-16T00:00:00.000Z',
      recipes: ['image.multiview.custom', 'portrait.refine'],
      allowPaid: true,
      maxProviderCalls: 2,
    })
    const resumed = mergeSmokeState(fresh, {
      ...fresh,
      cases: [
        { ...fresh.cases[0], status: 'success', attempts: 1 },
        { ...fresh.cases[1], status: 'running', attempts: 1 },
      ],
    })

    expect(resumed.cases.map((entry) => entry.status)).toEqual(['success', 'pending'])
    expect(resumed.cases.map((entry) => entry.recipeId)).toEqual([
      'image.multiview.custom',
      'portrait.refine',
    ])
    expect(resumed.providerCallsByModel).toEqual({})
  })

  it('redacts secrets recursively while retaining useful provider metadata', () => {
    const sanitized = sanitizeSmokeReport({
      provider: 'agnes',
      model: 'agnes-video-v2.0',
      apiKey: 'secret-key',
      nested: {
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        endpoint: 'https://example.test/run?token=secret&job=42',
      },
    })

    expect(sanitized).toEqual({
      provider: 'agnes',
      model: 'agnes-video-v2.0',
      apiKey: '[redacted]',
      nested: {
        authorization: '[redacted]',
        cookie: '[redacted]',
        endpoint: 'https://example.test/run?token=%5Bredacted%5D&job=42',
      },
    })
  })

  it('enforces current public Agnes cooldown floors while preserving stricter user settings', () => {
    expect(effectiveProviderCooldownMs(0, {
      vendorKey: 'agnes',
      modelKey: 'agnes-video-v2.0',
    })).toBe(60_000)
    expect(effectiveProviderCooldownMs(0, {
      vendorKey: 'agnes',
      modelKey: 'agnes-image-2.1-flash',
    })).toBe(6_000)
    expect(effectiveProviderCooldownMs(90_000, {
      vendorKey: 'agnes',
      modelKey: 'agnes-video-v2.0',
    })).toBe(90_000)
    expect(effectiveProviderCooldownMs(0, {
      vendorKey: 'kie',
      modelKey: 'seedance',
    })).toBe(0)
  })

  it('reports actionable missing-capability diagnostics for v2v and image-to-3D', () => {
    expect(describeMissingCompatibleModel('video.edit.look')).toMatchObject({
      code: 'missing_source_video_model',
      requiredCapability: 'source_video',
      candidateArchetypes: ['happyhorse'],
    })
    expect(describeMissingCompatibleModel('video.edit.effect')).toMatchObject({
      code: 'missing_source_video_model',
      requiredCapability: 'source_video',
      candidateArchetypes: ['happyhorse'],
    })
    expect(describeMissingCompatibleModel('video.edit.look').remediation).toContain('HappyHorse')
    expect(describeMissingCompatibleModel('image.multiview.reconstruct3d')).toMatchObject({
      code: 'missing_image_to_3d_model',
      requiredCapability: 'image_to_3d',
      candidateArchetypes: ['hunyuan3d', 'hitem3d', 'meshy6'],
    })
    expect(describeMissingCompatibleModel('portrait.refine', { filterMismatch: true })).toMatchObject({
      code: 'provider_model_filter_mismatch',
    })
  })

  it('clears stale failure state after a later attempt succeeds', () => {
    const caseState = {
      status: 'failed',
      error: 'network error',
      failureKind: 'network',
    }

    markSmokeCaseSucceeded(caseState)

    expect(caseState).toMatchObject({
      status: 'success',
      error: null,
      failureKind: null,
    })
  })

  it('requires manual review when semantic quality is warning or unavailable', () => {
    expect(smokeQualityDisposition(undefined)).toBe('accepted')
    expect(smokeQualityDisposition({ status: 'pass' })).toBe('accepted')
    expect(smokeQualityDisposition({ status: 'warning' })).toBe('manual_review')
    expect(smokeQualityDisposition({ status: 'unavailable' })).toBe('manual_review')
    expect(smokeQualityDisposition({ status: 'fail' })).toBe('failed')
  })

  it('extracts only finite safe phase timings, including Codex child timings', () => {
    expect(extractSmokePhaseTimings({
      id: 'output-1',
      result: {
        raw: {
          __nomi: {
            generationPhases: { resolveMs: 12, submitMs: 34, secret: 'ignore' },
          },
          codex: {
            timings: {
              queueMs: 7,
              referenceMs: 3,
              codexExecMs: 1200,
              attemptCount: 1,
              imagegenInvocationCount: 1,
              imagegenInvocationAudit: 'verified',
              cwd: '/private/tmp/secret',
              invalid: Number.NaN,
            },
          },
        },
      },
    })).toEqual({
      itemId: 'output-1',
      profileOperation: {},
      generationPhases: { resolveMs: 12, submitMs: 34 },
      codex: {
        queueMs: 7,
        referenceMs: 3,
        codexExecMs: 1200,
        attemptCount: 1,
        imagegenInvocationCount: 1,
        imagegenInvocationAudit: 'verified',
      },
    })
  })
})
