import { describe, expect, it } from 'vitest'
import { resolveCapabilityRecipesEnabled } from './featureFlags'

describe('resolveCapabilityRecipesEnabled', () => {
  it('keeps packaged production disabled by default', () => {
    expect(resolveCapabilityRecipesEnabled({})).toBe(false)
  })

  it('enables source checkout and development runtimes by default', () => {
    expect(resolveCapabilityRecipesEnabled({ sourceRun: true })).toBe(true)
    expect(resolveCapabilityRecipesEnabled({ dev: true })).toBe(true)
  })

  it('lets the local override disable a source checkout', () => {
    expect(resolveCapabilityRecipesEnabled({ localValue: '0', sourceRun: true })).toBe(false)
  })

  it('lets explicit build values override every runtime default', () => {
    expect(resolveCapabilityRecipesEnabled({ buildValue: '0', localValue: '1', sourceRun: true, dev: true })).toBe(false)
    expect(resolveCapabilityRecipesEnabled({ buildValue: '1', localValue: '0' })).toBe(true)
  })
})
