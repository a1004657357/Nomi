import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES, getArchetypeById, type ModelArchetype } from '../../../../config/modelArchetypes'
import { AGNES_VIDEO_25_FLASH_ARCHETYPE } from '../../../../config/modelArchetypes/agnesVideo25Flash'
import { AGNES_VIDEO_25_FLASH_ARCHETYPE as SHARED_FLASH } from '../../../../../electron/shared/videoCapabilities/agnesVideo25'
import { applyArchetypeModeSwitch, applyArchetypeVariantSwitch, archetypeVariantChoices, buildArchetypeInputParams, currentArchetypeMode, currentArchetypeVariant, ensureArchetypeNodeMeta } from './archetypeMeta'

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
})
