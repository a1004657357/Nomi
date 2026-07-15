const VIEWPORT_MARGIN = 12
const MIN_COMPOSER_HEIGHT = 150

type FloatingComposerPlacementInput = {
  previousFlipUp: boolean
  naturalHeight: number
  configuredMaxHeight: number
  spaceAbove: number
  spaceBelow: number
  gapScreen: number
  aboveObstructionScreen: number
  hysteresis?: number
}

export type FloatingComposerPlacement = {
  flipUp: boolean
  maxHeight: number
}

export function resolveFloatingComposerPlacement(
  input: FloatingComposerPlacementInput,
): FloatingComposerPlacement {
  const hysteresis = input.hysteresis ?? 48
  const preferredHeight = Math.min(
    input.configuredMaxHeight,
    Math.max(MIN_COMPOSER_HEIGHT, input.naturalHeight),
  )
  const availableBelow = Math.max(0, input.spaceBelow - input.gapScreen - VIEWPORT_MARGIN)
  const availableAbove = Math.max(
    0,
    input.spaceAbove - input.gapScreen - input.aboveObstructionScreen - VIEWPORT_MARGIN,
  )

  let flipUp = input.previousFlipUp
  if (flipUp) {
    if (availableBelow >= preferredHeight + hysteresis) flipUp = false
    else if (availableAbove < MIN_COMPOSER_HEIGHT && availableBelow > availableAbove) flipUp = false
  } else if (availableBelow < preferredHeight && availableAbove > availableBelow) {
    flipUp = true
  }

  const available = flipUp ? availableAbove : availableBelow
  const minHeight = Math.min(MIN_COMPOSER_HEIGHT, preferredHeight)
  return {
    flipUp,
    maxHeight: Math.round(Math.max(minHeight, Math.min(preferredHeight, available))),
  }
}
