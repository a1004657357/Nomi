import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL3D_CAMERA_STATE,
  MODEL3D_GRID9_CAMERA_PRESETS,
  cameraPositionFromState,
  cameraStateFromPosition,
  model3dGrid9CameraStates,
  model3dCaptureDimensions,
  normalizeModel3DCameraState,
} from './model3dCamera'

describe('model3d camera state', () => {
  it('normalizes persisted values into bounded camera controls', () => {
    expect(normalizeModel3DCameraState({
      version: 1,
      azimuth: 725,
      elevation: 120,
      distance: -2,
      fov: 4,
      target: [1, 'bad', 3],
    })).toEqual({
      version: 1,
      azimuth: 5,
      elevation: 89,
      distance: 0.01,
      fov: 10,
      target: [1, 0, 3],
    })
    expect(normalizeModel3DCameraState(undefined)).toBeNull()
  })

  it('uses zero azimuth as a camera on positive Z looking toward the target', () => {
    expect(cameraPositionFromState({
      ...DEFAULT_MODEL3D_CAMERA_STATE,
      azimuth: 0,
      elevation: 0,
      distance: 4,
      target: [1, 2, 3],
    })).toEqual([1, 2, 7])

    const right = cameraPositionFromState({
      ...DEFAULT_MODEL3D_CAMERA_STATE,
      azimuth: 90,
      elevation: 0,
      distance: 4,
      target: [0, 0, 0],
    })
    expect(right[0]).toBeCloseTo(4, 6)
    expect(right[1]).toBeCloseTo(0, 6)
    expect(right[2]).toBeCloseTo(0, 6)
  })

  it('round-trips an orbit camera through Cartesian position', () => {
    const source = {
      ...DEFAULT_MODEL3D_CAMERA_STATE,
      azimuth: -135,
      elevation: 28,
      distance: 7.5,
      fov: 52,
      target: [0.5, 1.25, -2] as [number, number, number],
    }
    const restored = cameraStateFromPosition({
      position: cameraPositionFromState(source),
      target: source.target,
      fov: source.fov,
    })
    expect(restored.azimuth).toBeCloseTo(source.azimuth, 6)
    expect(restored.elevation).toBeCloseTo(source.elevation, 6)
    expect(restored.distance).toBeCloseTo(source.distance, 6)
    expect(restored.target).toEqual(source.target)
    expect(restored.fov).toBe(source.fov)
  })

  it('derives even render dimensions from the selected framing ratio', () => {
    expect(model3dCaptureDimensions('16:9', 1920)).toEqual({ width: 1920, height: 1080 })
    expect(model3dCaptureDimensions('9:16', 2048)).toEqual({ width: 1152, height: 2048 })
    expect(model3dCaptureDimensions('1:1', 1024)).toEqual({ width: 1024, height: 1024 })
  })

  it('builds nine deterministic camera guides while preserving framing', () => {
    const base = {
      ...DEFAULT_MODEL3D_CAMERA_STATE,
      distance: 8,
      fov: 52,
      target: [1, 2, 3] as [number, number, number],
    }
    const guides = model3dGrid9CameraStates(base)

    expect(MODEL3D_GRID9_CAMERA_PRESETS).toHaveLength(9)
    expect(guides.map((guide) => guide.id)).toEqual([
      'front',
      'front-right',
      'right',
      'rear-right',
      'rear',
      'rear-left',
      'left',
      'front-left',
      'top',
    ])
    expect(guides.map((guide) => [guide.camera.azimuth, guide.camera.elevation])).toEqual([
      [0, 0],
      [45, 0],
      [90, 0],
      [135, 0],
      [180, 0],
      [-135, 0],
      [-90, 0],
      [-45, 0],
      [0, 75],
    ])
    expect(guides.every((guide) => (
      guide.camera.distance === 8
      && guide.camera.fov === 52
      && guide.camera.target.join(',') === '1,2,3'
    ))).toBe(true)
  })
})
