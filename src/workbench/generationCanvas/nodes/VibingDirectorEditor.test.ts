import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  createVibingDirectorPreviewResult,
  readVibingDirectorState,
} from './VibingDirectorEditor'
import { createVibingDirectorState } from './vibingDirector/vibingDirectorState'

function node(meta: Record<string, unknown>): GenerationCanvasNode {
  return {
    id: 'director-1',
    kind: 'vibingDirector',
    title: 'VIBING Director',
    position: { x: 0, y: 0 },
    meta,
  }
}

describe('VibingDirectorEditor state boundary', () => {
  it('uses only vibingDirectorState and never imports legacy scene3dState as its source', () => {
    const state = readVibingDirectorState(node({
      scene3dState: {
        objects: [{ id: 'legacy-actor', name: '旧 3D 节点角色' }],
        cameras: [],
      },
      vibingDirectorState: {
        brief: '独立导演台的咖啡广告',
        beats: [{ id: 'beat-1', title: '开场', durationSec: 3 }],
      },
    }))

    expect(state.brief).toBe('独立导演台的咖啡广告')
    expect(state.beats).toHaveLength(1)
    expect(state.backend).toBe('blender')
    expect(state.objects.some((object) => object.name === '旧 3D 节点角色')).toBe(false)
  })

  it('restores the complete Director snapshot selected from result history', () => {
    const current = {
      ...createVibingDirectorState(200),
      brief: '当前版本',
      objects: [{
        id: 'current-actor',
        name: '当前角色',
        kind: 'marker' as const,
        role: 'actor_standing',
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      }],
    }
    const previous = {
      ...createVibingDirectorState(100),
      brief: '上一个可回滚版本',
      objects: [{
        id: 'previous-actor',
        name: '旧角色',
        kind: 'marker' as const,
        role: 'actor_seated',
        position: [1, 0, 2] as [number, number, number],
        rotation: [0, 90, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      }],
      output: {
        jobId: 'job-previous',
        previewUrl: 'nomi-local://previous.png',
        blendUrl: 'nomi-local://previous.blend',
        modelUrl: 'nomi-local://previous.glb',
        blendRelativePath: '.nomi/vibing-director/job-previous/scene.blend',
        createdAt: 100,
      },
    }
    const selected = createVibingDirectorPreviewResult('director-1', previous)
    const source = node({ vibingDirectorState: current })
    source.result = selected
    source.history = [selected]

    const restored = readVibingDirectorState(source)

    expect(restored.brief).toBe('上一个可回滚版本')
    expect(restored.objects.map((object) => object.id)).toEqual(['previous-actor'])
    expect(restored.output?.jobId).toBe('job-previous')
  })

  it('restores legacy Director artifact URLs even when the old result has no state snapshot', () => {
    const current = {
      ...createVibingDirectorState(200),
      brief: '当前版本',
    }
    const source = node({ vibingDirectorState: current })
    source.result = {
      id: 'legacy-director-result',
      type: 'image',
      url: 'nomi-local://legacy-preview.png',
      createdAt: 50,
      raw: {
        source: 'vibing-director',
        blendUrl: 'nomi-local://legacy.blend',
        modelUrl: 'nomi-local://legacy.glb',
        blendRelativePath: '.nomi/vibing-director/legacy/scene.blend',
        blenderVersion: '4.0.1',
      },
    }

    const restored = readVibingDirectorState(source)

    expect(restored.brief).toBe('当前版本')
    expect(restored.output).toMatchObject({
      previewUrl: 'nomi-local://legacy-preview.png',
      blendUrl: 'nomi-local://legacy.blend',
      modelUrl: 'nomi-local://legacy.glb',
      blendRelativePath: '.nomi/vibing-director/legacy/scene.blend',
      blenderVersion: '4.0.1',
    })
  })
})
