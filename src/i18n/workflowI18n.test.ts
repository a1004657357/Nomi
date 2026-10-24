import { afterEach, describe, expect, it } from 'vitest'
import i18n, { setAppLocale } from './index'
import { MANNEQUIN_POSE_PRESETS, MANNEQUIN_POSE_SECTIONS } from '../workbench/generationCanvas/nodes/scene3d/scene3dConstants'
import { makePropObject, PROP_SPECS } from '../workbench/generationCanvas/nodes/scene3d/scene3dPropSpecs'
import { capabilityRecipeInputReadiness } from '../workbench/generationCanvas/components/capabilityRecipeReadiness'
import { capabilityRecipeConnectionGuidance, moodRequestSummary } from '../workbench/generationCanvas/components/capabilityRecipeInspectorModel'
import { qualityLabel } from '../workbench/generationCanvas/nodes/capabilityQualityPresentation'
afterEach(() => setAppLocale('zh-CN'))
describe('workflow display text is bilingual without changing saved defaults', () => {
  it('changes pose/prop display labels on the current locale, not only on module import', async () => {
    await i18n.changeLanguage('en')
    expect(MANNEQUIN_POSE_PRESETS.find(p => p.id === 'standing')?.label).toBe('Standing')
    expect(MANNEQUIN_POSE_SECTIONS[0].title).toBe('Body')
    expect(PROP_SPECS.car.label).toBe('Car')
    expect(makePropObject('car').name).toBe('车辆')
    await i18n.changeLanguage('zh-CN')
    expect(MANNEQUIN_POSE_PRESETS.find(p => p.id === 'standing')?.label).toBe('站立')
    expect(PROP_SPECS.car.label).toBe('车辆')
    expect(makePropObject('car').name).toBe('车辆')
  })
  it('localizes readiness, connection guidance, summaries and quality presentation', async () => {
    await i18n.changeLanguage('en')
    expect(capabilityRecipeInputReadiness({ inputSlots: [] }, null, [])).toEqual({ ready: false, message: 'Select a source node first' })
    expect(capabilityRecipeConnectionGuidance('portrait.refine').title).toBe('Compatible model required')
    expect(moodRequestSummary('single')).toBe('1 separate request')
    expect(qualityLabel('pass')).toBe('Passed')
  })
})
