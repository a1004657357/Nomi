import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { readVibingDirectorState } from './VibingDirectorEditor'

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
})
