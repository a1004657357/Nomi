import { describe, expect, it } from 'vitest'
import * as assets from '../director/scene/character/mannequinAssets'
import { MANNEQUIN_ANIMATION_URL, MANNEQUIN_MODEL_URL } from './scene3dConstants'
import { UE4_MANNEQUIN_MODEL_URL } from './ueSpike/ue4MannequinRig'

describe('mannequin bundle URLs use the existing render-only owner', () => {
  it('keeps the Nomi model at the same asset and shares the canonical value', () => {
    expect(MANNEQUIN_MODEL_URL).toBe(assets.MANNEQUIN_MODEL_URL)
    expect(MANNEQUIN_MODEL_URL).toBe(new URL('../../../../assets/nomi-mannequin.glb', import.meta.url).href)
  })

  it('keeps locomotion animations separate and shares the canonical value', () => {
    expect(MANNEQUIN_ANIMATION_URL).toBe(assets.MANNEQUIN_ANIMATION_URL)
    expect(MANNEQUIN_ANIMATION_URL).toBe(new URL('../../../../assets/nomi-mannequin-animations.glb', import.meta.url).href)
    expect(MANNEQUIN_ANIMATION_URL).not.toBe(MANNEQUIN_MODEL_URL)
  })

  it('retains the UE4 rig asset instead of replacing its model with Nomi', () => {
    expect(UE4_MANNEQUIN_MODEL_URL).toBe(assets.UE4_MANNEQUIN_MODEL_URL)
    expect(UE4_MANNEQUIN_MODEL_URL).toBe(new URL('../../../../assets/ue-mannequin-retopology.glb', import.meta.url).href)
    expect(UE4_MANNEQUIN_MODEL_URL).not.toBe(MANNEQUIN_MODEL_URL)
  })
})
