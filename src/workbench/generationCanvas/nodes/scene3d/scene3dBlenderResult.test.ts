import { describe, expect, it } from 'vitest'
import {
  blenderOutputCategoryId,
  buildBlenderOutputNodeSpecs,
  shouldApplyBlenderResult,
} from './scene3dBlenderResult'

describe('scene3d Blender result nodes', () => {
  it('builds a preview image node and a GLB model node beside the source scene', () => {
    const specs = buildBlenderOutputNodeSpecs({
      sourceNodeId: 'scene-1',
      sourcePosition: { x: 100, y: 200 },
      sourceWidth: 480,
      result: {
        jobId: 'job-1',
        blenderVersion: '4.0.1',
        preview: { url: 'nomi-local://asset/p/preview.png', assetId: 'preview-asset' },
        blend: { url: 'nomi-local://asset/p/scene.blend', assetId: 'blend-asset' },
        model: { url: 'nomi-local://asset/p/scene.glb', assetId: 'model-asset' },
      },
    })

    expect(specs).toHaveLength(2)
    expect(specs[0]).toMatchObject({
      kind: 'image',
      title: 'Blender 场景预览',
      result: { type: 'image', url: 'nomi-local://asset/p/preview.png' },
      meta: { sourceNodeId: 'scene-1', blenderJobId: 'job-1' },
    })
    expect(specs[1]).toMatchObject({
      kind: 'model3d',
      title: 'Blender 场景模型',
      result: { type: 'model3d', url: 'nomi-local://asset/p/scene.glb' },
      meta: { blenderBlendUrl: 'nomi-local://asset/p/scene.blend' },
    })
    expect(specs[0].position.x).toBeGreaterThan(480)
    expect(specs[1].position.y).toBeGreaterThan(specs[0].position.y)
  })

  it('offsets later render versions instead of stacking them', () => {
    const common = {
      sourceNodeId: 'scene-1',
      sourcePosition: { x: 100, y: 200 },
      sourceWidth: 480,
      result: {
        jobId: 'job-2',
        preview: { url: 'preview' },
        blend: { url: 'blend' },
        model: { url: 'model' },
      },
    }
    const first = buildBlenderOutputNodeSpecs(common)
    const second = buildBlenderOutputNodeSpecs({ ...common, runIndex: 1 })
    expect(second[0].position.x).toBeGreaterThan(first[0].position.x)
    expect(second[1].position.x).toBeGreaterThan(first[1].position.x)
  })

  it('labels manifest-driven output as a director preview without changing the asset contract', () => {
    const specs = buildBlenderOutputNodeSpecs({
      sourceNodeId: 'scene-1',
      sourcePosition: { x: 0, y: 0 },
      sourceWidth: 480,
      source: 'blender-director',
      result: {
        jobId: 'director-job',
        preview: { url: 'preview' },
        blend: { url: 'blend' },
        model: { url: 'model' },
      },
    })

    expect(specs[0]).toMatchObject({ title: 'Blender 导演预演', meta: { source: 'blender-director' } })
    expect(specs[1]).toMatchObject({ title: 'Blender 导演场景', meta: { source: 'blender-director' } })
  })

  it('keeps legacy nodes in the shots category and blocks cross-project result writes', () => {
    expect(blenderOutputCategoryId(undefined)).toBe('shots')
    expect(blenderOutputCategoryId('scene')).toBe('scene')
    expect(shouldApplyBlenderResult('project-a', 'project-a', true)).toBe(true)
    expect(shouldApplyBlenderResult('project-a', 'project-b', true)).toBe(false)
    expect(shouldApplyBlenderResult('project-a', 'project-a', false)).toBe(false)
  })
})
