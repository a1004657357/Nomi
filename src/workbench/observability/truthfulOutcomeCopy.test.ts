import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { translateCanvasComponentText } from '../../i18n/CanvasComponentText'
import { generationModeRationale } from '../../../electron/shared/canvas/sourceDefaults'
import { narrateGenerationError } from './narrate'

describe('outcome copy describes known request state without billing promises', () => {
  it.each(['zh-CN', 'en'] as const)('%s keeps confirmation facts and next steps without rewriting stored rationale', async (language) => {
    const previous = i18n.language
    const raw = Object.freeze({ rationale: generationModeRationale('text-to-image'), prompt: 'Original user prompt', userFlag: false })
    const original = JSON.stringify(raw)
    try {
      await i18n.changeLanguage(language)
      const confirmation = i18n.t('canvasComponents.inParallelNoRequestsOrChargesBeforeConfirmation')
      expect(confirmation).toBe(language === 'en' ? ' in parallel; no requests before confirmation' : ' 个并行,确认前不调用')
      expect(confirmation).not.toMatch(/扣费|charge/i)
      const network = narrateGenerationError('network')
      expect(network.hint).toMatch(language === 'en' ? /network|proxy/i : /网络|代理/)
      expect(network.hint).not.toMatch(/扣费|charged|charge again/i)
      expect(i18n.t('generationCommon.observability.error.network.reason')).toBe(network.reason)
      const rationale = translateCanvasComponentText(raw.rationale)
      expect(rationale).toBe(language === 'en' ? 'No existing visual assets; unrestricted composition with text-to-image' : raw.rationale)
      expect(JSON.stringify(raw)).toBe(original)
    } finally { await i18n.changeLanguage(previous) }
  })
})
