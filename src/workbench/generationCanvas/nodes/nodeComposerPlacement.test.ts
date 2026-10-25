import { describe, expect, it } from 'vitest'
import { resolveFloatingComposerPlacement } from './nodeComposerPlacement'

describe('resolveFloatingComposerPlacement', () => {
  it('stays below and clamps height when neither side fits and the toolbar makes above tighter', () => {
    expect(resolveFloatingComposerPlacement({
      previousFlipUp: false,
      naturalHeight: 460,
      configuredMaxHeight: 460,
      spaceAbove: 295,
      spaceBelow: 295,
      gapScreen: 4,
      aboveObstructionScreen: 48,
    })).toEqual({ flipUp: false, maxHeight: 279 })
  })

  it('flips above near the stage bottom and reserves toolbar clearance', () => {
    expect(resolveFloatingComposerPlacement({
      previousFlipUp: false,
      naturalHeight: 400,
      configuredMaxHeight: 400,
      spaceAbove: 560,
      spaceBelow: 80,
      gapScreen: 5,
      aboveObstructionScreen: 50,
    })).toEqual({ flipUp: true, maxHeight: 400 })
  })

  it('keeps the existing upward placement until below has a hysteresis margin', () => {
    expect(resolveFloatingComposerPlacement({
      previousFlipUp: true,
      naturalHeight: 300,
      configuredMaxHeight: 400,
      spaceAbove: 360,
      spaceBelow: 330,
      gapScreen: 4,
      aboveObstructionScreen: 0,
    }).flipUp).toBe(true)

    expect(resolveFloatingComposerPlacement({
      previousFlipUp: true,
      naturalHeight: 300,
      configuredMaxHeight: 400,
      spaceAbove: 360,
      spaceBelow: 380,
      gapScreen: 4,
      aboveObstructionScreen: 0,
    }).flipUp).toBe(false)
  })
})
