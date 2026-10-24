import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES, archetypeBaseModelKey, getArchetypeById, resolveArchetypeVariant, specializeArchetypeForVariant, type ModelArchetype } from '../../../../../electron/shared/modelArchetypes'
import { compileExecutionContract, type PlanCandidate } from '../../../../../electron/capabilityCore/executionContract'
import { archetypeCompileOptions } from '../../../../../electron/capabilityCore/modelAdmissionSchema'
import { createModuleRegistry } from '../../../../../electron/capabilityCore/moduleRegistry'
import { AGNES_VIDEO_25_FLASH_ARCHETYPE } from '../../../../../electron/shared/videoCapabilities/agnesVideo25'
import { AGNES_VIDEO_25_FLASH_ARCHETYPE as SHARED_FLASH } from '../../../../../electron/shared/videoCapabilities/agnesVideo25'
import { applyArchetypeModeSwitch, applyArchetypeVariantSwitch, archetypeVariantChoices, buildArchetypeInputParams, currentArchetypeMode, currentArchetypeVariant, ensureArchetypeNodeMeta, normalizeArchetypeVariantMeta } from './archetypeMeta'

describe('single Flash archetype with legacy node compatibility', () => {
  const flash = getArchetypeById('agnes-video-2.5-flash')!

  it('registers the shared definition exactly once, including the old import path', () => {
    expect(flash).toBe(AGNES_VIDEO_25_FLASH_ARCHETYPE)
    expect(flash).toBe(SHARED_FLASH)
    expect(MODEL_ARCHETYPES.filter((model) => model.id === flash.id)).toHaveLength(1)
    expect(new Set(MODEL_ARCHETYPES.map((model) => model.id)).size).toBe(MODEL_ARCHETYPES.length)
  })

  it.each([['t2v', 'text'], ['firstlast', 'keyframe'], ['keyframe', 'keyframe'], ['reference', 'reference']])('migrates %s to %s without clearing stored references', (oldMode, nextMode) => {
    const meta = { archetype: { id: flash.id, modeId: oldMode }, firstFrameUrl: 'first.png', lastFrameUrl: 'last.png', referenceImageUrls: ['image.png'], referenceAudioUrls: ['audio.mp3'] }
    expect(currentArchetypeMode(flash, meta).id).toBe(nextMode)
    const migrated = ensureArchetypeNodeMeta(meta, flash) ?? meta
    expect(migrated).toMatchObject({ ...meta, archetype: { id: flash.id, modeId: nextMode } })
    expect(ensureArchetypeNodeMeta(migrated, flash)).toBeNull()
    const input = buildArchetypeInputParams(migrated, flash)
    if (nextMode === 'keyframe') expect(input).toEqual({ first_frame: 'first.png', last_frame: 'last.png' })
    if (nextMode === 'reference') expect(input).toEqual({ images: ['image.png'], audios: ['audio.mp3'] })
    if (nextMode === 'text') expect(input).toEqual({})
  })
})

describe('mode-scoped variants survive upstream parameter clamping', () => {
  const archetype: ModelArchetype = {
    id: 'fixture', label: 'Fixture', kind: 'video', family: 'fixture', identifierPatterns: ['fixture'], defaultModeId: 'text', transportTaskKind: 'text_to_video',
    modes: ['text', 'media'].map((id) => ({ id, intent: 'text', vendorTerm: id, hint: '', promptRequired: true, slots: [], params: [{ key: 'size', label: 'Size', type: 'select', options: [{ value: '720p', label: '720p' }, { value: '4k', label: '4k' }], defaultValue: '720p' }] })),
    variants: [
      { id: 'fast', label: 'Fast', modelKey: 'fast', supportedModeIds: ['text'] },
      { id: 'standard', label: 'Standard', modelKey: 'standard', paramOverrides: { media: (params) => params.map((param) => ({ ...param, options: [{ value: '720p', label: '720p' }] })) } },
    ],
    defaultVariantId: 'fast', variantIdAliases: { legacy: 'standard' },
  }

  it('switching modes chooses a supported variant and clamps its narrowed controls', () => {
    const next = applyArchetypeModeSwitch({ archetype: { id: archetype.id, modeId: 'text', variantId: 'fast' }, size: '4k', firstFrameUrl: 'frame.png' }, archetype, 'media')
    expect(next).toMatchObject({ archetype: { modeId: 'media', variantId: 'standard' }, size: '720p', firstFrameUrl: 'frame.png' })
    expect(currentArchetypeVariant(archetype, next)?.id).toBe('standard')
    expect(archetypeVariantChoices(archetype, 'media')).toEqual([])
    expect(ensureArchetypeNodeMeta(next, archetype)).toBeNull()
  })

  it('legacy variant aliases remain valid but cannot select an unsupported variant', () => {
    const meta = { archetype: { id: archetype.id, modeId: 'media', variantId: 'legacy' }, size: '4k' }
    expect(currentArchetypeVariant(archetype, meta)?.id).toBe('standard')
    expect(applyArchetypeVariantSwitch(meta, archetype, 'fast')).toMatchObject({ archetype: { variantId: 'standard' }, size: '720p' })
    expect(ensureArchetypeNodeMeta(meta, archetype)).toMatchObject({ archetype: { variantId: 'standard' }, size: '720p' })
  })

  it.each(['fixture', 'fixture-legacy'])('%s profile identity preserves the explicit compatible variant over a conflicting model key', (storedId) => {
    const legacyProfile = { ...archetype, legacyIds: ['fixture-legacy'] }
    const meta = Object.freeze({
      modelKey: 'standard',
      archetype: Object.freeze({ id: storedId, modeId: 'text', variantId: 'fast' }),
      referenceImageUrls: Object.freeze(['second.png', 'first.png']),
      userSettings: Object.freeze({ note: 'keep user text', enabled: false }),
      size: '4k',
    })
    const before = JSON.stringify(meta)
    expect(currentArchetypeVariant(legacyProfile, meta)?.id).toBe('fast')
    const switched = applyArchetypeModeSwitch(meta, legacyProfile, 'text')
    const ensured = ensureArchetypeNodeMeta(meta, legacyProfile) ?? meta
    const patch = normalizeArchetypeVariantMeta(meta, legacyProfile)!
    for (const next of [switched, ensured, { ...meta, ...patch }]) {
      expect(next.archetype).toEqual({ id: archetype.id, modeId: 'text', variantId: 'fast' })
      expect(next.referenceImageUrls).toBe(meta.referenceImageUrls)
      expect(next.userSettings).toBe(meta.userSettings)
      expect(next.size).toBe('4k')
      expect(buildArchetypeInputParams(next, legacyProfile).model).toBe('fast')
      expect(ensureArchetypeNodeMeta(next, legacyProfile)).toBeNull()
    }
    expect(patch.modelKey).toBe('fast')
    expect(applyArchetypeVariantSwitch(meta, legacyProfile, 'fast').archetype)
      .toEqual({ id: archetype.id, modeId: 'text', variantId: 'fast' })
    expect(JSON.stringify(meta)).toBe(before)
  })

  it('canonicalizes a compatible variant alias without changing reference storage or user meta', () => {
    const meta = Object.freeze({
      modelKey: 'fast',
      archetype: Object.freeze({ id: archetype.id, modeId: 'media', variantId: 'legacy' }),
      size: '4k',
      firstFrameUrl: 'first.png',
      lastFrameUrl: 'last.png',
      referenceVideoUrls: Object.freeze(['clip.mp4']),
      userSettings: Object.freeze({ zero: 0, note: 'not a prompt rewrite' }),
    })
    const patch = normalizeArchetypeVariantMeta(meta, archetype)!
    const next = { ...meta, ...patch }
    expect(next.archetype).toEqual({ id: archetype.id, modeId: 'media', variantId: 'standard' })
    expect(next.size).toBe('720p')
    expect(meta.size).toBe('4k')
    expect(next.referenceVideoUrls).toBe(meta.referenceVideoUrls)
    expect(next.userSettings).toBe(meta.userSettings)
    expect(next.firstFrameUrl).toBe(meta.firstFrameUrl)
    expect(next.lastFrameUrl).toBe(meta.lastFrameUrl)
    expect(buildArchetypeInputParams(next, archetype).model).toBe('standard')
    expect(normalizeArchetypeVariantMeta(next, archetype)).toBeNull()
  })

  it('does not invent a variant or switch into a mode with no compatible candidates', () => {
    const textOnly = { ...archetype, legacyIds: ['fixture-legacy'], variants: [archetype.variants![0]] }
    const meta = { archetype: { id: archetype.id, modeId: 'text', variantId: 'fast' }, size: '4k' }
    expect(applyArchetypeModeSwitch(meta, textOnly, 'media')).toBe(meta)
    const invalid = { ...meta, archetype: { ...meta.archetype, modeId: 'media' } }
    expect(currentArchetypeVariant(textOnly, invalid)).toBeNull()
    expect(applyArchetypeVariantSwitch(invalid, textOnly, 'fast')).toBe(invalid)
    expect(ensureArchetypeNodeMeta(invalid, textOnly)).toBeNull()
    expect(ensureArchetypeNodeMeta({ ...invalid, archetype: { ...invalid.archetype, id: 'fixture-legacy' } }, textOnly)).toBeNull()
    expect(ensureArchetypeNodeMeta({ ...invalid, archetype: { ...invalid.archetype, modeId: 'unknown' } }, { ...textOnly, defaultModeId: 'media' })).toBeNull()
  })

  it('keeps original catalog base identity when the default variant is filtered out', () => {
    const scoped: ModelArchetype = {
      ...archetype,
      variants: [
        archetype.variants![0],
        { id: 'economy', label: 'Economy', modelKey: 'economy', supportedModeIds: ['media'] },
        { ...archetype.variants![1], identifierPatterns: ['fast'] },
      ],
    }
    const meta = { modelKey: 'fast', archetype: { id: scoped.id, modeId: 'media' } }
    expect(currentArchetypeVariant(scoped, meta)?.id).toBe('economy')
    const next = applyArchetypeModeSwitch({ ...meta, archetype: { ...meta.archetype, modeId: 'text', variantId: 'fast' } }, scoped, 'media')
    expect(next.archetype).toEqual({ id: scoped.id, modeId: 'media', variantId: 'economy' })
    expect(buildArchetypeInputParams(next, scoped).model).toBe('economy')
  })

  it('normalization removes an out-of-range scalar with no declared default using the existing patch merge', () => {
    const noDefault: ModelArchetype = {
      ...archetype,
      variants: [{
        ...archetype.variants![1],
        paramOverrides: { media: (params) => params.map((param) => ({ ...param, options: [{ value: '720p', label: '720p' }], defaultValue: undefined })) },
      }],
    }
    const meta = { modelKey: 'standard', archetype: { id: noDefault.id, modeId: 'media', variantId: 'legacy' }, size: '4k', userNote: 'keep' }
    const patch = normalizeArchetypeVariantMeta(meta, noDefault)!
    expect(patch).toHaveProperty('size', undefined)
    const next = { ...meta, ...patch }
    expect(next.size).toBeUndefined()
    expect(JSON.parse(JSON.stringify(next))).not.toHaveProperty('size')
    expect(next.userNote).toBe(meta.userNote)
    expect(meta.size).toBe('4k')
  })
})

describe('real Jimeng renderer / shared / host identity agreement', () => {
  const jimeng = getArchetypeById('jimeng-web-image')!
  const baseModelKey = archetypeBaseModelKey(jimeng)!
  const registry = createModuleRegistry([{
    moduleId: 'generation.single-shot', version: '1.0.0', inputKinds: ['text', 'image'], outputKinds: ['image'],
    modes: ['text_to_image', 'image_edit'], parameterSchema: {}, assetInputSchema: { references: { kind: 'asset', max: 10 } },
    providers: [{ providerId: 'jimeng-web', models: [{ modelId: baseModelKey, modes: ['text_to_image', 'image_edit'], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
  }])

  function expectHostAgreement(meta: Record<string, unknown>, expectedId: string) {
    const variant = currentArchetypeVariant(jimeng, meta)!
    const mode = currentArchetypeMode(jimeng, meta)
    const input = buildArchetypeInputParams(meta, jimeng)
    expect(variant.id).toBe(expectedId)
    expect(input.model).toBe(variant.modelKey)
    const candidate: PlanCandidate = {
      candidateId: 'mode-variant-regression', revision: 1, moduleId: 'generation.single-shot',
      providerId: 'jimeng-web', modelId: baseModelKey, modeId: mode.id,
      mode: mode.transportTaskKind!, variantId: expectedId, transportModelId: String(input.model),
      prompt: 'keep this user prompt', references: [],
      parameters: { ratio: meta.ratio, resolution_type: meta.resolution_type, generation_count: 1 },
    }
    const rawCandidate = JSON.stringify(candidate)
    const hostVariant = resolveArchetypeVariant(jimeng, { variantId: candidate.variantId, modelId: candidate.modelId })
    const options = archetypeCompileOptions(candidate, { meta: { archetypeId: jimeng.id } })
    expect(options.parameterSchema).toHaveProperty('resolution_type')
    const controls = currentArchetypeMode(specializeArchetypeForVariant(jimeng, expectedId), meta).params
    expect(options.parameterSchema?.resolution_type.enum).toEqual(controls.find((control) => control.key === 'resolution_type')!.options.map((option) => option.value))
    expect(options.allowedVariantIds).toContain(expectedId)
    const contract = compileExecutionContract(candidate, registry, options)
    expect(hostVariant?.id).toBe(expectedId)
    expect(contract.variantId).toBe(expectedId)
    expect(contract.transportModelId).toBe(hostVariant?.modelKey)
    expect(contract.parameters).toEqual(candidate.parameters)
    expect(contract.prompt).toBe(candidate.prompt)
    expect(JSON.stringify(candidate)).toBe(rawCandidate)
  }

  it.each([
    ['v3_0', 't2i'], ['v4_7', 'edit'], ['v5_0_lite', 'edit'],
  ])('retains compatible explicit %s through switching, normalization and pure host admission', (variantId, modeId) => {
    const meta = {
      modelKey: baseModelKey, archetype: { id: jimeng.id, modeId: 't2i', variantId },
      ratio: '1:1', resolution_type: '2K', referenceImageUrls: ['keep.png'], userNote: 'same text',
    }
    const next = applyArchetypeModeSwitch(meta, jimeng, modeId)
    expect(next.archetype).toEqual({ id: jimeng.id, modeId, variantId })
    expect(next.referenceImageUrls).toBe(meta.referenceImageUrls)
    expect(next.userNote).toBe(meta.userNote)
    expect(normalizeArchetypeVariantMeta(next, jimeng)).toBeNull()
    expectHostAgreement(applyArchetypeVariantSwitch(next, jimeng, variantId), variantId)
  })

  it.each(['ensure', 'normalize'])('%s reconciles a stored incompatible canonical variant before sending, without mutating user meta', (path) => {
    const meta = Object.freeze({
      modelKey: 'jimeng-image-3.0',
      archetype: Object.freeze({ id: jimeng.id, modeId: 'edit', variantId: 'v3_0' }),
      ratio: '1:1', resolution_type: '1K', firstFrameUrl: 'first.png', lastFrameUrl: 'last.png',
      referenceImageUrls: Object.freeze(['second.png', 'first.png']),
      referenceAudioUrls: Object.freeze(['audio.mp3']),
      userSettings: Object.freeze({ note: 'user original', disabled: false, index: 0 }),
    })
    const before = JSON.stringify(meta)
    const next = path === 'ensure' ? ensureArchetypeNodeMeta(meta, jimeng)! : { ...meta, ...normalizeArchetypeVariantMeta(meta, jimeng)! }
    expect(next.archetype).toEqual({ id: jimeng.id, modeId: 'edit', variantId: 'v5_0_pro' })
    expect(next.referenceImageUrls).toBe(meta.referenceImageUrls)
    expect(next.referenceAudioUrls).toBe(meta.referenceAudioUrls)
    expect(next.userSettings).toBe(meta.userSettings)
    expect(next.firstFrameUrl).toBe(meta.firstFrameUrl)
    expect(next.lastFrameUrl).toBe(meta.lastFrameUrl)
    expect(buildArchetypeInputParams(next, jimeng)).toMatchObject({ input_images: [...meta.referenceImageUrls], model: 'jimeng-image-5.0-pro' })
    expect(ensureArchetypeNodeMeta(next, jimeng)).toBeNull()
    expectHostAgreement(next, 'v5_0_pro')
    expect(JSON.stringify(meta)).toBe(before)
  })
})
