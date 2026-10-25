import { describe, expect, it } from 'vitest'
import { onboardingVendorIsUsable } from './onboardingVendorAvailability'

describe('onboardingVendorIsUsable', () => {
  it('treats enabled no-auth local providers such as Codex as usable', () => {
    expect(onboardingVendorIsUsable({ enabled: true, authType: 'none', hasApiKey: false })).toBe(true)
  })

  it('still requires an API key for keyed providers', () => {
    expect(onboardingVendorIsUsable({ enabled: true, authType: 'bearer', hasApiKey: false })).toBe(false)
    expect(onboardingVendorIsUsable({ enabled: true, authType: 'bearer', hasApiKey: true })).toBe(true)
  })

  it('rejects disabled providers regardless of authentication type', () => {
    expect(onboardingVendorIsUsable({ enabled: false, authType: 'none', hasApiKey: false })).toBe(false)
  })
})
