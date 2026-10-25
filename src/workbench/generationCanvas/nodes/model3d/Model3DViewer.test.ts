import { describe, expect, it } from 'vitest'
import { orbitDistanceLimitsForRadius, shouldAutoFitModelCamera } from './Model3DViewer'
import { DEFAULT_MODEL3D_CAMERA_STATE } from './model3dCamera'

describe('orbitDistanceLimitsForRadius', () => {
  it('scales camera limits with the imported model instead of using fixed world units', () => {
    expect(orbitDistanceLimitsForRadius(100)).toEqual({
      minDistance: 5,
      maxDistance: 2000,
    })
    expect(orbitDistanceLimitsForRadius(0.25)).toEqual({
      minDistance: 0.0125,
      maxDistance: 5,
    })
  })

  it('keeps controls unbounded until a valid model radius is available', () => {
    expect(orbitDistanceLimitsForRadius(undefined)).toEqual({
      minDistance: 0,
      maxDistance: Number.POSITIVE_INFINITY,
    })
    expect(orbitDistanceLimitsForRadius(Number.NaN)).toEqual({
      minDistance: 0,
      maxDistance: Number.POSITIVE_INFINITY,
    })
  })

  it('does not let Bounds overwrite a persisted camera on reload', () => {
    expect(shouldAutoFitModelCamera(null)).toBe(true)
    expect(shouldAutoFitModelCamera(DEFAULT_MODEL3D_CAMERA_STATE)).toBe(false)
  })
})
