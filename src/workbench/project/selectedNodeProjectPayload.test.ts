import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, NodeGroup } from '../generationCanvas/model/generationCanvasTypes'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import { buildSelectedNodeProjectPayload, defaultSelectedNodeProjectName } from './selectedNodeProjectPayload'

function node(id: string, x: number, y: number, groupId?: string): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    position: { x, y },
    prompt: `${id} prompt`,
    categoryId: 'shots',
    ...(groupId ? { groupId } : {}),
    result: {
      id: `${id}-result`,
      type: 'image',
      url: `nomi-local://asset/source-project/assets/generated/${id}.png`,
      createdAt: 1,
    },
  }
}

function group(id: string, nodeIds: string[]): NodeGroup {
  return {
    id,
    name: id,
    categoryId: 'shots',
    nodeIds,
    frameBounds: { x: 90, y: 170, w: 400, h: 280 },
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('buildSelectedNodeProjectPayload', () => {
  it('copies only selected nodes with their internal edges and selected group membership', () => {
    const source = createDefaultWorkbenchProjectPayload()
    source.generationCanvas = {
      nodes: [
        node('a', 100, 200, 'g1'),
        node('b', 340, 260, 'g1'),
        node('c', 720, 400, 'g1'),
        node('orphan-group-node', 880, 400, 'missing-group'),
      ],
      edges: [
        { id: 'edge-a-b', source: 'a', target: 'b', mode: 'reference' },
        { id: 'edge-b-c', source: 'b', target: 'c', mode: 'reference' },
      ],
      groups: [group('g1', ['a', 'b', 'c'])],
      selectedNodeIds: ['a', 'b'],
    }

    const built = buildSelectedNodeProjectPayload(source, ['a', 'b', 'b'])

    expect(built?.nodeCount).toBe(2)
    expect(built?.edgeCount).toBe(1)
    expect(built?.groupCount).toBe(1)
    expect(built?.payload.generationCanvas.nodes.map((candidate) => candidate.id)).toEqual(['a', 'b'])
    expect(built?.payload.generationCanvas.edges).toEqual([
      { id: 'edge-a-b', source: 'a', target: 'b', mode: 'reference' },
    ])
    expect(built?.payload.generationCanvas.groups).toEqual([
      {
        id: 'g1',
        name: 'g1',
        categoryId: 'shots',
        nodeIds: ['a', 'b'],
        frameBounds: { x: 230, y: 150, w: 400, h: 280 },
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    expect(built?.payload.generationCanvas.nodes.map((candidate) => candidate.position)).toEqual([
      { x: 240, y: 180 },
      { x: 480, y: 240 },
    ])
    expect(built?.payload.storyboardPlan).toBeNull()
    expect(built?.payload.storyboardPlanCommitted).toBe(false)
  })

  it('drops orphan group ids when the group itself is not part of the selected snapshot', () => {
    const source = createDefaultWorkbenchProjectPayload()
    source.generationCanvas = {
      nodes: [node('orphan', 12, 34, 'missing-group')],
      edges: [],
      groups: [],
      selectedNodeIds: ['orphan'],
    }

    const built = buildSelectedNodeProjectPayload(source, ['orphan'])

    expect(built?.payload.generationCanvas.nodes[0]?.groupId).toBeUndefined()
  })

  it('returns null for an empty or stale selection', () => {
    const source = createDefaultWorkbenchProjectPayload()
    source.generationCanvas = { nodes: [node('a', 0, 0)], edges: [], groups: [], selectedNodeIds: [] }

    expect(buildSelectedNodeProjectPayload(source, [])).toBeNull()
    expect(buildSelectedNodeProjectPayload(source, ['missing'])).toBeNull()
  })
})

describe('defaultSelectedNodeProjectName', () => {
  it('derives a concise target name from source project and mode', () => {
    expect(defaultSelectedNodeProjectName('咖啡广告', 'copy')).toBe('咖啡广告 · 复制节点')
    expect(defaultSelectedNodeProjectName('咖啡广告', 'move')).toBe('咖啡广告 · 移出节点')
  })
})
