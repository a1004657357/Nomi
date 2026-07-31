import { describe, expect, it } from 'vitest'
import { nodeAllowsModelAutoSelect } from './useNodeModelAutoSelect'

describe('nodeAllowsModelAutoSelect', () => {
  it('prevents every automatic model reconciliation while a recipe pins its model', () => {
    expect(nodeAllowsModelAutoSelect({ modelAutoSelectDisabled: true })).toBe(false)
    expect(nodeAllowsModelAutoSelect({ modelAutoSelectDisabled: false })).toBe(true)
    expect(nodeAllowsModelAutoSelect({})).toBe(true)
  })
})
