import { describe, expect, it } from 'vitest'
import { modelNormalizationFromBounds, staticObjectVisualKind } from './scene3dObjects'

describe('modelNormalizationFromBounds', () => {
  it('centers and grounds a generated model at a stable two-unit size', () => {
    expect(modelNormalizationFromBounds(
      { x: -1, y: -2, z: -3 },
      { x: 3, y: 2, z: 1 },
    )).toEqual({
      offset: [-1, 2, 1],
      scale: 0.5,
    })
  })
})

describe('staticObjectVisualKind', () => {
  it('routes a model object with a URL to the GLB renderer', () => {
    expect(staticObjectVisualKind({
      id: 'model-1',
      name: 'Generated model',
      type: 'model',
      visible: true,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      modelUrl: 'nomi-local://asset/p/model.glb',
    })).toBe('model')
  })
})
