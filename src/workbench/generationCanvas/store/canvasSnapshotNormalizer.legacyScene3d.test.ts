import { describe, expect, it } from 'vitest'
import { normalizeStoreSnapshot } from './canvasSnapshotNormalizer'

// The customized scene3d editor owns Blender state; the official director is a separate node kind.
describe('normalizeStoreSnapshot — preserve customized scene3d nodes', () => {
  it('preserves scene3d state, capture flags and Blender metadata without a lossy director migration', () => {
    const snap = normalizeStoreSnapshot({
      nodes: [{
        id: 'legacy-1',
        kind: 'scene3d',
        title: '站位参考',
        position: { x: 10, y: 20 },
        status: 'idle',
        meta: {
          scene3dState: {
            objects: [{ id: 'm', name: '主角', type: 'mannequin', visible: true, position: [0, 1.25, 0], rotation: [0, 0, 0], scale: [2.5, 2.5, 2.5] }],
            cameras: [{ id: 'c', name: '机位', visible: true, position: [0, 1.5, 5], rotation: [0, 0, 0], target: [0, 1.3, 0], fov: 40, aspectRatio: '16:9', lensDepth: 0 }],
          },
          stagingAutoCapture: { targetNodeId: 'shot-1' },
          blenderSceneFile: '/local-fixture/scene.blend',
        },
      }],
    })
    expect(snap.nodes).toHaveLength(1)
    const node = snap.nodes[0]
    expect(node.kind).toBe('scene3d')
    expect(node.title).toBe('站位参考')
    expect(node.position).toEqual({ x: 10, y: 20 })
    expect(node.meta?.directorProject).toBeUndefined()
    const scene = node.meta?.scene3dState as { objects: unknown[]; cameras: unknown[] }
    expect(scene.objects).toHaveLength(1)
    expect(scene.cameras).toHaveLength(1)
    expect(node.meta?.blenderSceneFile).toBe('/local-fixture/scene.blend')
    expect(node.meta?.stagingAutoCapture).toEqual({ targetNodeId: 'shot-1' })
  })

  it('retains an empty customized scene3d node for its own editor to initialize', () => {
    const snap = normalizeStoreSnapshot({ nodes: [{ id: 'legacy-2', kind: 'scene3d', title: '3D', position: { x: 0, y: 0 } }] })
    expect(snap.nodes[0].kind).toBe('scene3d')
    expect(snap.nodes[0].meta?.directorProject).toBeUndefined()
  })

  it('keeps official director nodes separate and preserves their project payload', () => {
    const directorProject = { id: 'official-director', scenes: [] }
    const snap = normalizeStoreSnapshot({ nodes: [{ id: 'director-1', kind: 'director', position: { x: 0, y: 0 }, meta: { directorProject } }] })
    expect(snap.nodes[0].kind).toBe('director')
    expect(snap.nodes[0].meta?.directorProject).toEqual(directorProject)
    expect(snap.nodes[0].meta?.scene3dState).toBeUndefined()
  })
})
