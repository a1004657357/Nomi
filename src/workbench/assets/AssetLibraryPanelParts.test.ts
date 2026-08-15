import { describe, expect, it } from 'vitest'
import { isAssetGridActivationKey } from './assetLibraryUsage'

describe('AssetGridCell keyboard contract', () => {
  it('activates on Enter or Space and ignores navigation keys', () => {
    expect(isAssetGridActivationKey('Enter')).toBe(true)
    expect(isAssetGridActivationKey(' ')).toBe(true)
    expect(isAssetGridActivationKey('ArrowDown')).toBe(false)
  })
})
